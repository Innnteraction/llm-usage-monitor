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

export function parseAntigravityUsage(raw: string): QuotaWindow[] {
  let usage: z.infer<typeof usageSchema>;
  try {
    usage = usageSchema.parse(JSON.parse(raw));
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
  return usage.command.data.groups.flatMap((group) => {
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
            Math.round((1 - bucket.remaining_fraction) * 100 * 10) / 10,
        }),
    ...(bucket.reset_time == null ? {} : { resetsAt: bucket.reset_time }),
    source: "antigravity_cli",
    status: bucket.remaining_fraction == null ? "unavailable" : "fresh",
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
