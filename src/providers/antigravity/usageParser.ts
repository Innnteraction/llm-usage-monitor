import { z } from "zod";
import type { QuotaWindow } from "../../shared/index";

const MAX_GROUPS = 8;
const MAX_BUCKETS = 8;

const bucketSchema = z.object({
  window: z.string(),
  remaining_fraction: z.number().finite().min(0).max(1).nullable().optional(),
  reset_time: z.string().datetime({ offset: true }).nullable().optional(),
});

const groupSchema = z.object({
  name: z.string(),
  buckets: z.array(bucketSchema).max(MAX_BUCKETS),
});

const usageSchema = z.object({
  status: z.string(),
  num_turns: z.number().finite(),
  command: z.object({
    name: z.string(),
    data: z.object({
      groups: z.array(groupSchema).max(MAX_GROUPS),
    }),
  }),
});

type GroupKind = "gemini" | "claude-gpt";
type WindowKind = "weekly" | "5h";

export class AntigravityUsageParseError extends Error {
  constructor() {
    super("Unsupported Antigravity usage response.");
    this.name = "AntigravityUsageParseError";
  }
}

export interface AntigravityUsageReport {
  quotaWindows: QuotaWindow[];
  accountLabel?: string;
}

const MAX_ACCOUNT_LABEL_LENGTH = 80;

function extractAccountCandidate(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, MAX_ACCOUNT_LABEL_LENGTH);
    }
  }
  if (typeof value === "object" && value !== null) {
    const rec = value as Record<string, unknown>;
    const inner = rec.email ?? rec.name ?? rec.id ?? rec.account;
    if (typeof inner === "string") {
      const trimmed = inner.trim();
      if (trimmed.length > 0) {
        return trimmed.slice(0, MAX_ACCOUNT_LABEL_LENGTH);
      }
    }
  }
  return undefined;
}

function parseAccountLabel(jsonObj: unknown): string | undefined {
  if (typeof jsonObj !== "object" || jsonObj === null) {
    return undefined;
  }
  const root = jsonObj as Record<string, unknown>;
  const command =
    typeof root.command === "object" && root.command !== null
      ? (root.command as Record<string, unknown>)
      : undefined;
  const data =
    command && typeof command.data === "object" && command.data !== null
      ? (command.data as Record<string, unknown>)
      : undefined;

  const fromData =
    extractAccountCandidate(data?.email) ??
    extractAccountCandidate(data?.user_email) ??
    extractAccountCandidate(data?.user) ??
    extractAccountCandidate(data?.account) ??
    extractAccountCandidate(data?.account_label) ??
    extractAccountCandidate(data?.accountLabel);
  if (fromData) {
    return fromData;
  }

  const fromRoot =
    extractAccountCandidate(root.email) ??
    extractAccountCandidate(root.user_email) ??
    extractAccountCandidate(root.user) ??
    extractAccountCandidate(root.account) ??
    extractAccountCandidate(root.account_label) ??
    extractAccountCandidate(root.accountLabel);

  return fromRoot;
}

export function parseAntigravityUsageReport(raw: string): AntigravityUsageReport {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new AntigravityUsageParseError();
  }

  let usage: z.infer<typeof usageSchema>;
  try {
    usage = usageSchema.parse(parsedJson);
  } catch {
    throw new AntigravityUsageParseError();
  }

  if (
    normalize(usage.status) !== "success" ||
    usage.num_turns !== 0 ||
    !["usage", "/usage"].includes(normalize(usage.command.name))
  ) {
    throw new AntigravityUsageParseError();
  }

  const seenGroups = new Set<GroupKind>();
  const seenWindows = new Set<string>();
  const quotaWindows = usage.command.data.groups.flatMap((group) => {
    const groupKind = parseGroup(group.name);
    if (seenGroups.has(groupKind)) {
      throw new AntigravityUsageParseError();
    }
    seenGroups.add(groupKind);

    return group.buckets.map((bucket) => {
      const windowKind = parseWindow(bucket.window);
      const key = `${groupKind}-${windowKind}`;
      if (seenWindows.has(key)) {
        throw new AntigravityUsageParseError();
      }
      seenWindows.add(key);
      return createQuotaWindow(groupKind, windowKind, bucket);
    });
  });

  const accountLabel = parseAccountLabel(parsedJson);

  return {
    quotaWindows,
    ...(accountLabel ? { accountLabel } : {}),
  };
}

export function parseAntigravityUsage(raw: string): QuotaWindow[] {
  return parseAntigravityUsageReport(raw).quotaWindows;
}

function parseGroup(value: string): GroupKind {
  switch (normalize(value)) {
    case "gemini models":
      return "gemini";
    case "claude and gpt models":
      return "claude-gpt";
    default:
      throw new AntigravityUsageParseError();
  }
}

function parseWindow(value: string): WindowKind {
  switch (normalize(value)) {
    case "weekly":
      return "weekly";
    case "5h":
      return "5h";
    default:
      throw new AntigravityUsageParseError();
  }
}

function createQuotaWindow(
  group: GroupKind,
  window: WindowKind,
  bucket: z.infer<typeof bucketSchema>,
): QuotaWindow {
  const groupLabel = group === "gemini" ? "Gemini" : "Claude/GPT";
  const windowLabel = window === "weekly" ? "Weekly" : "5h";
  return {
    id: `agy-${group}-${window}`,
    kind: window === "weekly" ? "model_weekly" : "five_hour",
    label: `${groupLabel} ${windowLabel}`,
    ...(bucket.remaining_fraction == null
      ? {}
      : {
          usedPercent:
            Math.round((1 - bucket.remaining_fraction) * 100),
        }),
    ...(bucket.reset_time == null ? {} : { resetsAt: bucket.reset_time }),
    source: "antigravity_cli",
    status: bucket.remaining_fraction == null ? "unavailable" : "fresh",
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
