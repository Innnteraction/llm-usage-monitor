export const formatQuotaCountdown = (
  resetsAt: string | undefined,
  now: number,
): string => {
  if (!resetsAt) return "--";

  const remainingMinutes = Math.max(
    0,
    Math.floor((new Date(resetsAt).getTime() - now) / 60_000),
  );
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const isResetPending = (
  resetsAt: string | undefined,
  now: number,
): boolean =>
  resetsAt !== undefined && new Date(resetsAt).getTime() <= now;

export const formatCompactCountdown = (
  resetsAt: string | undefined,
  now: number,
): string => {
  if (!resetsAt) return "--";

  const remainingMinutes = Math.max(
    0,
    Math.floor((new Date(resetsAt).getTime() - now) / 60_000),
  );
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;

  const pad = (val: number): string => String(val).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m`;
};

export const formatPercent = (value?: number): string => {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const rounded = Math.max(0, Math.round(value));
  return `${String(rounded).padStart(2, "0")}%`;
};

export const formatCompactWindowLabel = (window: {
  id?: string;
  kind: string;
  label: string;
}): string => {
  if (window.id === "agy-gemini-5h" || window.kind === "five_hour") {
    return "5h";
  }
  if (window.id === "agy-gemini-weekly" || window.kind === "weekly") {
    return "7d";
  }
  if (/\bfable\b/i.test(window.label)) {
    return "fable";
  }
  if (window.kind === "model_weekly") {
    return window.label.replace(/\s+Weekly$/i, "").toLowerCase();
  }
  return window.label;
};

export const formatResetAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

export type TooltipRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TooltipSize = {
  width: number;
  height: number;
};

export const placeTooltip = ({
  anchor,
  tooltip,
  viewport,
  footerTop,
  preferAbove = false,
  gap = 6,
  margin = 20,
}: {
  anchor: TooltipRect;
  tooltip: TooltipSize;
  viewport: { width: number; height: number };
  footerTop?: number;
  preferAbove?: boolean;
  gap?: number;
  margin?: number;
}): { left: number; top: number; maxHeight: number; placement: "above" | "below" } => {
  const { width, height } = tooltip;
  const protectedBottom = Math.min(viewport.height - margin, (footerTop ?? viewport.height) - gap);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  const belowTop = anchor.bottom + gap;
  const fitsBelow = belowTop + height <= protectedBottom;
  const aboveTop = anchor.top - gap - height;
  const fitsAbove = aboveTop >= margin;
  const placement = fitsBelow && !(preferAbove && fitsAbove) ? "below" : "above";
  const top = placement === "below"
    ? belowTop
    : Math.max(margin, Math.min(aboveTop, protectedBottom - height));
  const maxHeight = Math.max(0, protectedBottom - top);

  return { left, top, maxHeight, placement };
};
