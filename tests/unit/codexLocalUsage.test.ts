import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexLocalUsageScanner,
  LocalUsageCheckpointStore,
} from "../../src/local-usage/index";

const directories: string[] = [];
const event = (
  input: number,
  output: number,
  cached = 0,
  timestamp?: string,
): string =>
  JSON.stringify({
    type: "event_msg",
    ...(timestamp ? { timestamp } : {}),
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          cached_input_tokens: cached,
          total_tokens: input + output,
        },
      },
    },
  });

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-local-usage-"));
  directories.push(directory);
  const rootPath = path.join(directory, "sessions");
  const filePath = path.join(rootPath, "session.jsonl");
  const store = new LocalUsageCheckpointStore(
    path.join(directory, "index.json"),
  );
  const scanner = new CodexLocalUsageScanner({
    rootPath,
    checkpointStore: store,
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });
  return { filePath, scanner, store };
};
const writeLines = async (filePath: string, lines: string[]): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CodexLocalUsageScanner", () => {
  it("uses cumulative positive deltas without double-counting cache", async () => {
    const { filePath, scanner } = await fixture();
    await writeLines(filePath, [event(10, 2, 3), event(18, 5, 7)]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 18,
      outputTokens: 5,
      cacheReadTokens: 7,
      totalTokens: 23,
      partial: false,
    });
  });

  it("uses decreases as a baseline and ignores last_token_usage", async () => {
    const { filePath, scanner } = await fixture();
    const line = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 5,
            output_tokens: 2,
            cached_input_tokens: 1,
            total_tokens: 7,
          },
          last_token_usage: { input_tokens: 999, output_tokens: 999 },
        },
      },
    });
    await writeLines(filePath, [event(20, 8, 4), line, event(9, 4, 2)]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 24,
      outputTokens: 10,
      cacheReadTokens: 5,
      totalTokens: 34,
    });
  });

  it("keeps checkpoint cursor and errorCount with the same store", async () => {
    const { filePath, scanner, store } = await fixture();
    await writeLines(filePath, [
      event(5, 1),
      '{"token_count":"total_token_usage"}',
    ]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: true,
      failedFileCount: 1,
      inputTokens: 5,
    });
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: true,
      failedFileCount: 1,
      inputTokens: 5,
    });
    await appendFile(filePath, `${event(9, 3)}\n`, "utf8");
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: true,
      failedFileCount: 1,
      inputTokens: 9,
      outputTokens: 3,
    });
    const files = Object.values((await store.load()).providers.codex.files);
    expect(files).toHaveLength(1);
    expect(files[0]?.errorCount).toBe(1);
    await writeLines(filePath, [event(12, 4)]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: false,
      failedFileCount: 0,
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it("rescans truncate or replacement and deletes disappeared files", async () => {
    const { filePath, scanner } = await fixture();
    await writeLines(filePath, [event(10, 1)]);
    await scanner.scan(new AbortController().signal);
    await writeLines(filePath, [event(3, 2)]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({ inputTokens: 3, outputTokens: 2 });
    const replacement = `${filePath}.replacement`;
    await writeLines(replacement, [event(8, 4)]);
    await rename(replacement, filePath);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({ inputTokens: 8, outputTokens: 4 });
    await rm(filePath);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      scannedFileCount: 0,
      totalTokens: 0,
      partial: false,
    });
  });

  it("keeps an incomplete EOF for a future scan and uses only valid event timestamps", async () => {
    const { filePath, scanner } = await fixture();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${event(3, 1, 0, "not-a-date")}\n${event(7, 2, 0, "2026-09-01T10:30:00.000+00:00")}`,
      "utf8",
    );
    const first = await scanner.scan(new AbortController().signal);
    expect(first.inputTokens).toBe(3);
    expect(first.observedFrom).toBeUndefined();
    await appendFile(filePath, "\n", "utf8");
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 7,
      outputTokens: 2,
      observedFrom: "2026-09-01T10:30:00.000+00:00",
    });
  });

  it("reports malformed or unsafe candidates as partial and treats a missing root as empty", async () => {
    const { filePath, scanner } = await fixture();
    await writeLines(filePath, [
      event(4, 2),
      event(Number.MAX_SAFE_INTEGER, 1),
    ]);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: true,
      failedFileCount: 1,
      totalTokens: 6,
    });
    const { scanner: missing } = await fixture();
    await expect(
      missing.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      scannedFileCount: 0,
      failedFileCount: 0,
      partial: false,
    });
  });

  it("reports a non-directory root as an enumeration failure", async () => {
    const { filePath, store } = await fixture();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "fixture", "utf8");
    const scanner = new CodexLocalUsageScanner({
      rootPath: filePath,
      checkpointStore: store,
    });
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      partial: true,
      failedFileCount: 1,
    });
  });
});
