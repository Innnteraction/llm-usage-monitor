import { createHash } from "node:crypto";
import { watch as watchFileSystem } from "node:fs";
import type { FSWatcher } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { LocalTokenUsage } from "../../shared";
import { LocalUsageCheckpointStore } from "../checkpointStore";
import { streamJsonl } from "../streamJsonl";
import type { ProviderCheckpointSection, TokenContribution } from "../types";
import { isClaudeUsageCandidate, parseClaudeUsageLine } from "./parser";

const PROVIDER_ID = "claude" as const;
const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const read = (value: TokenContribution): number => value.cacheReadTokens ?? 0;
const write = (value: TokenContribution): number => value.cacheWriteTokens ?? 0;
const base = (value: TokenContribution): number =>
  Math.max(0, value.inputTokens - read(value) - write(value));
const valid = (value: TokenContribution): boolean =>
  [value.inputTokens, value.outputTokens, read(value), write(value)].every(
    (token) => Number.isSafeInteger(token) && token >= 0,
  ) && base(value) + read(value) + write(value) === value.inputTokens;

const mergeMessage = (
  current: TokenContribution | undefined,
  next: TokenContribution,
): TokenContribution | undefined => {
  if (!valid(next)) return undefined;
  const previous = current ?? { inputTokens: 0, outputTokens: 0 };
  const input =
    Math.max(base(previous), base(next)) +
    Math.max(read(previous), read(next)) +
    Math.max(write(previous), write(next));
  const output = Math.max(previous.outputTokens, next.outputTokens);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output))
    return undefined;
  const cacheReadTokens = Math.max(read(previous), read(next));
  const cacheWriteTokens = Math.max(write(previous), write(next));
  return {
    inputTokens: input,
    outputTokens: output,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  };
};

const total = (
  messages: Record<string, TokenContribution>,
): TokenContribution | undefined => {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  for (const value of Object.values(messages)) {
    if (!valid(value)) return undefined;
    inputTokens += value.inputTokens;
    outputTokens += value.outputTokens;
    cacheReadTokens += read(value);
    cacheWriteTokens += write(value);
    if (
      ![inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].every(
        Number.isSafeInteger,
      )
    )
      return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  };
};

const boundaryHash = async (
  filePath: string,
  position: number,
): Promise<string> => {
  const length = Math.min(512, position);
  if (length === 0) return hash("");
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(
      buffer,
      0,
      length,
      Math.max(0, position - length),
    );
    return hash(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
};

interface DiscoveredFile {
  filePath: string;
  relativePath: string;
}
interface DiscoveryResult {
  files: DiscoveredFile[];
  missing: boolean;
  errorCount: number;
}

const discoverJsonl = async (rootPath: string): Promise<DiscoveryResult> => {
  const files: DiscoveredFile[] = [];
  let errorCount = 0;
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      errorCount += 1;
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push({
          filePath,
          relativePath: path.relative(rootPath, filePath),
        });
    }
  };
  try {
    await stat(rootPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { files, missing: true, errorCount: 0 }
      : { files, missing: false, errorCount: 1 };
  }
  await visit(rootPath);
  return { files, missing: false, errorCount };
};

export interface ClaudeLocalUsageScannerOptions {
  rootPath?: string;
  checkpointStore: LocalUsageCheckpointStore;
  clock?: () => Date;
}

export class ClaudeLocalUsageScanner {
  public readonly providerId = PROVIDER_ID;
  private readonly rootPath: string;
  private readonly clock: () => Date;

  public constructor(private readonly options: ClaudeLocalUsageScannerOptions) {
    this.rootPath =
      options.rootPath ?? path.join(homedir(), ".claude", "projects");
    this.clock = options.clock ?? (() => new Date());
  }

  public async scan(signal: AbortSignal): Promise<LocalTokenUsage> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const discovered = await discoverJsonl(this.rootPath);
    const previous = (await this.options.checkpointStore.load()).providers
      .claude;
    const next: ProviderCheckpointSection = { files: {} };
    const failedFiles = new Set<string>();
    let partial = discovered.errorCount > 0;

