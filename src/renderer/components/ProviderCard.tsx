import { useState } from "react";
import type {
  ClaudeSetupAction,
  ProviderSnapshot,
} from "../../shared/index";
import {
  formatUpdatedAt,
  hasFableWindow,
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
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  tokensVisible: boolean;
}

export const ProviderCard = ({
  provider,
  index,
  onOpenClaudeSetup,
  now,
  activeHelp,
  onActiveHelpChange,
  tokensVisible,
}: ProviderCardProps) => {
  const sources = [
    ...new Set(provider.quotaWindows.map(({ source }) => sourceNames[source])),
  ];
  if (sources.length === 0 && providerNames[provider.providerId]) {
    sources.push(`${providerNames[provider.providerId]} CLI`);
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

  const statusTone = providerStatusTone(provider, now);

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
        </div>
        <span className={`status status-${statusTone}`}>
          <span aria-hidden="true">●</span> {statusTone}
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
