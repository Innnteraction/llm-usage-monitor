import type { FC, RefObject } from "react";
import { HelpTrigger } from "./HelpTrigger";
import {
  IconCompactCollapse,
  IconCompactExpand,
  IconHelp,
  IconMoon,
  IconPin,
  IconSun,
  IconTokens,
} from "../icons";
import {
  APP_NAME,
  APP_VERSION,
  getModifierKeyLabel,
  isMacOS,
} from "../../shared/index";

export interface FooterProps {
  footerRef: RefObject<HTMLElement | null>;
  activeHelp?: string;
  onActiveHelpChange: (id?: string) => void;
  compactMode: boolean;
  onToggleCompactMode: () => void;
  tokensVisible: boolean;
  tokenVisibilityPending: boolean;
  onToggleTokenVisibility: () => void;
  effectiveTheme: "light" | "dark";
  onToggleTheme: () => void;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
}

export const Footer: FC<FooterProps> = ({
  footerRef,
  activeHelp,
  onActiveHelpChange,
  compactMode,
  onToggleCompactMode,
  tokensVisible,
  tokenVisibilityPending,
  onToggleTokenVisibility,
  effectiveTheme,
  onToggleTheme,
  alwaysOnTop,
  onToggleAlwaysOnTop,
}) => {
  const isMac = isMacOS();
  const modKey = getModifierKeyLabel(isMac);
  const ariaModKey = isMac ? "Meta" : "Control";

  return (
    <footer ref={footerRef} className="app-footer">
      <p className="scope-note">
        <span>quota: account · tokens: this PC</span>
        <span>Claude Desktop: not inspected · v{APP_VERSION}</span>
      </p>
      <div className="footer-bar">
        <div className="footer-left">
          <HelpTrigger
            id="keyboard-help"
            label={<IconHelp />}
            className="help-trigger-toggle"
            testId="keyboard-help-trigger"
            ariaLabel="Shortcuts and help"
            description={
              <div className="help-content">
                <div className="help-header">
                  <span className="help-title">{APP_NAME}</span>
                  <span className="version-badge">v{APP_VERSION}</span>
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
                      <kbd>{modKey}</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
                    </span>
                    <span className="help-desc">Toggle local tokens</span>
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
                  <li>Right-click tray icon for options & exit</li>
                </ul>
              </div>
            }
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </div>
        <div className="footer-right">
          <HelpTrigger
            id="compact-mode-toggle"
            label={compactMode ? <IconCompactExpand /> : <IconCompactCollapse />}
            className="display-toggle compact-toggle"
            ariaLabel={compactMode ? "Expand to detailed mode" : "Collapse to compact mode"}
            ariaPressed={compactMode}
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
            id="token-visibility-toggle"
            label={<IconTokens filled={tokensVisible} />}
            className="display-toggle token-toggle"
            ariaLabel="Tokens"
            ariaPressed={tokensVisible}
            ariaKeyshortcuts={`${ariaModKey}+Shift+T`}
            disabled={tokenVisibilityPending}
            onClick={onToggleTokenVisibility}
            description={`Tokens: ${tokensVisible ? "on" : "off"} (${modKey}+Shift+T)`}
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
        </div>
      </div>
    </footer>
  );
};
