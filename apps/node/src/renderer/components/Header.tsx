import { useEffect, useState, type FC, type RefObject } from "react";
import { HelpTrigger } from "./HelpTrigger";
import {
  IconAddSquare,
  IconHelp,
  IconMinusSquare,
  IconMoon,
  IconPin,
  IconSun,
} from "../icons";
import {
  APP_NAME,
  APP_VERSION,
  getModifierKeyLabel,
  isMacOS,
} from "../../shared/index";

export interface HeaderProps {
  headerRef: RefObject<HTMLElement | null>;
  refreshing: boolean;
  onRefresh: () => void;
  disabled: boolean;
  activeHelp?: string;
  onActiveHelpChange: (id?: string) => void;
  compactMode: boolean;
  onToggleCompactMode: () => void;
  effectiveTheme: "light" | "dark";
  onToggleTheme: () => void;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
}

export const Header: FC<HeaderProps> = ({
  headerRef,
  refreshing,
  onRefresh,
  disabled,
  activeHelp,
  onActiveHelpChange,
  compactMode,
  onToggleCompactMode,
  effectiveTheme,
  onToggleTheme,
  alwaysOnTop,
  onToggleAlwaysOnTop,
}) => {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (!refreshing) return;
    const timer = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1);
    }, 400);
    return () => {
      clearInterval(timer);
      setDotCount(1);
    };
  }, [refreshing]);

  const isMac = isMacOS();
  const modKey = getModifierKeyLabel(isMac);
  const ariaModKey = isMac ? "Meta" : "Control";

  return (
    <header ref={headerRef} className="app-header">
      <h1 aria-label="LLM Usage Monitor">
        <button
          type="button"
          className={`title-refresh-button${refreshing ? " is-refreshing" : ""}`}
          onClick={onRefresh}
          disabled={disabled}
          aria-label="refresh"
          title="Refresh quota"
        >
          {refreshing ? (
            <span className="cli-shimmer-text">
              LLM Usage Monitor{".".repeat(dotCount)}
            </span>
          ) : (
            "LLM Usage Monitor"
          )}
        </button>
      </h1>
      <div className="header-actions">
        <HelpTrigger
          id="compact-mode-toggle"
          label={compactMode ? <IconAddSquare /> : <IconMinusSquare />}
          className="display-toggle compact-toggle"
          ariaLabel={compactMode ? "Expand to detailed mode" : "Collapse to compact mode"}
          ariaKeyshortcuts={`${ariaModKey}+Shift+C`}
          onClick={onToggleCompactMode}
          description={
            compactMode
              ? `Expand to detailed mode (${modKey}+Shift+C)`
              : `Collapse to compact mode (${modKey}+Shift+C)`
          }
          activeHelp={activeHelp}
          onActiveHelpChange={onActiveHelpChange}
        />
        <HelpTrigger
          id="theme-toggle"
          label={effectiveTheme === "dark" ? <IconMoon filled /> : <IconSun filled />}
          className="display-toggle theme-toggle"
          ariaLabel="Theme"
          ariaPressed={effectiveTheme === "dark"}
          ariaKeyshortcuts={`${ariaModKey}+Shift+L`}
          onClick={onToggleTheme}
          description={`${effectiveTheme === "dark" ? "Dark" : "Light"} theme (${modKey}+Shift+L)`}
          activeHelp={activeHelp}
          onActiveHelpChange={onActiveHelpChange}
        />
        <HelpTrigger
          id="always-on-top-toggle"
          label={<IconPin filled={alwaysOnTop} />}
          className="display-toggle pin-toggle"
          ariaLabel={alwaysOnTop ? "Unpin window from top" : "Pin window on top"}
          ariaPressed={alwaysOnTop}
          ariaKeyshortcuts={`${ariaModKey}+Shift+P`}
          onClick={onToggleAlwaysOnTop}
          description={
            alwaysOnTop
              ? `Unpin from top (${modKey}+Shift+P)`
              : `Pin on top (${modKey}+Shift+P)`
          }
          activeHelp={activeHelp}
          onActiveHelpChange={onActiveHelpChange}
        />
        <HelpTrigger
          id="keyboard-help"
          label={<IconHelp filled={activeHelp === "keyboard-help"} />}
          className="help-trigger-toggle header-help-trigger"
          testId="keyboard-help-trigger"
          ariaLabel="Shortcuts and help"
          ariaPressed={activeHelp === "keyboard-help"}
          description={
            <div className="help-content">
              <div className="help-header">
                <span className="help-title">{APP_NAME}</span>
                <span className="version-badge">v{APP_VERSION}</span>
              </div>
              <div className="help-scope-note">
                <span>quota: account</span>
                <span className="help-scope-sep">·</span>
                <span>tokens: this PC</span>
              </div>
              <h3 className="help-heading">Shortcuts</h3>
              <ul className="help-shortcuts">
                <li className="help-shortcut-row">
                  <span className="help-keys">
                    <kbd>{modKey}</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>
                  </span>
                  <span className="help-desc">Toggle compact mode</span>
                </li>
                <li className="help-shortcut-row">
                  <span className="help-keys">
                    <kbd>{modKey}</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
                  </span>
                  <span className="help-desc">Toggle theme (dark/light)</span>
                </li>
                <li className="help-shortcut-row">
                  <span className="help-keys">
                    <kbd>{modKey}</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
                  </span>
                  <span className="help-desc">Toggle pin (always on top)</span>
                </li>
                <li className="help-shortcut-row">
                  <span className="help-keys">
                    <kbd>Esc</kbd>
                  </span>
                  <span className="help-desc">Close popover (stay in tray)</span>
                </li>
              </ul>
              <h3 className="help-heading">Tips</h3>
              <ul className="help-notes">
                <li>Hover/focus items for detailed info</li>
                <li>Click compact provider name/icon to toggle display</li>
                <li>Right-click tray icon for options & exit</li>
              </ul>
            </div>
          }
          activeHelp={activeHelp}
          onActiveHelpChange={onActiveHelpChange}
        />
      </div>
    </header>
  );
};
