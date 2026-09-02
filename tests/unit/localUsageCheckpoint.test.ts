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
      identity: "fictional-identity",
      size: 40,
      mtimeMs: 10,
      offset: 40,
      boundaryHash: "fictional-boundary-hash",
      observedFrom: "2026-09-01T00:00:00.000Z",
      contribution: { inputTokens: 20, outputTokens: 10 },
      lastCumulative: { inputTokens: 25, outputTokens: 12 },
      messages: {
        "fictional-message-hash": { inputTokens: 20, outputTokens: 10 },
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
    expect(await store.load()).toEqual({ schemaVersion: 1, providers: { codex: { files: {} }, claude: { files: {} } } });

    await writeFile(filePath, JSON.stringify({ schemaVersion: 2 }), "utf8");
    expect(await new LocalUsageCheckpointStore(filePath).load()).toEqual({ schemaVersion: 1, providers: { codex: { files: {} }, claude: { files: {} } } });
  });

  it("serializes concurrent provider updates without dropping either section", async () => {
    const { filePath, store } = await createStore();
    await Promise.all([
      store.updateProvider("codex", () => sectionWith("codex-file-hash")),
      store.updateProvider("claude", () => sectionWith("claude-file-hash")),
    ]);
    const state = await new LocalUsageCheckpointStore(filePath).load();
    expect(Object.keys(state.providers.codex.files)).toEqual(["codex-file-hash"]);
    expect(Object.keys(state.providers.claude.files)).toEqual(["claude-file-hash"]);
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("fixture.jsonl");
  });

  it("round-trips cumulative and hashed-message checkpoints", async () => {
    const { filePath, store } = await createStore();
    await store.updateProvider("claude", () => sectionWith("claude-file-hash"));

    expect(await new LocalUsageCheckpointStore(filePath).load()).toMatchObject({
      providers: {
        claude: {
          files: {
            "claude-file-hash": {
              observedFrom: "2026-09-01T00:00:00.000Z",
              lastCumulative: { inputTokens: 25, outputTokens: 12 },
              messages: {
                "fictional-message-hash": { inputTokens: 20, outputTokens: 10 },
              },
            },
          },
        },
      },
    });
  });
});
