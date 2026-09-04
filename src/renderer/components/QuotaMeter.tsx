import type { ProviderSnapshot, QuotaWindow } from "../../shared/index";
import {
  formatQuotaCountdown,
  formatResetAt,
  isResetPending,
} from "../presentation";
import { usageTone } from "../selectors";
import { HelpTrigger } from "./HelpTrigger";

export interface QuotaMeterProps {
  providerId: ProviderSnapshot["providerId"];
  window: QuotaWindow;
  displayLabel?: string;
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}

export const QuotaMeter = ({
  providerId,
  window,
  displayLabel,
  now,
  activeHelp,
  onActiveHelpChange,
}: QuotaMeterProps) => {
  const used = window.usedPercent;
  const unavailable = used === undefined || window.status === "unavailable";
  const remaining = used === undefined ? undefined : 100 - used;
  const tone = usageTone(used);
  const resetPending = isResetPending(window.resetsAt, now);
  const identity = displayLabel ? `${window.label}: ` : "";
  const label =
    displayLabel ??
    (window.kind === "weekly"
      ? "7d"
      : window.kind === "model_weekly"
        ? window.label.replace(/\s+Weekly$/i, "")
        : window.label);

  return (
    <section className={`quota${unavailable ? " quota-not-provided" : ""}`}>
      <strong className="quota-label">{label}</strong>
      {unavailable ? (
        <span className="quota-not-provided-text">not provided</span>
      ) : (
        <>
          <progress
            className={`quota-meter tone-${tone}`}
            max={100}
            value={used}
            aria-label={`${window.label} usage`}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-usage`}
            label={`${used}%`}
            description={`${identity}Used ${used}%, remaining ${remaining}%.`}
            className={`quota-value tone-${tone}`}
            testId={`${providerId}-${window.kind}-value`}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
          <HelpTrigger
            id={`${providerId}-${window.id}-reset`}
            label={
              resetPending
                ? "reset pending"
                : `resets ${formatQuotaCountdown(window.resetsAt, now)}`
            }
            description={
              resetPending
                ? `${identity}Reset pending verification: local reset time is ${formatResetAt(window.resetsAt!)}. Retaining last quota until next provider refresh.`
                : window.resetsAt
                  ? `${identity}Local reset time: ${formatResetAt(window.resetsAt)}.`
                  : `${identity}Reset time not provided.`
            }
            className="quota-reset"
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </>
      )}
      {!unavailable && remaining !== undefined ? (
        <span className="quota-remaining">{`${remaining}% remaining`}</span>
      ) : null}
    </section>
  );
};
