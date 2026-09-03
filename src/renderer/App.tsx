import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AppSnapshot,
  ClaudeSetupAction,
  LocalTokenUsage,
  ProviderSnapshot,
  QuotaWindow,
} from "../shared/index";
import {
  formatQuotaCountdown,
  formatCompactCountdown,
  formatCompactWindowLabel,
  formatResetAt,
  isResetPending,
  placeTooltip,
} from "./presentation";

const authKindNames = {
  subscription: "subscription",
  api_key: "API key",
  enterprise: "enterprise",
  unknown: "unknown auth",
} as const;

const providerNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
};

const compactProviderNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
};

const sourceNames: Record<QuotaWindow["source"], string> = {
  codex_app_server: "Codex App Server",
  claude_cli: "Claude CLI",
  antigravity_cli: "Antigravity CLI",
  local_fixture: "Local fixture",
};

const usageTone = (usedPercent?: number): "low" | "medium" | "high" => {
  if (usedPercent !== undefined && usedPercent >= 90) {
    return "high";
  }
  if (usedPercent !== undefined && usedPercent >= 70) {
    return "medium";
  }
  return "low";
};

const formatUpdatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest("input, textarea, select, [contenteditable=true]") !== null ||
    target.closest("[contenteditable]") !== null);

const providerErrorHelp: Record<NonNullable<ProviderSnapshot["error"]>["code"], string> = {
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

const exactLocalTokens = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);
const formatLocalShortDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(
    new Date(value),
  );
