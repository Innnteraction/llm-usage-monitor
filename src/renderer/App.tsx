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

const formatReset = (resetsAt?: string): string =>
  resetsAt
    ? new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }).format(new Date(resetsAt))
    : "벤더에서 제공하지 않음";

const Quota = ({
  providerId,
  window,
}: {
  providerId: ProviderSnapshot["providerId"];
  window: QuotaWindow;
}) => {
  const used = window.usedPercent;
  const remaining = used === undefined ? undefined : 100 - used;

  return (
    <section className="quota">
      <div className="quota-heading">
        <strong>{window.label}</strong>
        <span
          className="quota-value"
          data-testid={`${providerId}-${window.kind}-value`}
        >
          {used === undefined ? "미제공" : `${used}%`}
        </span>
      </div>
      <progress max={100} value={used ?? 0} aria-label={`${window.label} 사용률`} />
      <div className="quota-meta">
        <span>
          {remaining === undefined ? "남은 비율 미제공" : `${remaining}% 남음`}
        </span>
        <span>Reset {formatReset(window.resetsAt)}</span>
      </div>
    </section>
  );
};

const ProviderCard = ({ provider }: { provider: ProviderSnapshot }) => (
  <article className="provider-card">
    <header>
      <div>
        <p className="provider-label">Provider</p>
        <h2>{providerNames[provider.providerId]}</h2>
      </div>
      <span className={`status status-${provider.status}`}>
        {provider.status}
      </span>
    </header>
    <div className="quota-grid">
      {provider.quotaWindows.map((window) => (
        <Quota key={window.id} providerId={provider.providerId} window={window} />
      ))}
    </div>
    <footer>
      <span>source: local fixture</span>
      <span>{new Date(provider.fetchedAt).toLocaleTimeString("ko-KR")}</span>
    </footer>
  </article>
);

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
        <div>
          <p className="eyebrow">Quota overview</p>
          <h1>LLM Usage Monitor</h1>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!snapshot || snapshot.refreshing.length > 0}
        >
          {snapshot?.refreshing.length ? "갱신 중…" : "새로고침"}
        </button>
      </header>

      {error ? (
        <p className="error-banner" role="alert">
          사용량을 갱신하지 못했습니다. 마지막 값을 유지합니다.
        </p>
      ) : null}

      <section className="provider-list" aria-live="polite">
        {snapshot ? (
          snapshot.providers.map((provider) => (
            <ProviderCard key={provider.providerId} provider={provider} />
          ))
        ) : (
          <p className="loading">사용량을 불러오는 중…</p>
        )}
      </section>

      <p className="scope-note">
        quota는 계정 범위이며 실제 토큰은 추후 이 PC의 로컬 로그로 별도
        표시됩니다.
      </p>
    </main>
  );
};
