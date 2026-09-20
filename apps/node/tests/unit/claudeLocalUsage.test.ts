import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClaudeLocalUsageScanner,
  LocalUsageCheckpointStore,
} from "../../src/local-usage";

const directories: string[] = [];
const event = (
  id: string,
  usage: Record<string, unknown>,
  timestamp: unknown = "2026-09-01T00:00:00.000Z",
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "assistant",
    timestamp,
    message: { id, usage },
    ...extra,
  });

const setup = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "claude-local-usage-"));
  directories.push(directory);
  const rootPath = path.join(directory, "projects");
  const checkpointStore = new LocalUsageCheckpointStore(
    path.join(directory, "index.json"),
  );
  const scanner = new ClaudeLocalUsageScanner({
    rootPath,
    checkpointStore,
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });
  const writeLog = async (name: string, contents: string) => {
    await mkdir(rootPath, { recursive: true });
    const filePath = path.join(rootPath, name);
    await writeFile(filePath, contents, "utf8");
    return filePath;
  };
  return { rootPath, checkpointStore, scanner, writeLog };
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ClaudeLocalUsageScanner", () => {
  it("counts top-level assistant usage without cache double counting", async () => {
    const { scanner, writeLog } = await setup();
    await writeLog(
      "one.jsonl",
      `${event("fictional-a", { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, cache_creation: { ephemeral_5m_input_tokens: 900 } }, undefined, { iterations: [{ usage: { input_tokens: 900 } }] })}\n`,
    );
    await writeLog(
      "two.jsonl",
      `${event("fictional-b", { input_tokens: 4, output_tokens: 6 })}\n`,
    );
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      scannedFileCount: 2,
      inputTokens: 19,
      outputTokens: 11,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalTokens: 30,
      partial: false,
    });
  });

  it("merges streaming and cross-file duplicate messages component-wise", async () => {
    const { scanner, writeLog } = await setup();
    await writeLog(
      "a.jsonl",
      `${event("fictional-duplicate", { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 1 })}\n${event("fictional-duplicate", { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 4 })}\n`,
    );
    await writeLog(
      "b.jsonl",
      `${event("fictional-duplicate", { input_tokens: 4, output_tokens: 7, cache_read_input_tokens: 2 })}\n`,
    );
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheWriteTokens: 4,
      totalTokens: 18,
    });
  });

  it("uses only valid event timestamps and keeps their minimum", async () => {
    const { scanner, writeLog } = await setup();
    await writeLog(
      "one.jsonl",
      `${event("fictional-a", { input_tokens: 1, output_tokens: 1 }, "2026-09-01T09:00:00+09:00")}\n${event("fictional-b", { input_tokens: 1, output_tokens: 1 }, "not-a-timestamp")}\n${event("fictional-c", { input_tokens: 1, output_tokens: 1 }, "2026-08-31T23:00:00.000Z")}\n`,
    );
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({ observedFrom: "2026-08-31T23:00:00.000Z" });
  });

  it("preserves cursor and errorCount, then clears partial after a same-size rewrite", async () => {
    const { scanner, checkpointStore, writeLog } = await setup();
    const bad = `${event("fictional-a", { input_tokens: 1, output_tokens: 2 })}\n{"type":"assistant","message":{"id":"bad","usage":{"input_tokens":-1,"output_tokens":1}}}\n`;
    const filePath = await writeLog("one.jsonl", bad);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 1,
      outputTokens: 2,
      partial: true,
      failedFileCount: 1,
    });
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 1,
      outputTokens: 2,
      partial: true,
      failedFileCount: 1,
    });
    await appendFile(
      filePath,
      `${event("fictional-b", { input_tokens: 3, output_tokens: 4 })}\n`,
      "utf8",
    );
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 4,
      outputTokens: 6,
      partial: true,
      failedFileCount: 1,
    });
    expect(
      Object.values((await checkpointStore.load()).providers.claude.files)[0],
    ).toMatchObject({ errorCount: 1 });
    const cleanEvent = event("fictional-c", {
      input_tokens: 4,
      output_tokens: 5,
    });
    const clean = `${cleanEvent}${" ".repeat(Buffer.byteLength(bad) - Buffer.byteLength(cleanEvent) - 1)}\n`;
    await writeFile(filePath, clean, "utf8");
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      inputTokens: 4,
      outputTokens: 5,
      partial: false,
      failedFileCount: 0,
    });
  });

  it("handles deletion, incomplete EOF, and a missing root", async () => {
    const { scanner, writeLog } = await setup();
    const filePath = await writeLog(
      "one.jsonl",
      `${event("fictional-a", { input_tokens: 1, output_tokens: 1 })}\n`,
    );
    await scanner.scan(new AbortController().signal);
    await rm(filePath);
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({ scannedFileCount: 0, totalTokens: 0 });
    await writeLog(
      "partial.jsonl",
      event("fictional-unfinished", { input_tokens: 9, output_tokens: 9 }),
    );
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({ totalTokens: 0, partial: false });
  });

  it("honors abort before probing a missing root", async () => {
    const { scanner } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(scanner.scan(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("keeps partial status when the configured root cannot be enumerated", async () => {
    const { rootPath, scanner } = await setup();
    await writeFile(rootPath, "not a directory", "utf8");
    await expect(
      scanner.scan(new AbortController().signal),
    ).resolves.toMatchObject({
      scannedFileCount: 0,
      failedFileCount: 1,
      partial: true,
      totalTokens: 0,
    });
  });
});
