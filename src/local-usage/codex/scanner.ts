import { createHash } from "node:crypto";
import { watch as createWatcher } from "node:fs";
import type { FSWatcher } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { LocalTokenUsage } from "../../shared/index";
import { LocalUsageCheckpointStore } from "../checkpointStore";
import { streamJsonl } from "../streamJsonl";
import type { LocalUsageFileCheckpoint, TokenContribution } from "../types";
import { parseCodexTokenLine } from "./parser";

const BOUNDARY_BYTES = 4096;
const zero = (): Required<TokenContribution> => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const add = (left: number, right: number): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new RangeError("unsafe token count");
  return result;
};
const normalize = (
  value: TokenContribution | undefined,
): Required<TokenContribution> => ({
  inputTokens: value?.inputTokens ?? 0,
  outputTokens: value?.outputTokens ?? 0,
  cacheReadTokens: value?.cacheReadTokens ?? 0,
  cacheWriteTokens: value?.cacheWriteTokens ?? 0,
});
const sum = (
  left: Required<TokenContribution>,
  right: Required<TokenContribution>,
): Required<TokenContribution> => ({
  inputTokens: add(left.inputTokens, right.inputTokens),
  outputTokens: add(left.outputTokens, right.outputTokens),
  cacheReadTokens: add(left.cacheReadTokens, right.cacheReadTokens),
  cacheWriteTokens: add(left.cacheWriteTokens, right.cacheWriteTokens),
});
const positiveDelta = (
  previous: Required<TokenContribution> | undefined,
  next: Required<TokenContribution>,
): Required<TokenContribution> =>
  previous
    ? {
        inputTokens: Math.max(0, next.inputTokens - previous.inputTokens),
        outputTokens: Math.max(0, next.outputTokens - previous.outputTokens),
        cacheReadTokens: Math.max(
          0,
          next.cacheReadTokens - previous.cacheReadTokens,
        ),
        cacheWriteTokens: Math.max(
          0,
          next.cacheWriteTokens - previous.cacheWriteTokens,
        ),
      }
    : next;
const isCandidate = (line: Buffer): boolean =>
  line.includes("token_count") && line.includes("total_token_usage");
const identity = (details: {
  dev: number;
  ino: number;
  birthtimeMs: number;
}): string =>
  hash(`${details.dev}:${details.ino}:${Math.trunc(details.birthtimeMs)}`);

const boundaryHash = async (filePath: string, end: number): Promise<string> => {
  const start = Math.max(0, end - BOUNDARY_BYTES);
  const length = end - start;
  if (length === 0) return hash("");
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(buffer, 0, length, start);
    return hash(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
};
const findFiles = async (rootPath: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(entryPath);
    }
  };
  await visit(rootPath);
  return files;
};
interface ScanResult {
  checkpoint?: LocalUsageFileCheckpoint;
  failed: boolean;
}
export interface CodexLocalUsageScannerOptions {
  checkpointStore: LocalUsageCheckpointStore;
  rootPath?: string;
  clock?: () => Date;
}

export class CodexLocalUsageScanner {
  public readonly providerId = "codex" as const;
  private readonly rootPath: string;
  private readonly checkpointStore: LocalUsageCheckpointStore;
  private readonly clock: () => Date;
  public constructor(options: CodexLocalUsageScannerOptions) {
    this.rootPath =
      options.rootPath ?? path.join(homedir(), ".codex", "sessions");
    this.checkpointStore = options.checkpointStore;
    this.clock = options.clock ?? (() => new Date());
  }

