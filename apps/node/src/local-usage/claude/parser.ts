import { createHash } from "node:crypto";
import type { TokenContribution } from "../types";

export interface ClaudeUsageEvent {
  messageHash: string;
  contribution: TokenContribution;
  observedAt?: string;
}

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const token = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const timestamp = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

/** Parses only the top-level Claude assistant usage payload. */
export const parseClaudeUsageLine = (
  line: string,
): ClaudeUsageEvent | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (event.type !== "assistant") return undefined;
  const message = event.message;
  if (!message || typeof message !== "object") return undefined;
  const messageRecord = message as Record<string, unknown>;
  if (typeof messageRecord.id !== "string" || messageRecord.id.length === 0)
    return undefined;
  const usage = messageRecord.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const usageRecord = usage as Record<string, unknown>;
  const input = token(usageRecord.input_tokens);
  const output = token(usageRecord.output_tokens);
  const cacheRead =
    usageRecord.cache_read_input_tokens === undefined
      ? 0
      : token(usageRecord.cache_read_input_tokens);
  const cacheWrite =
    usageRecord.cache_creation_input_tokens === undefined
      ? 0
      : token(usageRecord.cache_creation_input_tokens);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    !Number.isSafeInteger(input + cacheRead + cacheWrite)
  )
    return undefined;
  return {
    messageHash: hash(messageRecord.id),
    contribution: {
      inputTokens: input + cacheRead + cacheWrite,
      outputTokens: output,
      ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    },
    observedAt: timestamp(event.timestamp),
  };
};

export const isClaudeUsageCandidate = (line: Buffer): boolean =>
  line.includes(Buffer.from('"assistant"')) &&
  line.includes(Buffer.from('"message"')) &&
  line.includes(Buffer.from('"usage"'));
