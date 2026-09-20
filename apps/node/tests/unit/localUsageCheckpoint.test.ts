import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_USAGE_INDEX_FILENAME,
  LocalUsageCheckpointStore,
} from "../../src/local-usage/index";

const directories: string[] = [];
const createStore = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "local-usage-index-"));
  directories.push(directory);
  const filePath = path.join(directory, LOCAL_USAGE_INDEX_FILENAME);
  return { filePath, store: new LocalUsageCheckpointStore(filePath) };
};
const sectionWith = (fileKey: string) => ({
  files: {
    [fileKey]: {
      fileKey,
      identity: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      size: 40,
      mtimeMs: 10,
      offset: 40,
      boundaryHash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      errorCount: 2,
      observedFrom: "2026-09-01T00:00:00.000Z",
      contribution: { inputTokens: 20, outputTokens: 10 },
      lastCumulative: { inputTokens: 25, outputTokens: 12 },
      messages: {
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc": { inputTokens: 20, outputTokens: 10 },
      },
    },
  },
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalUsageCheckpointStore", () => {
  it("recovers with empty state from corrupt or unsupported checkpoint files", async () => {
    const { filePath, store } = await createStore();
    await writeFile(filePath, "not json", "utf8");
    expect(await store.load()).toEqual({ schemaVersion: 2, providers: { codex: { files: {} }, claude: { files: {} } } });

    await writeFile(filePath, JSON.stringify({ schemaVersion: 2 }), "utf8");
    expect(await new LocalUsageCheckpointStore(filePath).load()).toEqual({ schemaVersion: 2, providers: { codex: { files: {} }, claude: { files: {} } } });
  });

  it("serializes concurrent provider updates without dropping either section", async () => {
    const { filePath, store } = await createStore();
    await Promise.all([
      store.updateProvider("codex", () => sectionWith("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")),
      store.updateProvider("claude", () => sectionWith("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")),
    ]);
    const state = await new LocalUsageCheckpointStore(filePath).load();
    expect(Object.keys(state.providers.codex.files)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(Object.keys(state.providers.claude.files)).toEqual(["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("fixture.jsonl");
  });

  it("returns the latest successful sections from the same store instance", async () => {
    const { store } = await createStore();
    await store.updateProvider("codex", () => sectionWith("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect((await store.load()).providers.codex.files["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
      .toMatchObject({ errorCount: 2 });

    await store.updateProvider("claude", () => sectionWith("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
    const state = await store.load();
    expect(state.providers.codex.files["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
      .toMatchObject({ errorCount: 2 });
    expect(state.providers.claude.files["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"])
      .toMatchObject({ errorCount: 2 });
  });

  it("round-trips cumulative and hashed-message checkpoints", async () => {
    const { filePath, store } = await createStore();
    await store.updateProvider("claude", () => sectionWith("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));

    expect(await new LocalUsageCheckpointStore(filePath).load()).toMatchObject({
      providers: {
        claude: {
          files: {
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
              observedFrom: "2026-09-01T00:00:00.000Z",
              errorCount: 2,
              lastCumulative: { inputTokens: 25, outputTokens: 12 },
              messages: {
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc": { inputTokens: 20, outputTokens: 10 },
              },
            },
          },
        },
      },
    });
  });

  it("rejects invalid persisted file error counts", async () => {
    const { filePath } = await createStore();
    const invalidState = {
      schemaVersion: 2,
      providers: {
        codex: sectionWith("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        claude: { files: {} },
      },
    };
    const checkpoint = invalidState.providers.codex.files["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
    if (!checkpoint) {
      throw new Error("fixture checkpoint is missing");
    }
    checkpoint.errorCount = -1;
    await writeFile(filePath, JSON.stringify(invalidState), "utf8");
    expect(await new LocalUsageCheckpointStore(filePath).load()).toEqual({
      schemaVersion: 2,
      providers: { codex: { files: {} }, claude: { files: {} } },
    });

    checkpoint.errorCount = Number.MAX_SAFE_INTEGER + 1;
    await writeFile(filePath, JSON.stringify(invalidState), "utf8");
    expect(await new LocalUsageCheckpointStore(filePath).load()).toEqual({
      schemaVersion: 2,
      providers: { codex: { files: {} }, claude: { files: {} } },
    });
  });
});