const formatLocalDate = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
const formatLocalCalculatedAt = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const HelpTrigger = ({
  id,
  label,
  value,
  description,
  tone = "neutral",
  className,
  testId,
  activeHelp,
  onActiveHelpChange,
  onClick,
  ariaLabel,
  ariaPressed,
  ariaKeyshortcuts,
  disabled,
}: {
  id: string;
  label: string;
  value?: string;
  description: ReactNode;
  tone?: "neutral" | "input" | "output" | "cache" | "partial";
  className?: string;
  testId?: string;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  onClick?: () => void;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaKeyshortcuts?: string;
  disabled?: boolean;
}) => {
  const tooltipId = `${id}-tooltip`;
  const isOpen = activeHelp === id;
  const helpRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const activeHelpRef = useRef<string | undefined>(undefined);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();
  useEffect(() => {
    activeHelpRef.current = activeHelp;
  }, [activeHelp]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !tooltipRef.current) return;

    const updatePosition = (closeWhenHidden = false): void => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tooltipElement = tooltipRef.current;
      if (!anchor || !tooltipElement) return;
      const providerList = document.querySelector<HTMLElement>(".provider-list");
      const listBounds = providerList?.getBoundingClientRect();
      if (
        closeWhenHidden &&
        providerList?.contains(buttonRef.current) &&
        listBounds &&
        (anchor.bottom <= listBounds.top || anchor.top >= listBounds.bottom)
      ) {
        onActiveHelpChange(undefined);
        return;
      }
      const previousMaxHeight = tooltipElement.style.maxHeight;
      tooltipElement.style.maxHeight = "none";
      const tooltipBounds = tooltipElement.getBoundingClientRect();
      const tooltipStyle = getComputedStyle(tooltipElement);
      const naturalHeight = Math.max(
        tooltipBounds.height,
        tooltipElement.scrollHeight +
          Number.parseFloat(tooltipStyle.borderTopWidth) +
          Number.parseFloat(tooltipStyle.borderBottomWidth),
      );
      tooltipElement.style.maxHeight = previousMaxHeight;
      const footerTop = document.querySelector<HTMLElement>(".app-footer")?.getBoundingClientRect().top;
      let next = placeTooltip({
        anchor,
        tooltip: { width: tooltipBounds.width, height: naturalHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        footerTop,
      });
      const overlapsAnotherTrigger = next.placement === "below" &&
        [...document.querySelectorAll<HTMLElement>(".local-token-trigger")].some(
          (trigger) => {
            if (trigger === buttonRef.current) return false;
            const bounds = trigger.getBoundingClientRect();
            return bounds.left < next.left + tooltipBounds.width &&
              bounds.right > next.left &&
              bounds.top < next.top + naturalHeight &&
              bounds.bottom > next.top;
          },
        );
      if (overlapsAnotherTrigger) {
        next = placeTooltip({
          anchor,
          tooltip: { width: tooltipBounds.width, height: naturalHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          footerTop,
          preferAbove: true,
        });
      }
      setTooltipStyle({ left: next.left, top: next.top, maxHeight: next.maxHeight });
    };

    updatePosition();
    const providerList = document.querySelector<HTMLElement>(".provider-list");
    const closeIfScrolledOut = (): void => updatePosition(true);
    providerList?.addEventListener("scroll", closeIfScrolledOut, true);
    const reposition = (): void => updatePosition();
    window.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    observer.observe(buttonRef.current);
    observer.observe(tooltipRef.current);
    return () => {
      providerList?.removeEventListener("scroll", closeIfScrolledOut, true);
      window.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [description, isOpen, onActiveHelpChange]);
  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    onActiveHelpChange(id);
  };
  const closeLater = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (
        activeHelpRef.current === id &&
        !helpRef.current?.contains(document.activeElement) &&
        !helpRef.current?.matches(":hover")
      ) {
        onActiveHelpChange(undefined);
      }
    }, 400);
  };
  return (
    <span
      ref={helpRef}
      className={`local-token-help tone-${tone}${className ? ` ${className}` : ""}`}
      onMouseEnter={show}
      onMouseLeave={closeLater}
    >
      <button
        ref={buttonRef}
        type="button"
        className="local-token-trigger"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        aria-keyshortcuts={ariaKeyshortcuts}
        aria-describedby={isOpen ? tooltipId : undefined}
        disabled={disabled}
        onClick={() => {
          if (onClick) {
            onClick();
          } else {
            show();
          }
        }}
        onFocus={show}
        onBlur={closeLater}
      >
        <span>{label}</span>
        {value ? <strong>{value}</strong> : null}
      </button>
      {isOpen ? (
        <span
          ref={tooltipRef}
          id={tooltipId}
          className="local-token-tooltip"
          role="tooltip"
          style={tooltipStyle}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
};

const LocalUsage = ({
  providerId,
  usage,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  usage: LocalTokenUsage | undefined;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  if (!usage) return <span className="local-usage">this PC calculating</span>;
  if (usage.scannedFileCount === 0 && !usage.partial)
    return <span className="local-usage">this PC no local logs</span>;
  const id = (kind: string): string => `${providerId}-local-${kind}`;
  const observed = usage.observedFrom
    ? formatLocalShortDate(usage.observedFrom)
    : "unavailable";
  const help = (
    kind: string,
    label: string,
    value: string | undefined,
    description: string,
    tone?: "neutral" | "input" | "output" | "cache" | "partial",
  ) => (
    <HelpTrigger
      id={id(kind)}
      label={label}
      value={value}
      description={description}
      tone={tone}
      testId={id(kind)}
      activeHelp={activeHelp}
      onActiveHelpChange={onActiveHelpChange}
    />
  );
  return (
    <div className="local-usage" aria-label="Local tokens detail for this PC">
      <div className="local-usage-row">
        {help(
          "scope",
          "this PC",
          undefined,
          "Cumulative tokens from local logs remaining on this PC. Not account-wide or 5h/7d quota window values.",
        )}
        {help(
          "total",
          "total",
          formatLocalTokens(usage.totalTokens),
          `Unabbreviated total: ${exactLocalTokens(usage.totalTokens)} tokens. total = input + output (cache tokens not added twice). K=1,000, M=1,000,000, B=1,000,000,000.`,
        )}
        {help(
          "since",
          "since",
          observed,
          usage.observedFrom
            ? `Earliest event observed in local logs: ${formatLocalDate(usage.observedFrom)}. Not a quota reset or subscription start date. Calculated at: ${formatLocalCalculatedAt(usage.calculatedAt)}.`
            : `Earliest observed event date not provided. Calculated at: ${formatLocalCalculatedAt(usage.calculatedAt)}.`,
        )}
        {usage.partial
          ? help(
              "partial",
              "partial",
              String(usage.failedFileCount),
              `Verified partial total. ${exactLocalTokens(usage.failedFileCount)} file(s) had read or record processing issues. Will retry on next scan.`,
              "partial",
            )
          : null}
      </div>
      <div className="local-usage-row">
        {help(
          "input",
          "input",
          formatLocalTokens(usage.inputTokens),
          `Exact input: ${exactLocalTokens(usage.inputTokens)} tokens. Input tokens delivered to the model, including cache tokens.`,
          "input",
        )}
        {help(
          "output",
          "output",
          formatLocalTokens(usage.outputTokens),
          `Exact output: ${exactLocalTokens(usage.outputTokens)} tokens. Output tokens generated by the model.`,
          "output",
        )}
        {help(
          "cache-read",
          "cache read",
          usage.cacheReadTokens === undefined ? "--" : formatLocalTokens(usage.cacheReadTokens),
          usage.cacheReadTokens === undefined ? "Cache read value not provided." : `Exact cache read: ${exactLocalTokens(usage.cacheReadTokens)} tokens. Reused cache input tokens, already included in input.`,
          "cache",
        )}
        {help(
          "cache-write",
          "cache write",
          usage.cacheWriteTokens === undefined ? "--" : formatLocalTokens(usage.cacheWriteTokens),
          usage.cacheWriteTokens === undefined ? "Cache write value not provided." : `Exact cache write: ${exactLocalTokens(usage.cacheWriteTokens)} tokens. Newly written cache input tokens, already included in input.`,
          "cache",
        )}
      </div>
    </div>
  );
};

const selectDisplayWindows = (provider: ProviderSnapshot): QuotaWindow[] => {
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

const selectWindowsById = (
  windows: QuotaWindow[],
  ids: readonly string[],
): QuotaWindow[] =>
  ids.flatMap((id) => {
    const window = windows.find((candidate) => candidate.id === id);
    return window ? [window] : [];
  });

const hasFableWindow = (provider: ProviderSnapshot): boolean =>
  provider.quotaWindows.some(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );

const missingCoreLabels = (provider: ProviderSnapshot): string[] => {
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

const selectAdditionalWindows = (
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

const Quota = ({
  providerId,
  window,
  displayLabel,
  now,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  window: QuotaWindow;
  displayLabel?: string;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const used = window.usedPercent;
  const unavailable = used === undefined || window.status === "unavailable";
  const remaining = used === undefined ? undefined : 100 - used;
  const tone = usageTone(used);
  const resetPending = isResetPending(window.resetsAt, now);
  const identity = displayLabel ? `${window.label}: ` : "";
  const label = displayLabel ?? (window.kind === "weekly"
      ? "7d"
      : window.kind === "model_weekly"
        ? window.label.replace(/\s+Weekly$/i, "")
        : window.label);

  return (
    <section className={`quota${unavailable ? " quota-not-provided" : ""}`}>
      <strong className="quota-label">{label}</strong>
      {unavailable ? (
        <span className="quota-not-provided-text">not provided</span>
      ) : (
        <>
          <progress
            className={`quota-meter tone-${tone}`}
            max={100}
            value={used}
            aria-label={`${window.label} usage`}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-usage`}
            label={`${used}%`}
            description={`${identity}Used ${used}%, remaining ${remaining}%.`}
            className={`quota-value tone-${tone}`}
            testId={`${providerId}-${window.kind}-value`}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-reset`}
            label={
              resetPending
                ? "reset pending"
                : `resets ${formatQuotaCountdown(window.resetsAt, now)}`
            }
            description={
              resetPending
                ? `${identity}Reset pending verification: local reset time is ${formatResetAt(window.resetsAt!)}. Retaining last quota until next provider refresh.`
                : window.resetsAt
                  ? `${identity}Local reset time: ${formatResetAt(window.resetsAt)}.`
                  : `${identity}Reset time not provided.`
            }
            className="quota-reset"
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </>
      )}
      {!unavailable && remaining !== undefined ? (
        <span className="quota-remaining">{`${remaining}% remaining`}</span>
      ) : null}
    </section>
  );
};

const CompactQuotaTable = ({
  providers,
  now,
}: {
  providers: ProviderSnapshot[];
  now: number;
}) => {
  return (
    <div className="compact-table" role="table" aria-label="Compact quota summary">
      {providers.map((provider) => {
        const windows = selectDisplayWindows(provider);
        const weeklyWindow =
          provider.providerId === "antigravity"
            ? provider.quotaWindows.find((w) => w.id === "agy-gemini-weekly") ??
              provider.quotaWindows.find((w) => w.kind === "weekly")
            : provider.quotaWindows.find((w) => w.kind === "weekly");
        const weeklyUsed = weeklyWindow?.usedPercent;
        const weeklyTone = usageTone(weeklyUsed);

        const usedPercents = windows.map((w) =>
          w.usedPercent !== undefined ? `${w.usedPercent}%` : "--",
        );
        const windowLabels = windows.map((w) => formatCompactWindowLabel(w));
        const resets = windows.map((w) =>
          formatCompactCountdown(w.resetsAt, now),
        );

        return (
          <div key={provider.providerId} className="compact-row" role="row">
            <span className="compact-name">
              <span
                className={`status-dot status-${provider.status}`}
                aria-hidden="true"
              >
                ●
              </span>
              {compactProviderNames[provider.providerId]}
            </span>
            <div className="compact-gauge-cell">
              {weeklyUsed === undefined || weeklyWindow?.status === "unavailable" ? (
                <span className="quota-not-provided-text">--</span>
              ) : (
                <progress
                  className={`quota-meter tone-${weeklyTone}`}
                  max={100}
                  value={weeklyUsed}
                  title={`Weekly limit (${formatCompactCountdown(weeklyWindow?.resetsAt, now)}): ${weeklyUsed}%`}
                />
              )}
            </div>
            <span className="compact-percent">
              {usedPercents.length > 0 ? usedPercents.join("/") : "--"}
            </span>
            <span className="compact-window">
              {windowLabels.length > 0 ? windowLabels.join("/") : "--"}
            </span>
            <span className="compact-reset">
              {resets.length > 0 ? resets.join("/") : "--"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const ProviderCard = ({
  provider,
  index,
  onOpenClaudeSetup,
  now,
  activeHelp,
  onActiveHelpChange,
  tokensVisible,
}: {
  provider: ProviderSnapshot;
  index: number;
  onOpenClaudeSetup(action: ClaudeSetupAction): void;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  tokensVisible: boolean;
}) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  if (provider.providerId === "antigravity" && sources.length === 0) {
    sources.push("Antigravity CLI");
  }
  const primaryWindows = selectDisplayWindows(provider);
  const missingCores = missingCoreLabels(provider);
  const additionalWindows = selectAdditionalWindows(provider, primaryWindows);
  const additionalWindowCount = additionalWindows.length;
  const [additionalExpanded, setAdditionalExpanded] = useState(false);
  const additionalId = `${provider.providerId}-additional-limits`;
  const setupAction =
    provider.providerId !== "claude"
      ? undefined
      : provider.error?.code === "not_authenticated"
        ? "login"
        : provider.error?.code === "workspace_trust_required"
          ? "trust_probe"
          : undefined;
  return (
    <article className="provider-card">
      <header>
        <span className="provider-index">{index + 1}</span>
        <div className="provider-title">
          <h2>{providerNames[provider.providerId]}</h2>
          {provider.accountLabel ? (
            <HelpTrigger
              id={`${provider.providerId}-account`}
              label={provider.accountLabel}
              className="account-label"
              description={`Account identifier provided by ${providerNames[provider.providerId]} CLI: ${provider.accountLabel}. Kept in memory only.`}
              activeHelp={activeHelp}
              onActiveHelpChange={onActiveHelpChange}
            />
          ) : null}
          {provider.providerId === "claude" && provider.authKind ? (
            <span className="account-client">
              CLI/{authKindNames[provider.authKind]}
            </span>
          ) : null}
        </div>
        <span className={`status status-${provider.status}`}>
          <span aria-hidden="true">●</span> {provider.status}
        </span>
      </header>
      {provider.error ? (
        <div className="provider-error-row" role="status">
          <p className="provider-error">
            {providerErrorHelp[provider.error.code]}
            {provider.status === "stale"
              ? ` Last successful ${formatUpdatedAt(provider.lastSuccessfulAt ?? provider.fetchedAt)}.`
              : ""}
          </p>
          {setupAction ? (
            <button
              type="button"
              className="setup-action"
              onClick={() => onOpenClaudeSetup(setupAction)}
            >
              {setupAction === "login" ? "sign in" : "prepare folder"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="quota-grid">
        {primaryWindows.map((window) => (
          <Quota
            key={window.id}
            providerId={provider.providerId}
            window={window}
            displayLabel={
              provider.providerId === "antigravity"
                ? window.id === "agy-gemini-weekly"
                  ? "7d"
                  : "5h"
                : undefined
            }
            now={now}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        ))}
        {missingCores.map((label) => (
          <p className="quota-unavailable" key={`missing-${label}`}>
            <strong>{label}</strong>
            <span>not provided</span>
          </p>
        ))}
        {provider.providerId === "antigravity" && provider.quotaWindows.length === 0 ? (
          <p className="quota-unavailable">
            <strong>Quota</strong>
            <span>not provided</span>
          </p>
        ) : null}
        {provider.providerId === "claude" && !hasFableWindow(provider) ? (
          <p className="quota-unavailable">
            <strong>Fable</strong>
            <span>not provided by Claude CLI</span>
          </p>
        ) : null}
      </div>
      {additionalWindowCount > 0 ? (
        <div className="additional-limits">
          <button
            type="button"
            aria-controls={additionalId}
            aria-expanded={additionalExpanded}
            onClick={() => setAdditionalExpanded((expanded) => !expanded)}
          >
            +{additionalWindowCount} additional limits
          </button>
          {additionalExpanded ? (
            <div id={additionalId} className="additional-quota-grid">
              {provider.providerId === "antigravity" ? (
                <AntigravityAdditionalQuotas
                  providerId={provider.providerId}
                  windows={additionalWindows}
                  now={now}
                  activeHelp={activeHelp}
                  onActiveHelpChange={onActiveHelpChange}
                />
              ) : additionalWindows.map((window) => (
                <div className="additional-quota" key={window.id}>
                  <h3>{window.label}</h3>
                  <Quota
                    providerId={provider.providerId}
                    window={window}
                    now={now}
                    activeHelp={activeHelp}
                    onActiveHelpChange={onActiveHelpChange}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <footer>
        {tokensVisible && provider.providerId !== "antigravity" ? (
          <LocalUsage
            providerId={provider.providerId}
            usage={provider.localUsage}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        ) : null}
        <span>source {sources.join(", ")}</span>
        <span>
          updated{" "}
          {formatUpdatedAt(
            provider.status === "stale"
              ? (provider.lastSuccessfulAt ?? provider.fetchedAt)
              : provider.fetchedAt,
          )}
        </span>
      </footer>
    </article>
  );
};

const AntigravityAdditionalQuotas = ({
  providerId,
  windows,
  now,
  activeHelp,
  onActiveHelpChange,
}: {
  providerId: ProviderSnapshot["providerId"];
  windows: QuotaWindow[];
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const sharedWindows = selectWindowsById(windows, [
    "agy-claude-gpt-5h",
    "agy-claude-gpt-weekly",
  ]);
  const sharedIds = new Set(sharedWindows.map(({ id }) => id));
  return (
    <>
      {sharedWindows.length > 0 ? (
        <div className="additional-quota-group">
          <h3>Claude/GPT</h3>
          <div className="additional-quota-rows">
            {sharedWindows.map((window) => (
              <Quota
                key={window.id}
                providerId={providerId}
                window={window}
                displayLabel={
                  window.id === "agy-claude-gpt-weekly" ? "7d" : "5h"
                }
                now={now}
                activeHelp={activeHelp}
                onActiveHelpChange={onActiveHelpChange}
              />
            ))}
          </div>
        </div>
      ) : null}
      {windows.filter(({ id }) => !sharedIds.has(id)).map((window) => (
        <div className="additional-quota" key={window.id}>
          <h3>{window.label}</h3>
          <Quota
            providerId={providerId}
            window={window}
            now={now}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </div>
      ))}
    </>
  );
};

export const App = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [error, setError] = useState(false);
  const [activeHelp, setActiveHelp] = useState<string>();
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [compactMode, setCompactMode] = useState(false);
  const [tokensVisible, setTokensVisible] = useState(false);
  const [tokenVisibilityPending, setTokenVisibilityPending] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [themeOverride, setThemeOverride] = useState<"light" | "dark">();
  const previousSnapshot = useRef<AppSnapshot | undefined>(undefined);
  const tokenVisibilityInFlight = useRef(false);
  const appShellRef = useRef<HTMLElement>(null);
  const providerListRef = useRef<HTMLElement>(null);
  const providerListContentRef = useRef<HTMLDivElement>(null);
  const appHeaderRef = useRef<HTMLElement>(null);
  const appFooterRef = useRef<HTMLElement>(null);
  const resizeFrame = useRef<number | undefined>(undefined);
  const lastWindowSizeRequest = useRef<string | undefined>(undefined);
  const effectiveTheme = themeOverride ?? systemTheme;

  const toggleCompactMode = useCallback((): void => {
    setActiveHelp(undefined);
    setCompactMode((prev) => !prev);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (): void => {
      if (!themeOverride) setSystemTheme(media.matches ? "dark" : "light");
    };
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [themeOverride]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  const toggleTokenVisibility = useCallback((): void => {
    if (tokenVisibilityInFlight.current) return;
    const visible = !tokensVisible;
    tokenVisibilityInFlight.current = true;
    setTokenVisibilityPending(true);
    setDisplayError("");
    setActiveHelp(undefined);
    setTokensVisible(visible);
  }, [tokensVisible]);

  useLayoutEffect(() => {
    const shell = appShellRef.current;
    const providerList = providerListRef.current;
    const content = providerListContentRef.current;
    const header = appHeaderRef.current;
    const footer = appFooterRef.current;
    if (!shell || !providerList || !content || !header || !footer) return;
    let active = true;

    const requestSize = (): void => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      resizeFrame.current = window.requestAnimationFrame(() => {
        const shellBounds = shell.getBoundingClientRect();
        const listBounds = providerList.getBoundingClientRect();
        const footerBounds = footer.getBoundingClientRect();
        const shellStyle = getComputedStyle(shell);
        const contentHeight = Math.min(
          4096,
          Math.ceil(
            listBounds.top - shellBounds.top +
              content.scrollHeight +
              footerBounds.height +
              Number.parseFloat(shellStyle.paddingBottom) +
              4,
          ),
        );
        const requestKey = `${compactMode}:${tokensVisible}:${contentHeight}`;
        if (lastWindowSizeRequest.current === requestKey) return;
        lastWindowSizeRequest.current = requestKey;
        void window.usageMonitor
          .setTokensVisible(tokensVisible, contentHeight)
          .catch(() => {
            if (active) setDisplayError("Failed to adjust window height.");
          })
          .finally(() => {
            if (active) {
              tokenVisibilityInFlight.current = false;
              setTokenVisibilityPending(false);
            }
          });
      });
    };

    requestSize();
    const observer = new ResizeObserver(requestSize);
    observer.observe(content);
    observer.observe(header);
    observer.observe(footer);
    return () => {
      active = false;
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      observer.disconnect();
    };
  }, [compactMode, displayError, error, tokensVisible]);

  useEffect(() => {
    const updateClock = (): void => setNow(Date.now());
    const handleWindowFocus = (): void => {
      updateClock();
      setActiveHelp(undefined);
    };
    const timer = window.setInterval(updateClock, 30_000);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    const closeHelp = (): void => setActiveHelp(undefined);
    window.addEventListener("blur", closeHelp);
    document.addEventListener("visibilitychange", closeHelp);
    return () => {
      window.removeEventListener("blur", closeHelp);
      document.removeEventListener("visibilitychange", closeHelp);
    };
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setActiveHelp(undefined);
        return;
      }
      if (
        event.repeat ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      if (event.code === "KeyC") {
        event.preventDefault();
        toggleCompactMode();
      } else if (event.code === "KeyT") {
        event.preventDefault();
        toggleTokenVisibility();
      } else if (event.code === "KeyL") {
        event.preventDefault();
        setActiveHelp(undefined);
        setThemeOverride(effectiveTheme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [effectiveTheme, toggleCompactMode, toggleTokenVisibility]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.usageMonitor.subscribe((next) => {
      if (active) {
        setSnapshot(next);
        const previous = previousSnapshot.current;
        if (previous?.refreshing.length && !next.refreshing.length) {
          setNotice(
            next.providers.some((provider) => provider.error)
              ? "Refresh failed: keeping last known quota."
              : "Quota refreshed.",
          );
        }
        if (!next.providers.some((provider) => provider.error)) setError(false);
        previousSnapshot.current = next;
      }
    });
    void window.usageMonitor
      .getState()
      .then((next) => {
        if (active) {
          setSnapshot(next);
          previousSnapshot.current = next;
          setNotice("Quota loaded.");
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setNotice("Failed to load quota.");
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = (): void => {
    setError(false);
    setNotice("");
    void window.usageMonitor.refresh().catch(() => setError(true));
  };

  const toggleTheme = (): void => {
    setActiveHelp(undefined);
    setThemeOverride(effectiveTheme === "dark" ? "light" : "dark");
  };

  const openClaudeSetup = (action: ClaudeSetupAction): void => {
    setError(false);
    void window.usageMonitor
      .openClaudeSetup(action)
      .then(({ opened }) => {
        if (!opened) {
          setError(true);
        }
      })
      .catch(() => setError(true));
  };

  return (
    <main ref={appShellRef} className="app-shell">
      <header ref={appHeaderRef} className="app-header">
        <h1>watching quota providers</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={!snapshot || snapshot.refreshing.length > 0}
        >
          {snapshot?.refreshing.length ? "refreshing..." : "refresh"}
        </button>
      </header>

      {error ? (
        <p className="error-banner" role="alert">
          Failed to refresh quota. Retaining last known values.
        </p>
      ) : null}

      {displayError ? (
        <p className="display-error" role="alert">
          {displayError}
        </p>
      ) : null}

      <p className="update-notice" role="status" aria-live="polite">
        {notice}
      </p>

      <section ref={providerListRef} className="provider-list">
        <div ref={providerListContentRef} className="provider-list-content">
          {snapshot ? (
            compactMode ? (
              <CompactQuotaTable providers={snapshot.providers} now={now} />
            ) : (
              snapshot.providers.map((provider, index) => (
                <ProviderCard
                  key={provider.providerId}
                  provider={provider}
                  index={index}
                  onOpenClaudeSetup={openClaudeSetup}
                  now={now}
                  activeHelp={activeHelp}
                  onActiveHelpChange={setActiveHelp}
                  tokensVisible={tokensVisible}
                />
              ))
            )
          ) : (
            <p className="loading">Loading quota…</p>
          )}
        </div>
      </section>

      <footer ref={appFooterRef} className="app-footer">
        <p className="scope-note">
          <span>quota: account · tokens: this PC</span>
          <span>Claude Desktop: not inspected</span>
        </p>
        <div className="footer-help">
          <div className="footer-controls">
            <HelpTrigger
              id="compact-mode-toggle"
              label={compactMode ? "⊞" : "⊟"}
              className="display-toggle compact-toggle"
              ariaLabel={compactMode ? "Expand to detailed mode" : "Collapse to compact mode"}
              ariaPressed={compactMode}
              ariaKeyshortcuts="Control+Shift+C"
              onClick={toggleCompactMode}
              description={
                compactMode
                  ? "Expand to detailed mode (Ctrl+Shift+C)"
                  : "Collapse to compact mode (Ctrl+Shift+C)"
              }
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
            <HelpTrigger
              id="token-visibility-toggle"
              label="◎"
              className="display-toggle token-toggle"
              ariaLabel="Tokens"
              ariaPressed={tokensVisible}
              ariaKeyshortcuts="Control+Shift+T"
              disabled={tokenVisibilityPending}
              onClick={toggleTokenVisibility}
              description={`Tokens: ${tokensVisible ? "on" : "off"} (Ctrl+Shift+T)`}
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
            <HelpTrigger
              id="theme-toggle"
              label={effectiveTheme === "dark" ? "☾" : "☼"}
              className="display-toggle theme-toggle"
              ariaLabel="Theme"
              ariaPressed={effectiveTheme === "dark"}
              ariaKeyshortcuts="Control+Shift+L"
              onClick={toggleTheme}
              description={`${effectiveTheme === "dark" ? "Dark" : "Light"} theme (Ctrl+Shift+L)`}
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
            <HelpTrigger
              id="keyboard-help"
              label="?"
              className="help-trigger-toggle"
              testId="keyboard-help-trigger"
              description={
                <div className="help-content">
                  <h3 className="help-heading">Shortcuts</h3>
                  <ul className="help-shortcuts">
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>
                      </span>
                      <span className="help-desc">Toggle compact mode</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
                      </span>
                      <span className="help-desc">Toggle local tokens</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
                      </span>
                      <span className="help-desc">Toggle theme (dark/light)</span>
                    </li>
                    <li className="help-shortcut-row">
                      <span className="help-keys">
                        <kbd>Esc</kbd>
                      </span>
                      <span className="help-desc">Close popover (stay in tray)</span>
                    </li>
                  </ul>
                  <h3 className="help-heading">Tips</h3>
                  <ul className="help-notes">
                    <li>Hover/focus items for detailed info</li>
                    <li>Right-click tray icon for options & exit</li>
                  </ul>
                </div>
              }
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
          </div>
        </div>
      </footer>
    </main>
  );
};
