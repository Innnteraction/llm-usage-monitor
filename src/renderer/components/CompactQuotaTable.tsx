import { useState } from "react";
import type { ProviderSnapshot, QuotaWindow } from "../../shared/index";
import {
  formatCompactCountdown,
  formatPercent,
  getResetCountdownStyle,
  isResetPending,
} from "../presentation";
import {
  formatUpdatedAt,
  hasServiceIncident,
  providerErrorHelp,
  providerNames,
  providerStatusTone,
  usageTone,
} from "../selectors";
import { IconAntigravity, IconClaude, IconOpenAI } from "../icons";
import { HelpTrigger } from "./HelpTrigger";

export interface CompactQuotaTableProps {
  providers: ProviderSnapshot[];
  now: number;
  activeHelp?: string;
  onActiveHelpChange?: (id?: string) => void;
  effectiveTheme?: "light" | "dark";
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

interface CapsuleBarProps {
  label: string;
  usedPercent?: number;
  tone?: "low" | "medium" | "high" | "stale";
  isFable?: boolean;
  isRainbow?: boolean;
  title?: string;
}

const CapsuleBar = ({
  label,
  usedPercent,
  tone,
  isFable = false,
  isRainbow = false,
  title,
}: CapsuleBarProps) => {
  const widthPercent = isRainbow
    ? 100
    : usedPercent !== undefined
      ? Math.min(100, Math.max(0, usedPercent))
      : 0;

  let fillToneClass = "";
  if (isRainbow) {
    fillToneClass = "tone-rainbow";
  } else if (tone === "stale") {
    fillToneClass = "tone-stale";
  } else if (isFable) {
    if (usedPercent !== undefined) {
      if (usedPercent >= 80 || tone === "high") {
        fillToneClass = "tone-fable-high";
      } else if (usedPercent >= 50 || tone === "medium") {
        fillToneClass = "tone-fable-medium";
      } else {
        fillToneClass = "tone-fable-low";
      }
    } else {
      fillToneClass = tone ? `tone-${tone}` : "";
    }
  } else if (tone) {
    fillToneClass = `tone-${tone}`;
  }

  return (
    <div
      className={`compact-capsule${isFable ? " capsule-fable" : ""}`}
      title={title}
      role="progressbar"
      aria-valuenow={usedPercent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="capsule-label-base">{label}</span>
      {widthPercent > 0 && (
        <div
          className={`capsule-fill ${fillToneClass}`}
          style={{ width: `${widthPercent}%` }}
        >
          <span className="capsule-label-inverted">{label}</span>
        </div>
      )}
    </div>
  );
};

const WindowSlot = ({
  window,
  now,
  label,
  shortLabel,
  variant = "default",
  theme = "dark",
  showPlaceholder = false,
}: {
  window?: QuotaWindow;
  now: number;
  label?: string;
  shortLabel: string;
  variant?: "default" | "fable";
  theme?: "light" | "dark";
  showPlaceholder?: boolean;
}) => {
  const isFable = variant === "fable";
  if (!window) {
    if (showPlaceholder) {
      return (
        <div className={`compact-slot${isFable ? " slot-fable" : ""}`}>
          <CapsuleBar
            label={shortLabel}
            tone="stale"
            isFable={isFable}
            title={`${label ?? shortLabel}: not tracked`}
          />
          <span className="compact-percent">
            <span className="compact-percent-unavailable">--%</span>
          </span>
          <span className="compact-time" title={`${label ?? shortLabel}: not tracked`}>
            --
          </span>
        </div>
      );
    }
    return <div className="compact-slot slot-empty" aria-hidden="true" />;
  }

  const used = window.usedPercent;
  const unavailable = used === undefined || window.status === "unavailable";
  const tone = unavailable ? undefined : usageTone(used, window.status);
  const resetPending = isResetPending(window.resetsAt, now);
  const countdown = resetPending
    ? "pending"
    : formatCompactCountdown(window.resetsAt, now);
  const countdownStyle =
    resetPending || window.status === "stale"
      ? undefined
      : getResetCountdownStyle(window.resetsAt, now, window.kind, theme);
  const windowTitle = `${label ?? window.label} (${countdown}): ${unavailable ? "unavailable" : formatPercent(used)}${window.status === "stale" ? " [stale]" : ""}`;

  let percentToneClass = tone ? `tone-${tone}` : "compact-percent-unavailable";
  if (isFable && !unavailable && used !== undefined && tone !== "stale") {
    if (used >= 80 || tone === "high") {
      percentToneClass = "tone-fable-high";
    } else if (used >= 50 || tone === "medium") {
      percentToneClass = "tone-fable-medium";
    } else {
      percentToneClass = "tone-fable-low";
    }
  }

  return (
    <div className={`compact-slot${isFable ? " slot-fable" : ""}`}>
      <CapsuleBar
        label={shortLabel}
        usedPercent={unavailable ? undefined : used}
        tone={tone}
        isFable={isFable}
        title={windowTitle}
      />
      <span className="compact-percent">
        {unavailable ? (
          <span className="compact-percent-unavailable">--%</span>
        ) : (
          <span className={percentToneClass}>
            {formatPercent(used)}
          </span>
        )}
      </span>
      <span
        className="compact-time"
        title={windowTitle}
        style={countdownStyle}
      >
        {countdown}
      </span>
    </div>
  );
};

const CodexUnlimitedSlot = () => (
  <div className="compact-slot slot-unlimited">
    <CapsuleBar
      label="5h"
      isRainbow
      title="Codex has no 5h session limit (Unlimited)"
    />
    <span className="compact-percent">
      <span className="compact-percent-unavailable">--%</span>
    </span>
    <span
      className="compact-time compact-unlimited-time"
      title="Codex has no 5h session limit (Unlimited)"
    >
      ∞
    </span>
  </div>
);

export const CompactQuotaTable = ({
  providers,
  now,
  activeHelp,
  onActiveHelpChange = () => {},
  effectiveTheme = "dark",
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
        const statusTone = providerStatusTone(provider, now);
        const hasError = Boolean(provider.error);
        const isErrorExpanded = Boolean(expandedErrors[provider.providerId]);

        // 5h window
        const fiveHourWindow =
          provider.providerId === "antigravity"
            ? provider.quotaWindows.find(
                (w) => w.id === "agy-gemini-5h" || w.kind === "five_hour",
              )
            : provider.quotaWindows.find((w) => w.kind === "five_hour");

        // 7d window
        const weeklyWindow =
          provider.providerId === "antigravity"
            ? provider.quotaWindows.find((w) => w.id === "agy-gemini-weekly") ??
              provider.quotaWindows.find((w) => w.kind === "weekly")
            : provider.quotaWindows.find((w) => w.kind === "weekly");

        // fable window (Claude only)
        const fableWindow =
          provider.providerId === "claude"
            ? provider.quotaWindows.find(
                (w) =>
                  w.kind === "model_weekly" && /\bfable\b/i.test(w.label),
              )
            : undefined;

        const isIncident = hasServiceIncident(provider);
        const incident = provider.serviceStatus;

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
                      className={`compact-brand-icon-wrapper${hasError ? " error-tint" : ""}${isIncident ? " incident-alternate" : ""}`}
                    >
                      <ProviderIcon providerId={provider.providerId} />
                      {isIncident ? (
                        <span className="compact-incident-overlay" aria-hidden="true">
                          ⚠️
                        </span>
                      ) : null}
                    </span>
                  }
                  className="compact-brand-trigger"
                  ariaLabel={providerNames[provider.providerId]}
                  description={
                    <div className="compact-popup-content">
                      <div className="compact-popup-title">
                        {providerNames[provider.providerId]}
                      </div>
                      {isIncident && incident ? (
                        <div className="compact-popup-incident">
                          <div className="compact-incident-badge">
                            ⚠️ {incident.indicator === "critical" ? "Service Outage" : "Service Degraded"}
                          </div>
                          {incident.incidentTitle ? (
                            <div className="compact-incident-desc" title={incident.incidentTitle}>
                              {incident.incidentTitle}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="compact-incident-link-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void (window as unknown as { usageMonitor?: { openExternalUrl?(url: string): Promise<unknown> } })
                                .usageMonitor?.openExternalUrl?.(incident.statusPageUrl);
                            }}
                            title={incident.statusPageUrl}
                          >
                            상태 확인 [Status ↗]
                          </button>
                        </div>
                      ) : null}
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

              {provider.providerId === "codex" ? (
                <CodexUnlimitedSlot />
              ) : (
                <WindowSlot
                  window={fiveHourWindow}
                  now={now}
                  label="5h session"
                  shortLabel="5h"
                  theme={effectiveTheme}
                />
              )}

              <WindowSlot
                window={weeklyWindow}
                now={now}
                label="7d weekly"
                shortLabel="7d"
                theme={effectiveTheme}
              />

              <WindowSlot
                window={fableWindow}
                now={now}
                label="Fable weekly"
                shortLabel="fable"
                variant="fable"
                theme={effectiveTheme}
                showPlaceholder={provider.providerId === "claude"}
              />
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
