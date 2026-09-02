import { useEffect, useRef, useState } from "react";
import type {
  AppSnapshot,
  ClaudeSetupAction,
  LocalTokenUsage,
  ProviderSnapshot,
  QuotaWindow,
} from "../shared/index";

const authKindNames = {
  subscription: "subscription",
  api_key: "API key",
  enterprise: "enterprise",
  unknown: "unknown auth",
} as const;

const providerNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude Code",
};

const sourceNames: Record<QuotaWindow["source"], string> = {
  codex_app_server: "Codex App Server",
  claude_cli: "Claude CLI",
  local_fixture: "Local fixture",
};

const formatCountdown = (resetsAt?: string): string => {
  if (!resetsAt) {
    return "--";
  }

  const remainingMinutes = Math.max(
    0,
    Math.floor((new Date(resetsAt).getTime() - Date.now()) / 60_000),
  );
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
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
  activeHelp,
  onActiveHelpChange,
}: {
  id: string;
  label: string;
  value?: string;
  description: string;
  tone?: "neutral" | "input" | "output" | "cache" | "partial";
  className?: string;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const tooltipId = `${id}-tooltip`;
  const isOpen = activeHelp === id;
  const closeTimer = useRef<number | undefined>(undefined);
  const activeHelpRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    activeHelpRef.current = activeHelp;
  }, [activeHelp]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    onActiveHelpChange(id);
  };
  const closeLater = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (activeHelpRef.current === id) onActiveHelpChange(undefined);
    }, 400);
  };
  return (
    <span
      className={`local-token-help tone-${tone}${className ? ` ${className}` : ""}`}
      onMouseEnter={show}
      onMouseLeave={closeLater}
    >
      <button
        type="button"
        className="local-token-trigger"
        aria-describedby={isOpen ? tooltipId : undefined}
        onFocus={show}
        onBlur={closeLater}
      >
        <span>{label}</span>
        {value ? <strong>{value}</strong> : null}
      </button>
      {isOpen ? (
        <span id={tooltipId} className="local-token-tooltip" role="tooltip">
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
      activeHelp={activeHelp}
      onActiveHelpChange={onActiveHelpChange}
    />
  );
  return (
    <div className="local-usage" aria-label="이 PC 로컬 토큰 세부 정보">
      <div className="local-usage-row">
        {help(
          "scope",
          "this PC",
          undefined,
          "이 PC에 현재 남아 있는 로그 전체의 누적 토큰입니다. 계정 전체 값이나 5h/7d quota 기간 값이 아닙니다.",
        )}
        {help(
          "total",
          "total",
          formatLocalTokens(usage.totalTokens),
          `축약 전 합계: ${exactLocalTokens(usage.totalTokens)} tokens. total = input + output이며 cache 토큰을 다시 더하지 않습니다. K=1,000, M=1,000,000, B=1,000,000,000입니다.`,
        )}
        {help(
          "since",
          "since",
          observed,
          usage.observedFrom
            ? `로컬 로그에서 관측한 가장 이른 이벤트 날짜: ${formatLocalDate(usage.observedFrom)}. quota reset 또는 구독 시작일이 아니며, 그 이후 로그가 완전하다는 보장도 아닙니다. 계산 시각: ${formatLocalCalculatedAt(usage.calculatedAt)}.`
            : `가장 이른 관측 이벤트 날짜가 제공되지 않았습니다. 계산 시각: ${formatLocalCalculatedAt(usage.calculatedAt)}.`,
        )}
        {usage.partial
          ? help(
              "partial",
              "partial",
              String(usage.failedFileCount),
              `확인된 부분 합계입니다. 읽기 또는 일부 레코드 처리에 문제가 있는 파일은 ${exactLocalTokens(usage.failedFileCount)}개입니다. 다음 스캔에서 상태를 다시 확인합니다.`,
              "partial",
            )
          : null}
      </div>
      <div className="local-usage-row">
        {help(
          "input",
          "input",
          formatLocalTokens(usage.inputTokens),
          `정확한 input: ${exactLocalTokens(usage.inputTokens)} tokens. 모델에 전달한 입력 토큰이며 cache 토큰이 포함됩니다.`,
          "input",
        )}
        {help(
          "output",
          "output",
          formatLocalTokens(usage.outputTokens),
          `정확한 output: ${exactLocalTokens(usage.outputTokens)} tokens. 모델이 생성한 출력 토큰입니다.`,
          "output",
        )}
        {help(
          "cache-read",
          "cache read",
          formatLocalTokens(usage.cacheReadTokens ?? 0),
          `정확한 cache read: ${exactLocalTokens(usage.cacheReadTokens ?? 0)} tokens. 재사용한 cache 입력 토큰이며 input에 이미 포함되므로 total에 다시 더하지 않습니다.`,
          "cache",
        )}
        {help(
          "cache-write",
          "cache write",
          formatLocalTokens(usage.cacheWriteTokens ?? 0),
          `정확한 cache write: ${exactLocalTokens(usage.cacheWriteTokens ?? 0)} tokens. cache에 새로 기록한 입력 토큰이며 input에 이미 포함되므로 total에 다시 더하지 않습니다.`,
          "cache",
        )}
      </div>
    </div>
  );
};

const selectDisplayWindows = (provider: ProviderSnapshot): QuotaWindow[] => {
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

const hasFableWindow = (provider: ProviderSnapshot): boolean =>
  provider.quotaWindows.some(
    (window) =>
      window.kind === "model_weekly" && /\bfable\b/i.test(window.label),
  );

const selectAdditionalWindows = (
  provider: ProviderSnapshot,
  displayed: QuotaWindow[],
): QuotaWindow[] => {
  const displayedIds = new Set(displayed.map(({ id }) => id));
  const seenIds = new Set<string>();
  return provider.quotaWindows.filter((window) => {
    if (
      displayedIds.has(window.id) ||
      seenIds.has(window.id) ||
      window.status === "unavailable"
    ) {
      return false;
    }
    seenIds.add(window.id);
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
}: {
  providerId: ProviderSnapshot["providerId"];
  window: QuotaWindow;
}) => {
  const used = window.usedPercent;
  const remaining = used === undefined ? undefined : 100 - used;
  const tone = usageTone(used);
  const label =
    window.kind === "weekly"
      ? "7d"
      : window.kind === "model_weekly"
        ? window.label.replace(/\s+Weekly$/i, "")
        : window.label;

  return (
    <section className="quota">
      <strong className="quota-label">{label}</strong>
      <progress
        className={`quota-meter tone-${tone}`}
        max={100}
        value={used}
        aria-label={`${window.label} 사용률`}
      />
      <span
        className={`quota-value tone-${tone}`}
        data-testid={`${providerId}-${window.kind}-value`}
      >
        {used === undefined ? "--" : `${used}%`}
      </span>
      <span className="quota-reset">
        resets{" "}
        <time dateTime={window.resetsAt}>
          {formatCountdown(window.resetsAt)}
        </time>
      </span>
      <span className="quota-remaining">
        {remaining === undefined ? "remaining --" : `${remaining}% remaining`}
      </span>
    </section>
  );
};

const ProviderCard = ({
  provider,
  index,
  onOpenClaudeSetup,
  activeHelp,
  onActiveHelpChange,
}: {
  provider: ProviderSnapshot;
  index: number;
  onOpenClaudeSetup(action: ClaudeSetupAction): void;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  const primaryWindows = selectDisplayWindows(provider);
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
              description={`현재 ${providerNames[provider.providerId]} CLI가 제공한 계정 식별자: ${provider.accountLabel}. 이 값은 이 화면의 메모리에만 유지됩니다.`}
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
          <p className="provider-error">{provider.error.message}</p>
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
          />
        ))}
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
              {additionalWindows.map((window) => (
                <div className="additional-quota" key={window.id}>
                  <h3>{window.label}</h3>
                  <Quota providerId={provider.providerId} window={window} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <footer>
        <LocalUsage
          providerId={provider.providerId}
          usage={provider.localUsage}
          activeHelp={activeHelp}
          onActiveHelpChange={onActiveHelpChange}
        />
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

export const App = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [error, setError] = useState(false);
  const [activeHelp, setActiveHelp] = useState<string>();

  useEffect(() => {
    let active = true;
    const unsubscribe = window.usageMonitor.subscribe((next) => {
      if (active) {
        setSnapshot(next);
      }
    });
    void window.usageMonitor
      .getState()
      .then((next) => {
        if (active) {
          setSnapshot(next);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = (): void => {
    setError(false);
    void window.usageMonitor.refresh().catch(() => setError(true));
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
    <main className="app-shell">
      <header className="app-header">
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
          사용량을 갱신하지 못했습니다. 마지막 값을 유지합니다.
        </p>
      ) : null}

      <section className="provider-list" aria-live="polite">
        {snapshot ? (
          snapshot.providers.map((provider, index) => (
            <ProviderCard
              key={provider.providerId}
              provider={provider}
              index={index}
              onOpenClaudeSetup={openClaudeSetup}
              activeHelp={activeHelp}
              onActiveHelpChange={setActiveHelp}
            />
          ))
        ) : (
          <p className="loading">사용량을 불러오는 중…</p>
        )}
      </section>

      <p className="scope-note">
        <span>quota: account · tokens: this PC</span>
        <span>Claude Desktop: not inspected</span>
      </p>
    </main>
  );
};