  public async scan(signal: AbortSignal): Promise<LocalTokenUsage> {
    if (signal.aborted)
      throw new DOMException("The scan was aborted", "AbortError");
    let filePaths: string[];
    let enumerationFailed = false;
    try {
      filePaths = await findFiles(this.rootPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.result([], 0, false);
      filePaths = [];
      enumerationFailed = true;
    }
    const oldFiles = (await this.checkpointStore.load()).providers.codex.files;
    const nextFiles: Record<string, LocalUsageFileCheckpoint> =
      enumerationFailed ? structuredClone(oldFiles) : {};
    const failedReadKeys = new Set<string>();
    const seen = new Set<string>();
    for (const filePath of filePaths) {
      if (signal.aborted)
        throw new DOMException("The scan was aborted", "AbortError");
      const fileKey = hash(
        path.relative(this.rootPath, filePath).replaceAll("\\", "/"),
      );
      seen.add(fileKey);
      const scanned = await this.scanFile(
        filePath,
        fileKey,
        oldFiles[fileKey],
        signal,
      );
      if (scanned.checkpoint) nextFiles[fileKey] = scanned.checkpoint;
      else if (oldFiles[fileKey]) nextFiles[fileKey] = oldFiles[fileKey];
      if (scanned.failed && !scanned.checkpoint?.errorCount)
        failedReadKeys.add(fileKey);
    }
    if (!enumerationFailed)
      for (const fileKey of Object.keys(oldFiles))
        if (!seen.has(fileKey)) delete nextFiles[fileKey];
    const persisted = await this.checkpointStore.updateProvider(
      "codex",
      () => ({ files: nextFiles }),
    );
    const files = Object.values(persisted.providers.codex.files);
    const failedKeys = new Set(
      files
        .filter((file) => (file.errorCount ?? 0) > 0)
        .map((file) => file.fileKey),
    );
    for (const key of failedReadKeys) failedKeys.add(key);
    const failedFileCount = failedKeys.size + (enumerationFailed ? 1 : 0);
    return this.result(
      files,
      failedFileCount,
      enumerationFailed || failedFileCount > 0,
    );
  }

  public watch(onDirty: () => void): () => void {
    let watcher: FSWatcher | undefined;
    try {
      watcher = createWatcher(this.rootPath, { recursive: true }, () =>
        onDirty(),
      );
      watcher.on("error", () => undefined);
    } catch {
      return () => undefined;
    }
    return () => watcher?.close();
  }

  private async scanFile(
    filePath: string,
    fileKey: string,
    previous: LocalUsageFileCheckpoint | undefined,
    signal: AbortSignal,
  ): Promise<ScanResult> {
    try {
      const details = await stat(filePath);
      const size = Math.trunc(details.size);
      const mtimeMs = Math.trunc(details.mtimeMs);
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isSafeInteger(mtimeMs) ||
        mtimeMs < 0
      )
        return { failed: true };
      const fileId = identity(details);
      const previousOffset = previous?.offset ?? 0;
      const canAppend =
        previous !== undefined &&
        previous.identity === fileId &&
        size >= previousOffset;
      const oldBoundary = canAppend
        ? await boundaryHash(filePath, previousOffset)
        : undefined;
      const unchanged =
        previous !== undefined &&
        canAppend &&
        size === previous.size &&
        mtimeMs === previous.mtimeMs &&
        oldBoundary === previous.boundaryHash;
      if (unchanged)
        return { checkpoint: previous, failed: (previous.errorCount ?? 0) > 0 };
      const restart =
        previous === undefined ||
        !canAppend ||
        oldBoundary !== previous.boundaryHash ||
        (size === previous.size && mtimeMs !== previous.mtimeMs);
      let contribution = restart ? zero() : normalize(previous.contribution);
      let lastCumulative = restart
        ? undefined
        : normalize(previous.lastCumulative);
      let observedFrom = restart ? undefined : previous.observedFrom;
      let invalidCount = 0;
      const streamed = await streamJsonl({
        filePath,
        offset: restart ? 0 : previousOffset,
        signal,
        isCandidate,
        onLine: (line) => {
          const parsed = parseCodexTokenLine(line);
          if (parsed.kind === "invalid") {
            invalidCount += 1;
            return;
          }
          contribution = sum(
            contribution,
            positiveDelta(lastCumulative, parsed.value.cumulative),
          );
          lastCumulative = parsed.value.cumulative;
          if (
            parsed.value.timestamp &&
            (!observedFrom || parsed.value.timestamp < observedFrom)
          )
            observedFrom = parsed.value.timestamp;
        },
      });
      const errorCount = add(
        restart ? 0 : (previous?.errorCount ?? 0),
        add(invalidCount, streamed.oversizedLineCount),
      );
      return {
        failed: errorCount > 0,
        checkpoint: {
          fileKey,
          identity: fileId,
          size,
          mtimeMs,
          offset: streamed.nextOffset,
          boundaryHash: await boundaryHash(filePath, streamed.nextOffset),
          ...(errorCount > 0 ? { errorCount } : {}),
          ...(observedFrom ? { observedFrom } : {}),
          contribution,
          ...(lastCumulative ? { lastCumulative } : {}),
        },
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      return { failed: true };
    }
  }

  private result(
    files: LocalUsageFileCheckpoint[],
    failedFileCount: number,
    partial: boolean,
  ): LocalTokenUsage {
    let totals = zero();
    let observedFrom: string | undefined;
    for (const file of files) {
      try {
        totals = sum(totals, normalize(file.contribution));
      } catch {
        failedFileCount += 1;
        partial = true;
      }
      if (
        file.observedFrom &&
        (!observedFrom || file.observedFrom < observedFrom)
      )
        observedFrom = file.observedFrom;
    }
    return {
      scope: "local_device",
      scannedFileCount: files.length,
      failedFileCount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      totalTokens: add(totals.inputTokens, totals.outputTokens),
      partial,
      calculatedAt: this.clock().toISOString(),
      ...(observedFrom ? { observedFrom } : {}),
    };
  }
}
