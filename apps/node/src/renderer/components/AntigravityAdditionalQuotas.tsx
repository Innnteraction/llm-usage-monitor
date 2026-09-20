import type { ProviderSnapshot, QuotaWindow } from "../../shared/index";
import { selectWindowsById } from "../selectors";
import { QuotaMeter } from "./QuotaMeter";

export interface AntigravityAdditionalQuotasProps {
  providerId: ProviderSnapshot["providerId"];
  windows: QuotaWindow[];
  now: number;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
}

export const AntigravityAdditionalQuotas = ({
  providerId,
  windows,
  now,
  activeHelp,
  onActiveHelpChange,
}: AntigravityAdditionalQuotasProps) => {
  const sharedWindows = selectWindowsById(windows, [
    "agy-claude-gpt-5h",
    "agy-claude-gpt-weekly",
  ]);
  const sharedIds = new Set(sharedWindows.map(({ id }) => id));
  return (
    <>
      {sharedWindows.length > 0 ? (
        <div className="additional-quota-group">
          <h3>Claude/GPT</h3>
          <div className="additional-quota-rows">
            {sharedWindows.map((window) => (
              <QuotaMeter
                key={window.id}
                providerId={providerId}
                window={window}
                displayLabel={
                  window.id === "agy-claude-gpt-weekly" ? "7d" : "5h"
                }
                now={now}
                activeHelp={activeHelp}
                onActiveHelpChange={onActiveHelpChange}
              />
            ))}
          </div>
        </div>
      ) : null}
      {windows
        .filter(({ id }) => !sharedIds.has(id))
        .map((window) => (
          <div className="additional-quota" key={window.id}>
            <h3>{window.label}</h3>
            <QuotaMeter
              providerId={providerId}
              window={window}
              now={now}
              activeHelp={activeHelp}
              onActiveHelpChange={onActiveHelpChange}
            />
          </div>
        ))}
    </>
  );
};
