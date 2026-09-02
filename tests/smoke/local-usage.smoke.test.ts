import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  ClaudeLocalUsageScanner,
  CodexLocalUsageScanner,
  LOCAL_USAGE_INDEX_FILENAME,
  LocalUsageCheckpointStore,
} from "../../src/local-usage/index";
import { localTokenUsageSchema, type LocalTokenUsage } from "../../src/shared";

const temporaryDirectories: string[] = [];

const isValidUsage = (usage: LocalTokenUsage): boolean => {
  const numbers = [
    usage.scannedFileCount,
    usage.failedFileCount,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens ?? 0,
    usage.cacheWriteTokens ?? 0,
    usage.totalTokens,
  ];
  return (
    localTokenUsageSchema.safeParse(usage).success &&
    numbers.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("scans local Codex and Claude logs without persisting source paths", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "llm-usage-monitor-smoke-"),
  );
  temporaryDirectories.push(directory);
  const indexPath = path.join(directory, LOCAL_USAGE_INDEX_FILENAME);
  const checkpointStore = new LocalUsageCheckpointStore(indexPath);
  const codexScanner = new CodexLocalUsageScanner({ checkpointStore });
  const claudeScanner = new ClaudeLocalUsageScanner({ checkpointStore });
  const [codex, claude] = await Promise.all([
    codexScanner.scan(new AbortController().signal),
    claudeScanner.scan(new AbortController().signal),
  ]);

  expect(codexScanner.providerId === "codex").toBe(true);
  expect(claudeScanner.providerId === "claude").toBe(true);
  expect(isValidUsage(codex)).toBe(true);
  expect(isValidUsage(claude)).toBe(true);

  const index = await readFile(indexPath, "utf8");
  const hasSourcePathMarker = [
    homedir(),
    ".codex",
    ".claude",
    "projects",
    "sessions",
  ].some((marker) => index.includes(marker));
  expect(hasSourcePathMarker).toBe(false);
}, 120_000);
