import { open } from "node:fs/promises";

export const DEFAULT_JSONL_CHUNK_SIZE = 256 * 1024;
export const DEFAULT_JSONL_MAX_LINE_BYTES = 16 * 1024 * 1024;

export interface StreamJsonlOptions {
  filePath: string;
  offset?: number;
  signal?: AbortSignal;
  chunkSize?: number;
  maxLineBytes?: number;
  isCandidate?: (line: Buffer) => boolean;
  onLine: (line: string, byteOffset: number) => void | Promise<void>;
}

export interface StreamJsonlResult {
  nextOffset: number;
  incompleteLine: boolean;
  oversizedLineCount: number;
}

const abortError = (): Error => {
  const error = new Error("The JSONL stream was aborted");
  error.name = "AbortError";
  return error;
};

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * Streams complete JSONL lines without decoding a partial UTF-8 sequence.
 * `nextOffset` deliberately stops at an unfinished final line so a later scan
 * can retry it after the writer appends its line terminator.
 */
export const streamJsonl = async ({
  filePath,
  offset = 0,
  signal,
  chunkSize = DEFAULT_JSONL_CHUNK_SIZE,
  maxLineBytes = DEFAULT_JSONL_MAX_LINE_BYTES,
  isCandidate,
  onLine,
}: StreamJsonlOptions): Promise<StreamJsonlResult> => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("chunkSize must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
    throw new RangeError("maxLineBytes must be a positive safe integer");
  }

  const file = await open(filePath, "r");
  const buffer = Buffer.allocUnsafe(chunkSize);
  let position = offset;
  let lineStart = offset;
  let pendingSegments: Buffer[] = [];
  let pendingLength = 0;
  let skippingOversizedLine = false;
  let oversizedLineCount = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw abortError();
      }

      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        return {
          nextOffset: lineStart,
          incompleteLine: pendingLength > 0 || skippingOversizedLine,
          oversizedLineCount,
        };
      }
      position += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      let cursor = 0;

      while (cursor < chunk.length) {
        const newline = chunk.indexOf(0x0a, cursor);
        const segmentEnd = newline === -1 ? chunk.length : newline;
        const segment = chunk.subarray(cursor, segmentEnd);

        if (!skippingOversizedLine) {
          if (pendingLength + segment.length > maxLineBytes) {
            skippingOversizedLine = true;
            pendingSegments = [];
            pendingLength = 0;
          } else if (segment.length > 0) {
            pendingSegments.push(Buffer.from(segment));
            pendingLength += segment.length;
          }
        }

        if (newline !== -1) {
          const completedAt = position - bytesRead + newline + 1;
          if (skippingOversizedLine) {
            oversizedLineCount += 1;
            skippingOversizedLine = false;
          } else {
            const pending = Buffer.concat(pendingSegments, pendingLength);
            const line = pending.length > 0 && pending[pending.length - 1] === 0x0d
              ? pending.subarray(0, pending.length - 1)
              : pending;
            if (!isCandidate || isCandidate(line)) {
              await onLine(line.toString("utf8"), lineStart);
            }
          }
          pendingSegments = [];
          pendingLength = 0;
          lineStart = completedAt;
          cursor = newline + 1;
        } else {
          cursor = chunk.length;
        }
      }
      await yieldToEventLoop();
    }
  } finally {
    await file.close();
  }
};
