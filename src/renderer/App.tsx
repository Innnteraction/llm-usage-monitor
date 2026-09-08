import { useRef } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { CompactQuotaTable } from "./components/CompactQuotaTable";
import { ProviderCard } from "./components/ProviderCard";
import { useUsageMonitor } from "./hooks/useUsageMonitor";
import { useWindowAutoResize } from "./hooks/useWindowAutoResize";

export const App = () => {
  const {
    snapshot,
    error,
    activeHelp,
    setActiveHelp,
    notice,
    now,
    compactMode,
    toggleCompactMode,
    tokensVisible,
    tokenVisibilityPending,
    toggleTokenVisibility,
    finishTokenVisibilityAdjust,
    displayError,
    setDisplayError,
    effectiveTheme,
    toggleTheme,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
    openClaudeSetup,
  } = useUsageMonitor();

  const appShellRef = useRef<HTMLElement>(null);
  const providerListRef = useRef<HTMLElement>(null);
  const providerListContentRef = useRef<HTMLDivElement>(null);
  const appHeaderRef = useRef<HTMLElement>(null);
  const appFooterRef = useRef<HTMLElement>(null);

  useWindowAutoResize({
    appShellRef,
    providerListRef,
    providerListContentRef,
    appHeaderRef,
    appFooterRef,
    compactMode,
    tokensVisible,
    displayError,
    error,
    onResizeError: setDisplayError,
    onResizeComplete: finishTokenVisibilityAdjust,
  });

  return (
    <main
      ref={appShellRef}
      className={`app-shell${compactMode ? " compact-mode" : ""}`}
    >
      <Header
        headerRef={appHeaderRef}
        refreshing={Boolean(snapshot?.refreshing.length)}
        onRefresh={refresh}
        disabled={!snapshot || snapshot.refreshing.length > 0}
        activeHelp={activeHelp}
        onActiveHelpChange={setActiveHelp}
        compactMode={compactMode}
        onToggleCompactMode={toggleCompactMode}
        tokensVisible={tokensVisible}
        tokenVisibilityPending={tokenVisibilityPending}
        onToggleTokenVisibility={toggleTokenVisibility}
        effectiveTheme={effectiveTheme}
        onToggleTheme={toggleTheme}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
      />

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
              <CompactQuotaTable
                providers={snapshot.providers}
                now={now}
                activeHelp={activeHelp}
                onActiveHelpChange={setActiveHelp}
                effectiveTheme={effectiveTheme}
              />
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

      <Footer footerRef={appFooterRef} />
    </main>
  );
};
