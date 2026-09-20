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

export const getWindowDurationMs = (kind: string): number => {
  switch (kind) {
    case "five_hour":
      return 5 * 60 * 60 * 1000;
    case "weekly":
    case "model_weekly":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 5 * 60 * 60 * 1000;
  }
};

export const getResetElapsedPercent = (
  resetsAt: string | undefined,
  now: number,
  kind: string,
): number | undefined => {
  if (!resetsAt) return undefined;
  const resetTime = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return undefined;
  if (resetTime <= now) return 100;

  const remainingMs = resetTime - now;
  const durationMs = getWindowDurationMs(kind);
  const elapsedMs = durationMs - remainingMs;
  const percent = (elapsedMs / durationMs) * 100;
  return Math.min(100, Math.max(0, percent));
};

export interface ResetCountdownStyle {
  backgroundImage: string;
  backgroundSize: string;
  WebkitBackgroundClip: string;
  backgroundClip: string;
  WebkitTextFillColor: string;
  animation: string;
  filter?: string;
}

export const getResetCountdownStyle = (
  resetsAt: string | undefined,
  now: number,
  kind: string,
  theme?: "light" | "dark",
): ResetCountdownStyle | undefined => {
  const elapsed = getResetElapsedPercent(resetsAt, now, kind);
  if (elapsed === undefined || elapsed >= 100) return undefined;

  const resolvedTheme: "light" | "dark" =
    theme ??
    (typeof document !== "undefined" &&
    document.documentElement?.dataset?.theme === "light"
      ? "light"
      : "dark");

  const isFiveHour = kind === "five_hour";
  const isLight = resolvedTheme === "light";
  const baseStyle = {
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };

  if (elapsed < 75) {
    const speed = isFiveHour ? 5.5 : 8.5;
    const bg = isLight
      ? "linear-gradient(90deg, #64748b 0%, #64748b 25%, #334155 40%, #0f172a 50%, #334155 60%, #64748b 75%, #64748b 100%)"
      : "linear-gradient(90deg, #7c7c7c 0%, #7c7c7c 25%, #9e9e9e 40%, #c4c4c4 50%, #9e9e9e 60%, #7c7c7c 75%, #7c7c7c 100%)";
    return {
      ...baseStyle,
      backgroundImage: bg,
      animation: `smooth-shimmer-flow ${speed}s linear infinite`,
    };
  }

  if (elapsed < 88) {
    const fillEnd = Math.round(elapsed);
    const speed = isFiveHour ? 4.2 : 6.0;
    const bg = isLight
      ? `linear-gradient(90deg, #64748b 0%, #b45309 ${fillEnd * 0.4}%, #78350f ${fillEnd - 4}%, #d97706 ${fillEnd}%, #64748b ${fillEnd + 5}%, #64748b 100%)`
      : `linear-gradient(90deg, #707070 0%, #ffe9b8 ${fillEnd * 0.4}%, #ffffff ${fillEnd - 4}%, #e2b070 ${fillEnd}%, #707070 ${fillEnd + 5}%, #707070 100%)`;
    return {
      ...baseStyle,
      backgroundImage: bg,
      animation: `smooth-shimmer-flow ${speed}s linear infinite`,
    };
  }

  if (elapsed < 98) {
    const speed = isFiveHour
      ? 2.5 - ((elapsed - 88) / 10) * 0.7
      : 4.15 - ((elapsed - 88) / 10) * 1.05;
    const bg = isLight
      ? "linear-gradient(90deg, #c026d3 0%, #ea580c 16%, #ca8a04 33%, #16a34a 50%, #0284c7 66%, #7c3aed 83%, #c026d3 100%)"
      : "linear-gradient(90deg, #f49ac2 0%, #fbb489 16%, #fef3a3 33%, #a8e6cf 50%, #a0e0fc 66%, #c3b1e1 83%, #f49ac2 100%)";
    return {
      ...baseStyle,
      backgroundImage: bg,
      animation: `pastel-rainbow-flow ${speed.toFixed(2)}s linear infinite`,
      filter: isLight ? undefined : "drop-shadow(0 0 3px rgba(244, 154, 194, 0.25))",
    };
  }

  const speed = isFiveHour ? 1.1 : 1.8;
  return {
    ...baseStyle,
    backgroundImage:
      "linear-gradient(90deg, #ff1955 0%, #ff8c00 17%, #ffdc00 33%, #00e678 50%, #00dcff 67%, #8c4bff 83%, #ff1955 100%)",
    animation: `pastel-rainbow-flow ${speed}s linear infinite`,
    filter: isLight
      ? "drop-shadow(0 0 3px rgba(255, 25, 85, 0.35))"
      : "drop-shadow(0 0 5px rgba(255, 25, 85, 0.5)) drop-shadow(0 0 10px rgba(0, 220, 255, 0.35))",
  };
};

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
  placementPreference = "auto",
  gap = 6,
  margin = 20,
}: {
  anchor: TooltipRect;
  tooltip: TooltipSize;
  viewport: { width: number; height: number };
  footerTop?: number;
  preferAbove?: boolean;
  placementPreference?: "auto" | "right" | "below" | "above";
  gap?: number;
  margin?: number;
}): { left: number; top: number; maxHeight: number; placement: "above" | "below" | "right" } => {
  const { width, height } = tooltip;
  const protectedBottom = Math.min(viewport.height - margin, (footerTop ?? viewport.height) - gap);

  if (placementPreference === "right") {
    const rawLeft = anchor.right + gap;
    const fitsRight = rawLeft + width <= viewport.width - margin;
    const left = fitsRight
      ? rawLeft
      : Math.max(margin, viewport.width - margin - width);
    const top = Math.max(
      margin,
      Math.min(anchor.top, protectedBottom - height),
    );
    const maxHeight = Math.max(0, protectedBottom - top);
    return { left, top, maxHeight, placement: "right" };
  }

  let left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  const belowTop = anchor.bottom + gap;
  const fitsBelow = belowTop + height <= protectedBottom;
  const aboveTop = anchor.top - gap - height;
  const fitsAbove = aboveTop >= margin;
  const placement = fitsBelow && !(preferAbove && fitsAbove) ? "below" : "above";
  const top = placement === "below"
    ? belowTop
    : Math.max(margin, Math.min(aboveTop, protectedBottom - height));

  const overlapsAnchorY = top < anchor.bottom && top + height > anchor.top;
  if (overlapsAnchorY) {
    const rightDislodged = anchor.right + gap;
    if (rightDislodged + width <= viewport.width - margin) {
      left = rightDislodged;
    }
  }

  const maxHeight = Math.max(0, protectedBottom - top);

  return { left, top, maxHeight, placement };
};
