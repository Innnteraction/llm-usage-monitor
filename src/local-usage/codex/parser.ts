import { z } from "zod";
import type { TokenContribution } from "../types";

export interface CodexTokenCount {
  cumulative: Required<TokenContribution>;
  timestamp?: string;
}

export type CodexTokenLine =
  { kind: "token_count"; value: CodexTokenCount } | { kind: "invalid" };

const timestampSchema = z.string().datetime({ offset: true });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const token = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

export const parseCodexTokenLine = (line: string): CodexTokenLine => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return { kind: "invalid" };
  }
  if (
    !isRecord(event) ||
    event.type !== "event_msg" ||
    !isRecord(event.payload)
  )
    return { kind: "invalid" };
  const payload = event.payload;
  if (
    payload.type !== "token_count" ||
    !isRecord(payload.info) ||
    !isRecord(payload.info.total_token_usage)
  )
    return { kind: "invalid" };
  const usage = payload.info.total_token_usage;
  const inputTokens = token(usage.input_tokens);
  const outputTokens = token(usage.output_tokens);
  const cacheReadTokens = token(usage.cached_input_tokens);
  const totalTokens = token(usage.total_tokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    totalTokens === undefined ||
    !Number.isSafeInteger(inputTokens + outputTokens) ||
    totalTokens !== inputTokens + outputTokens ||
    cacheReadTokens > inputTokens
  )
    return { kind: "invalid" };
  const timestamp = timestampSchema.safeParse(event.timestamp);
  return {
    kind: "token_count",
    value: {
      cumulative: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
      },
      ...(timestamp.success ? { timestamp: timestamp.data } : {}),
    },
  };
};
