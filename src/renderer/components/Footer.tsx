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
  return (
    <footer ref={footerRef} className="app-footer">
      <p className="scope-note">
        <span>quota: account · tokens: this PC</span>
        <span>Claude Desktop: not inspected</span>
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
                <h3 className="help-heading">Shortcuts</h3>
                <ul className="help-shortcuts">
                  <li className="help-shortcut-row">
                    <span className="help-keys">
                      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>
                    </span>
                    <span className="help-desc">Toggle compact mode</span>
                  </li>
                  <li className="help-shortcut-row">
                    <span className="help-keys">
                      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
                    </span>
                    <span className="help-desc">Toggle local tokens</span>
                  </li>
                  <li className="help-shortcut-row">
                    <span className="help-keys">
                      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
                    </span>
                    <span className="help-desc">Toggle theme (dark/light)</span>
                  </li>
                  <li className="help-shortcut-row">
                    <span className="help-keys">
                      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
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
            ariaKeyshortcuts="Control+Shift+C"
            onClick={onToggleCompactMode}
            description={
              compactMode
                ? "Expand to detailed mode (Ctrl+Shift+C)"
                : "Collapse to compact mode (Ctrl+Shift+C)"
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
            ariaKeyshortcuts="Control+Shift+T"
            disabled={tokenVisibilityPending}
            onClick={onToggleTokenVisibility}
            description={`Tokens: ${tokensVisible ? "on" : "off"} (Ctrl+Shift+T)`}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
          <HelpTrigger
            id="theme-toggle"
            label={effectiveTheme === "dark" ? <IconMoon filled /> : <IconSun filled />}
            className="display-toggle theme-toggle"
            ariaLabel="Theme"
            ariaPressed={effectiveTheme === "dark"}
            ariaKeyshortcuts="Control+Shift+L"
            onClick={onToggleTheme}
            description={`${effectiveTheme === "dark" ? "Dark" : "Light"} theme (Ctrl+Shift+L)`}
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
          <HelpTrigger
            id="always-on-top-toggle"
            label={<IconPin filled={alwaysOnTop} />}
            className="display-toggle pin-toggle"
            ariaLabel={alwaysOnTop ? "Unpin window from top" : "Pin window on top"}
            ariaPressed={alwaysOnTop}
            ariaKeyshortcuts="Control+Shift+P"
            onClick={onToggleAlwaysOnTop}
            description={
              alwaysOnTop
                ? "Unpin from top (Ctrl+Shift+P)"
                : "Pin on top (Ctrl+Shift+P)"
            }
            activeHelp={activeHelp}
            onActiveHelpChange={onActiveHelpChange}
          />
        </div>
      </div>
    </footer>
  );
};
