import { useEffect, useState } from "react";
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

export const localUsageLine = (
  usage: LocalTokenUsage | undefined,
): { text: string; ariaLabel: string } => {
  if (!usage)
    return {
      text: "this PC calculating",
      ariaLabel: "이 PC 로컬 토큰을 계산 중",
    };
  if (usage.scannedFileCount === 0 && !usage.partial)
    return {
      text: "this PC no local logs",
      ariaLabel: "이 PC에 로컬 로그가 없습니다",
    };
  const observed = usage.observedFrom
    ? new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
      }).format(new Date(usage.observedFrom))
    : "--";
  const partial = usage.partial
    ? ` · partial (${usage.failedFileCount} failed)`
    : "";
  return {
    text: `this PC ${formatLocalTokens(usage.totalTokens)} · I${formatLocalTokens(usage.inputTokens)} O${formatLocalTokens(usage.outputTokens)} · R${formatLocalTokens(usage.cacheReadTokens ?? 0)} W${formatLocalTokens(usage.cacheWriteTokens ?? 0)} · ${observed}+${partial}`,
    ariaLabel: `이 PC 로컬 토큰 총 ${usage.totalTokens}, 입력 ${usage.inputTokens}, 출력 ${usage.outputTokens}, 캐시 읽기 ${usage.cacheReadTokens ?? 0}, 캐시 쓰기 ${usage.cacheWriteTokens ?? 0}, 계산 시각 ${usage.calculatedAt}${usage.partial ? `, 부분 결과, 실패 파일 ${usage.failedFileCount}` : ""}`,
  };
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

const countOptionalWindows = (
  provider: ProviderSnapshot,
  displayed: QuotaWindow[],
): number => {
  const displayedIds = new Set(displayed.map(({ id }) => id));
  return provider.quotaWindows.filter((window) => {
    if (displayedIds.has(window.id) || window.status === "unavailable") {
      return false;
    }
    if (provider.providerId !== "codex") {
      return true;
    }
    return (
      window.kind === "model_weekly" ||
      (window.kind === "other" && window.id.startsWith("codex-limit-"))
    );
  }).length;
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
}: {
  provider: ProviderSnapshot;
  index: number;
  onOpenClaudeSetup(action: ClaudeSetupAction): void;
}) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  const primaryWindows = selectDisplayWindows(provider);
  const additionalWindowCount = countOptionalWindows(provider, primaryWindows);
  const setupAction =
    provider.providerId !== "claude"
      ? undefined
      : provider.error?.code === "not_authenticated"
        ? "login"
        : provider.error?.code === "workspace_trust_required"
          ? "trust_probe"
          : undefined;
  const localUsage = localUsageLine(provider.localUsage);

  return (
    <article className="provider-card">
      <header>
        <span className="provider-index">{index + 1}</span>
        <div className="provider-title">
          <h2>{providerNames[provider.providerId]}</h2>
          {provider.accountLabel ? (
            <span className="account-label" title={provider.accountLabel}>
              {provider.accountLabel}
            </span>
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
        <p className="additional-limits">
          +{additionalWindowCount} additional limits
        </p>
      ) : null}
      <footer>
        <span className="local-usage" aria-label={localUsage.ariaLabel}>
          {localUsage.text}
        </span>
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
