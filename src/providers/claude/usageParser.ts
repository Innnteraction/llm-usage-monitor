import { stripVTControlCharacters } from "node:util";

export interface ClaudeParsedQuotaWindow {
  kind: "five_hour" | "weekly" | "model_weekly";
  label: string;
  usedPercent: number;
  resetsAt?: string;
}

export function parseClaudeUsageScreen(
  screen: string,
  now = new Date(),
): ClaudeParsedQuotaWindow[] {
  const lines = stripVTControlCharacters(screen)
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headers = lines.flatMap((line, index) => {
    const descriptor = classifyHeader(line);
    return descriptor ? [{ index, ...descriptor }] : [];
  });

  const parsed = headers.flatMap((header, position) => {
    const end = headers[position + 1]?.index ?? lines.length;
    const block = lines.slice(header.index, end);
    const usedPercent = parsePercent(block);
    if (usedPercent === undefined) {
      return [];
    }
    const resetsAt = parseReset(block, now);
    return [{
      kind: header.kind,
      label: header.label,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    }];
  });
  const unique = new Map<string, ClaudeParsedQuotaWindow>();
  for (const window of parsed) {
    const key = `${window.kind}:${window.label}`;
    const previous = unique.get(key);
    if (!previous || window.resetsAt || !previous.resetsAt) {
      unique.set(key, window);
    }
  }
  return [...unique.values()];
}

function classifyHeader(
  line: string,
): Pick<ClaudeParsedQuotaWindow, "kind" | "label"> | undefined {
  if (/\b(?:current\s+session|session\s+limit|5[\s-]*(?:h|hour)|five[\s-]*hour)\b/i.test(line)) {
    return { kind: "five_hour", label: "5h" };
  }
  if (!/\b(?:current\s+week|weekly|week(?:ly)?\s+limit)\b/i.test(line)) {
    return undefined;
  }
  const scope = line.match(/[([]\s*([^\])]+?)\s*[\])]/)?.[1]?.trim();
  if (!scope || /^(?:all\s+models?|overall)$/i.test(scope)) {
    return { kind: "weekly", label: "Weekly" };
  }
  return { kind: "model_weekly", label: `${scope} Weekly`.slice(0, 80) };
}

function parsePercent(lines: string[]): number | undefined {
  for (const line of lines) {
    const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    return /\b(?:left|remaining)\b/i.test(line) ? 100 - value : value;
  }
  return undefined;
}

function parseReset(lines: string[], now: Date): string | undefined {
  const reset = lines
    .map((line) => line.match(/\bresets?\s+(?:in\s+)?(.+)$/i)?.[1]?.trim())
    .find(Boolean);
  if (!reset) return undefined;

  const duration = parseDuration(reset);
  if (duration !== undefined) {
    return new Date(now.getTime() + duration).toISOString();
  }

  const normalized = reset
    .replace(/\bat\b/i, " ")
    .replace(/\s*\([A-Za-z_+-]+\/[A-Za-z_+/-]+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi,
      (_match, hour: string, minute: string | undefined, meridiem: string) =>
        `${hour}:${minute ?? "00"} ${meridiem}`,
    );
  const timeOnly = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (timeOnly) {
    const hour = toTwentyFourHour(Number(timeOnly[1]), timeOnly[3] ?? "");
    const minute = Number(timeOnly[2] ?? 0);
    if (hour === undefined || minute > 59) return undefined;
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }
  let parsed = Date.parse(normalized);
  if (Number.isNaN(parsed) && !/\b\d{4}\b/.test(normalized)) {
    parsed = Date.parse(`${normalized} ${now.getFullYear()}`);
  }
  if (Number.isNaN(parsed)) return undefined;
  if (parsed < now.getTime() - 86_400_000 && !/\b\d{4}\b/.test(normalized)) {
    parsed = Date.parse(`${normalized} ${now.getFullYear() + 1}`);
  }
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function toTwentyFourHour(hour: number, meridiem: string): number | undefined {
  if (hour < 1 || hour > 12) return undefined;
  return hour % 12 + (/^pm$/i.test(meridiem) ? 12 : 0);
}

function parseDuration(value: string): number | undefined {
  let totalMinutes = 0;
  let matched = false;
  for (const match of value.matchAll(/(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!unit) continue;
    totalMinutes += unit.startsWith("d")
      ? amount * 1_440
      : unit.startsWith("h")
        ? amount * 60
        : amount;
  }
  return matched ? totalMinutes * 60_000 : undefined;
}
