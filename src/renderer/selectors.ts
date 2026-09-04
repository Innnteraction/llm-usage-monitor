import type {
  ProviderSnapshot,
  QuotaWindow,
} from "../shared/index";

export const authKindNames = {
  subscription: "subscription",
  api_key: "API key",
  enterprise: "enterprise",
  unknown: "unknown auth",
} as const;

export const providerNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
};

export const compactProviderNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
};

export const sourceNames: Record<QuotaWindow["source"], string> = {
  codex_app_server: "Codex App Server",
  claude_cli: "Claude CLI",
  antigravity_cli: "Antigravity CLI",
  local_fixture: "Local fixture",
};

export const usageTone = (usedPercent?: number): "low" | "medium" | "high" => {
  if (usedPercent !== undefined && usedPercent >= 90) {
    return "high";
  }
  if (usedPercent !== undefined && usedPercent >= 70) {
    return "medium";
  }
  return "low";
};

export const formatUpdatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest("input, textarea, select, [contenteditable=true]") !== null ||
    target.closest("[contenteditable]") !== null);

export const providerErrorHelp: Record<NonNullable<ProviderSnapshot["error"]>["code"], string> = {
  not_installed: "CLI is not installed.",
  not_authenticated: "Sign in with the CLI to view quota.",
  workspace_trust_required: "Workspace trust confirmation required.",
  unsupported_output: "Unsupported CLI response format.",
  rate_limited: "Request limit reached.",
  network: "Check network connection.",
  timeout: "CLI request timed out.",
  process_failed: "CLI process execution failed.",
  unavailable: "Quota is currently unavailable.",
  unexpected: "An unexpected error occurred.",
};

export const formatLocalTokens = (value: number): string => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
};

export const exactLocalTokens = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);

export const formatLocalShortDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(
    new Date(value),
  );

export const formatLocalDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

export const formatLocalCalculatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

export const selectWindowsById = (
  windows: QuotaWindow[],
  ids: readonly string[],
): QuotaWindow[] =>
  ids.flatMap((id) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window ? [window] : [];
  });

export const selectDisplayWindows = (provider: ProviderSnapshot): QuotaWindow[] => {
  if (provider.providerId === "antigravity") {
    return selectWindowsById(provider.quotaWindows, [
      "agy-gemini-5h",
      "agy-gemini-weekly",
    ]);
  }
  const find = (kind: QuotaWindow["kind"]) =>
    provider.quotaWindows.find((window) => window.kind === kind);

  if (provider.providerId === "codex") {
    const weekly = find("weekly");
    return weekly ? [weekly] : [];
  }

  const primary = [find("five_hour"), find("weekly")].filter(
    (window): window is QuotaWindow => Boolean(window),
  );
  if (provider.providerId !== "claude") {
    return primary;
  }
  const fable = provider.quotaWindows.find(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );
  return fable ? [...primary, fable] : primary;
};

export const hasFableWindow = (provider: ProviderSnapshot): boolean =>
  provider.quotaWindows.some(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );

export const missingCoreLabels = (provider: ProviderSnapshot): string[] => {
  if (provider.providerId === "antigravity") return [];
  const expectedKinds: QuotaWindow["kind"][] =
    provider.providerId === "codex" ? ["weekly"] : ["five_hour", "weekly"];
  const displayedKinds = new Set(
    selectDisplayWindows(provider).map((window) => window.kind),
  );
  return expectedKinds
    .filter((kind) => !displayedKinds.has(kind))
    .map((kind) => (kind === "weekly" ? "7d" : "5h"));
};

export const selectAdditionalWindows = (
  provider: ProviderSnapshot,
  displayed: QuotaWindow[],
): QuotaWindow[] => {
  const displayedIds = new Set(displayed.map(({ id }) => id));
  const seenIds = new Set<string>();
  return provider.quotaWindows.filter((window) => {
    if (displayedIds.has(window.id) || seenIds.has(window.id)) {
      return false;
    }
    seenIds.add(window.id);
    if (
      provider.providerId === "codex" &&
      window.kind === "model_weekly" &&
      window.label.trim().toLowerCase() === "gpt-reserve weekly"
    ) {
      return false;
    }
    if (provider.providerId !== "codex") return true;
    return (
      window.kind === "model_weekly" ||
      (window.kind === "other" && window.id.startsWith("codex-limit-"))
    );
  });
};
