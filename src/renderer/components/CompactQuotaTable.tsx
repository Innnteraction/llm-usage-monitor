import { useState } from "react";
import type { ProviderSnapshot } from "../../shared/index";
import {
  formatCompactCountdown,
  formatCompactWindowLabel,
  formatPercent,
} from "../presentation";
import {
  formatUpdatedAt,
  providerErrorHelp,
  providerNames,
  providerStatusTone,
  selectDisplayWindows,
  usageTone,
} from "../selectors";
import { IconAntigravity, IconClaude, IconOpenAI } from "../icons";
import { HelpTrigger } from "./HelpTrigger";

export interface CompactQuotaTableProps {
  providers: ProviderSnapshot[];
  now: number;
  activeHelp?: string;
  onActiveHelpChange?: (id?: string) => void;
}

const ProviderIcon = ({
  providerId,
  size = 14,
}: {
  providerId: ProviderSnapshot["providerId"];
  size?: number;
}) => {
  switch (providerId) {
    case "codex":
      return <IconOpenAI size={size} className="provider-brand-icon brand-codex" />;
    case "claude":
      return <IconClaude size={size} className="provider-brand-icon brand-claude" />;
    case "antigravity":
      return (
        <IconAntigravity
          size={size}
          className="provider-brand-icon brand-antigravity"
        />
      );
  }
};

export const CompactQuotaTable = ({
  providers,
  now,
  activeHelp,
  onActiveHelpChange = () => {},
}: CompactQuotaTableProps) => {
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>(
    {},
  );

  const toggleError = (providerId: string) => {
    setExpandedErrors((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

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
        const weeklyTone = usageTone(
          weeklyUsed,
          weeklyWindow?.status ?? provider.status,
        );

        const statusTone = providerStatusTone(provider, now);
        const windowLabels = windows.map((w) => formatCompactWindowLabel(w));
        const resets = windows.map((w) =>
          formatCompactCountdown(w.resetsAt, now),
        );
        const hasError = Boolean(provider.error);
        const isErrorExpanded = Boolean(expandedErrors[provider.providerId]);

        return (
          <div
            key={provider.providerId}
            className={`compact-item${hasError ? " has-error" : ""}`}
          >
            <div
              className={`compact-row${hasError ? " is-error-row" : ""}`}
              role="row"
              onClick={hasError ? () => toggleError(provider.providerId) : undefined}
              title={
                hasError
                  ? isErrorExpanded
                    ? "Click to collapse error"
                    : "Click to view error"
                  : undefined
              }
            >
              <div className="compact-name">
                <HelpTrigger
                  id={`compact-${provider.providerId}`}
                  placementPreference="right"
                  label={
                    <span
                      className={`compact-brand-icon-wrapper${hasError ? " error-tint" : ""}`}
                    >
                      <ProviderIcon providerId={provider.providerId} />
                    </span>
                  }
                  className="compact-brand-trigger"
                  ariaLabel={providerNames[provider.providerId]}
                  description={
                    <div className="compact-popup-content">
                      <div className="compact-popup-title">
                        {providerNames[provider.providerId]}
                      </div>
                      {provider.accountLabel ? (
                        <div className="compact-popup-account">
                          {provider.accountLabel}
                        </div>
                      ) : null}
                      <div className="compact-popup-status">
                        status:{" "}
                        <span className={`status-${statusTone}`}>{statusTone}</span>
                      </div>
                      {hasError ? (
                        <div className="compact-popup-error-tip">
                          ⚠️ Click row to {isErrorExpanded ? "hide" : "view"} error
                        </div>
                      ) : null}
                    </div>
                  }
                  activeHelp={activeHelp}
                  onActiveHelpChange={onActiveHelpChange}
                />
              </div>
              <div className="compact-gauge-cell">
                {weeklyUsed === undefined || weeklyWindow?.status === "unavailable" ? (
                  <span className="quota-not-provided-text">--</span>
                ) : (
                  <progress
                    className={`quota-meter tone-${weeklyTone}`}
                    max={100}
                    value={weeklyUsed}
                    title={`Weekly limit (${formatCompactCountdown(weeklyWindow?.resetsAt, now)}): ${formatPercent(weeklyUsed)}${weeklyWindow?.status === "stale" ? " [stale]" : ""}`}
                  />
                )}
              </div>
              <span className="compact-percent">
                {windows.length === 0 ? (
                  <span className="compact-percent-unavailable">--</span>
                ) : (
                  windows.map((w, index) => {
                    const used = w.usedPercent;
                    const unavailable =
                      used === undefined || w.status === "unavailable";
                    const tone = unavailable
                      ? undefined
                      : usageTone(used, w.status);
                    const text = unavailable ? "--" : formatPercent(used);

                    return (
                      <span key={w.id || index}>
                        {index > 0 && (
                          <span className="compact-separator">|</span>
                        )}
                        <span
                          className={
                            tone ? `tone-${tone}` : "compact-percent-unavailable"
                          }
                        >
                          {text}
                        </span>
                      </span>
                    );
                  })
                )}
              </span>
              <span className="compact-window">
                {windowLabels.length > 0 ? windowLabels.join("|") : "--"}
              </span>
              <span className="compact-reset">
                {resets.length > 0 ? resets.join("|") : "--"}
              </span>
            </div>
            {hasError && isErrorExpanded ? (
              <div className="compact-error-row" role="status">
                <p className="provider-error">
                  {providerErrorHelp[provider.error!.code]}
                  {provider.status === "stale"
                    ? ` Last successful ${formatUpdatedAt(provider.lastSuccessfulAt ?? provider.fetchedAt)}.`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
