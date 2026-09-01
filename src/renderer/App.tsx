import { useEffect, useState } from "react";
import type {
  AppSnapshot,
  ProviderSnapshot,
  QuotaWindow,
} from "../shared/index";

const providerNames: Record<ProviderSnapshot["providerId"], string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini",
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
  const label = window.kind === "weekly" ? "7d" : window.label;

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
        resets <time dateTime={window.resetsAt}>{formatCountdown(window.resetsAt)}</time>
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
}: {
  provider: ProviderSnapshot;
  index: number;
}) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];

  return (
    <article className="provider-card">
      <header>
        <span className="provider-index">{index + 1}</span>
        <h2>{providerNames[provider.providerId]}</h2>
        <span className={`status status-${provider.status}`}>
          <span aria-hidden="true">●</span> {provider.status}
        </span>
      </header>
      {provider.error ? (
        <p className="provider-error" role="status">
          {provider.error.message}
        </p>
      ) : null}
      <div className="quota-grid">
        {provider.quotaWindows.map((window) => (
          <Quota
            key={window.id}
            providerId={provider.providerId}
            window={window}
          />
        ))}
      </div>
      <footer>
        <span>source {sources.join(", ")}</span>
        <span>
          updated {new Date(provider.fetchedAt).toLocaleTimeString("ko-KR")}
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
            />
          ))
        ) : (
          <p className="loading">사용량을 불러오는 중…</p>
        )}
      </section>

      <p className="scope-note">
        quota: account scope · tokens: this PC only
      </p>
    </main>
  );
};
