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

export const formatResetAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