    if (!discovered.missing)
      for (const found of discovered.files) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const fileKey = hash(found.relativePath);
        const prior = previous.files[fileKey];
        try {
          const metadata = await stat(found.filePath);
          const identity = hash(
            `${metadata.dev}:${metadata.ino}:${metadata.birthtimeMs}`,
          );
          const currentBoundary = await boundaryHash(
            found.filePath,
            metadata.size,
          );
          const unchanged =
            prior &&
            prior.identity === identity &&
            prior.size === metadata.size &&
            prior.mtimeMs === Math.trunc(metadata.mtimeMs) &&
            prior.boundaryHash === currentBoundary;
          if (unchanged) {
            next.files[fileKey] = prior;
            if ((prior.errorCount ?? 0) > 0) {
              partial = true;
              failedFiles.add(fileKey);
            }
            continue;
          }
          // Same-size modifications are a rewrite, never an append: reset errors and messages.
          const append =
            prior &&
            prior.identity === identity &&
            metadata.size > prior.size &&
            prior.boundaryHash ===
              (await boundaryHash(found.filePath, prior.offset));
          const messages = append ? structuredClone(prior.messages ?? {}) : {};
          let observedFrom = append ? prior.observedFrom : undefined;
          let lineErrorCount = 0;
          const streamed = await streamJsonl({
            filePath: found.filePath,
            offset: append ? prior.offset : 0,
            signal,
            isCandidate: isClaudeUsageCandidate,
            onLine: (line) => {
              const parsed = parseClaudeUsageLine(line);
              if (!parsed) {
                lineErrorCount += 1;
                return;
              }
              const merged = mergeMessage(
                messages[parsed.messageHash],
                parsed.contribution,
              );
              if (!merged) {
                lineErrorCount += 1;
                return;
              }
              messages[parsed.messageHash] = merged;
              if (
                parsed.observedAt &&
                (!observedFrom || parsed.observedAt < observedFrom)
              )
                observedFrom = parsed.observedAt;
            },
          });
          const contribution = total(messages);
          if (!contribution)
            throw new RangeError("invalid local token contribution");
          const errorCount =
            (append ? (prior.errorCount ?? 0) : 0) +
            lineErrorCount +
            streamed.oversizedLineCount;
          if (!Number.isSafeInteger(errorCount))
            throw new RangeError("local usage error count overflow");
          if (errorCount > 0) {
            partial = true;
            failedFiles.add(fileKey);
          }
          next.files[fileKey] = {
            fileKey,
            identity,
            size: metadata.size,
            mtimeMs: Math.trunc(metadata.mtimeMs),
            offset: streamed.nextOffset,
            boundaryHash: await boundaryHash(
              found.filePath,
              streamed.nextOffset,
            ),
            ...(errorCount > 0 ? { errorCount } : {}),
            ...(observedFrom ? { observedFrom } : {}),
            contribution,
            messages,
          };
        } catch (error) {
          if ((error as Error).name === "AbortError") throw error;
          partial = true;
          failedFiles.add(fileKey);
          if (prior) next.files[fileKey] = prior;
        }
      }

    if (discovered.errorCount > 0) {
      for (const [key, checkpoint] of Object.entries(previous.files))
        if (!next.files[key]) next.files[key] = checkpoint;
    }
    for (const [key, checkpoint] of Object.entries(next.files)) {
      if ((checkpoint.errorCount ?? 0) > 0) {
        partial = true;
        failedFiles.add(key);
      }
    }
    const messages = Object.values(next.files).reduce<
      Record<string, TokenContribution>
    >((all, checkpoint) => {
      for (const [messageHash, contribution] of Object.entries(
        checkpoint.messages ?? {},
      )) {
        const merged = mergeMessage(all[messageHash], contribution);
        if (merged) all[messageHash] = merged;
      }
      return all;
    }, {});
    const contribution = total(messages);
    if (!contribution) {
      partial = true;
      failedFiles.add("aggregate");
    }
    await this.options.checkpointStore.updateProvider(PROVIDER_ID, () => next);
    const observedFrom = Object.values(next.files)
      .map(({ observedFrom: value }) => value)
      .filter((value): value is string => value !== undefined)
      .sort()[0];
    const inputTokens = contribution?.inputTokens ?? 0;
    const outputTokens = contribution?.outputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const failedFileCount = discovered.errorCount + failedFiles.size;
    if (
      !Number.isSafeInteger(totalTokens) ||
      !Number.isSafeInteger(failedFileCount)
    ) {
      throw new RangeError("local usage total overflow");
    }
    return {
      scope: "local_device",
      scannedFileCount: Object.keys(next.files).length,
      failedFileCount,
      inputTokens,
      outputTokens,
      ...(contribution && read(contribution) > 0
        ? { cacheReadTokens: read(contribution) }
        : {}),
      ...(contribution && write(contribution) > 0
        ? { cacheWriteTokens: write(contribution) }
        : {}),
      totalTokens,
      partial,
      calculatedAt: this.clock().toISOString(),
      ...(observedFrom ? { observedFrom } : {}),
    };
  }

  public watch(onDirty: () => void): () => void {
    let watcher: FSWatcher | undefined;
    try {
      watcher = watchFileSystem(this.rootPath, { recursive: true }, () =>
        onDirty(),
      );
    } catch {
      return () => undefined;
    }
    watcher.on("error", () => watcher?.close());
    return () => watcher?.close();
  }
}
