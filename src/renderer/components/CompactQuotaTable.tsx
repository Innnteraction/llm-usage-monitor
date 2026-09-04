import type { ProviderSnapshot } from "../../shared/index";
import {
  formatCompactCountdown,
  formatCompactWindowLabel,
} from "../presentation";
import {
  compactProviderNames,
  selectDisplayWindows,
  usageTone,
} from "../selectors";

export interface CompactQuotaTableProps {
  providers: ProviderSnapshot[];
  now: number;
}

export const CompactQuotaTable = ({
  providers,
  now,
}: CompactQuotaTableProps) => {
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
              {windows.length === 0 ? (
                <span className="compact-percent-unavailable">--</span>
              ) : (
                windows.map((w, index) => {
                  const used = w.usedPercent;
                  const unavailable =
                    used === undefined || w.status === "unavailable";
                  const tone = unavailable ? undefined : usageTone(used);
                  const text = unavailable ? "--" : `${used}%`;

                  return (
                    <span key={w.id || index}>
                      {index > 0 && (
                        <span className="compact-percent-separator">/</span>
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
