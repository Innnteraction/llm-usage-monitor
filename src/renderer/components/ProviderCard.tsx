import { useState } from "react";
import type {
  AntigravitySetupAction,
  ClaudeSetupAction,
  ProviderSnapshot,
} from "../../shared/index";
import {
  formatUpdatedAt,
  hasFableWindow,
  hasServiceIncident,
  missingCoreLabels,
  providerErrorHelp,
  providerNames,
  providerStatusTone,
  selectAdditionalWindows,
  selectDisplayWindows,
  sourceNames,
} from "../selectors";
import { AntigravityAdditionalQuotas } from "./AntigravityAdditionalQuotas";
import { HelpTrigger } from "./HelpTrigger";
import { LocalUsageView } from "./LocalUsageView";
import { QuotaMeter } from "./QuotaMeter";

export interface ProviderCardProps {
  provider: ProviderSnapshot;
  index: number;
  onOpenClaudeSetup(action: ClaudeSetupAction): void;
  onOpenAntigravitySetup?(action: AntigravitySetupAction): void;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  tokensVisible: boolean;
  refreshing?: boolean;
}

export const ProviderCard = ({
  provider,
  index,
  onOpenClaudeSetup,
  onOpenAntigravitySetup,
  now,
  activeHelp,
  onActiveHelpChange,
  tokensVisible,
  refreshing,
}: ProviderCardProps) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  if (sources.length === 0 && providerNames[provider.providerId]) {
    sources.push(
      provider.providerId === "antigravity"
        ? "Antigravity CLI, IDE"
        : `${providerNames[provider.providerId]} CLI`,
    );
  }
  const primaryWindows = selectDisplayWindows(provider);
  const missingCores = missingCoreLabels(provider);
  const additionalWindows = selectAdditionalWindows(provider, primaryWindows);
  const additionalWindowCount = additionalWindows.length;
  const [additionalExpanded, setAdditionalExpanded] = useState(false);
  const additionalId = `${provider.providerId}-additional-limits`;
  const setupAction =
    provider.providerId === "claude"
      ? provider.error?.code === "not_authenticated"
        ? "login"
        : provider.error?.code === "workspace_trust_required"
          ? "trust_probe"
          : undefined
      : provider.providerId === "antigravity"
        ? provider.error?.code === "not_authenticated"
          ? "login"
          : undefined
        : undefined;

  const statusTone = providerStatusTone(provider, now);

  return (
    <article className="provider-card">
      <header>
        <span className="provider-index">{index + 1}</span>
        <div className="provider-title">
          <h2>{providerNames[provider.providerId]}</h2>
          {provider.accountLabel ? (
            <div className="account-container">
              <HelpTrigger
                id={`${provider.providerId}-account`}
                label={provider.accountLabel}
                className="account-label"
                description={
                  provider.providerId === "antigravity"
                    ? `Account shared across Antigravity CLI and IDE: ${provider.accountLabel}. Kept in memory only.`
                    : `Account identifier provided by ${providerNames[provider.providerId]} CLI: ${provider.accountLabel}. Kept in memory only.`
                }
                activeHelp={activeHelp}
                onActiveHelpChange={onActiveHelpChange}
              />
              {provider.providerId === "antigravity" && onOpenAntigravitySetup ? (
                <button
                  type="button"
                  className="account-switch-button"
                  title="Switch Antigravity account in terminal"
                  aria-label="Switch Antigravity account in terminal"
                  onClick={() => onOpenAntigravitySetup("switch_account")}
                >
                  switch
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {hasServiceIncident(provider) ? (
          <button
            type="button"
            className={`status status-incident status-incident-${provider.serviceStatus!.indicator === "critical" ? "outage" : "degraded"}`}
            title={`${provider.serviceStatus!.incidentTitle ?? provider.serviceStatus!.description}\n${provider.serviceStatus!.statusPageUrl}`}
            onClick={() => {
              void (window as unknown as { usageMonitor?: { openExternalUrl?(url: string): Promise<unknown> } })
                .usageMonitor?.openExternalUrl?.(provider.serviceStatus!.statusPageUrl);
            }}
          >
            <span aria-hidden="true">⚠️</span> {provider.serviceStatus!.indicator === "critical" ? "outage" : "degraded"}
          </button>
        ) : (
          <span className={`status status-${statusTone}`}>
            <span aria-hidden="true">●</span> {statusTone}
          </span>
        )}
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
              onClick={() => {
                if (provider.providerId === "claude") {
                  onOpenClaudeSetup(setupAction as ClaudeSetupAction);
                } else if (provider.providerId === "antigravity" && onOpenAntigravitySetup) {
                  onOpenAntigravitySetup(setupAction as AntigravitySetupAction);
                }
              }}
            >
              {setupAction === "login" ? "sign in" : "prepare folder"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="quota-grid">
        {primaryWindows.map((window) => (
          <QuotaMeter
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
              ) : (
                additionalWindows.map((window) => (
                  <div className="additional-quota" key={window.id}>
                    <h3>{window.label}</h3>
                    <QuotaMeter
                      providerId={provider.providerId}
                      window={window}
                      now={now}
                      activeHelp={activeHelp}
                      onActiveHelpChange={onActiveHelpChange}
                    />
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <footer>
        {tokensVisible && Boolean(provider.localUsage) ? (
          <LocalUsageView
            providerId={provider.providerId}
            usage={provider.localUsage}
            refreshing={refreshing}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        ) : null}
        <span>
          source {sources.join(", ")}
          {provider.providerId === "claude" ? " (Desktop not inspected)" : ""}
        </span>
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
