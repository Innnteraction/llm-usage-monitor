import { useCallback, useEffect, useRef, useState } from "react";
import {
  isMacOS,
  isShortcutMatch,
  type AntigravitySetupAction,
  type AppSnapshot,
  type ClaudeSetupAction,
} from "../../shared/index";
import { isEditableTarget } from "../selectors";

export const useUsageMonitor = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [error, setError] = useState(false);
  const [activeHelp, setActiveHelp] = useState<string>();
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [compactMode, setCompactMode] = useState(false);
  const [tokensVisible, setTokensVisible] = useState(true);
  const [tokenVisibilityPending, setTokenVisibilityPending] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [themeOverride, setThemeOverride] = useState<"light" | "dark">();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  const previousSnapshot = useRef<AppSnapshot | undefined>(undefined);
  const tokenVisibilityInFlight = useRef(false);
  const effectiveTheme = themeOverride ?? systemTheme;

  // Always on top state synchronization
  useEffect(() => {
    void window.usageMonitor
      .getAlwaysOnTop()
      .then(setAlwaysOnTop)
      .catch(() => undefined);
  }, []);

  const toggleAlwaysOnTop = useCallback((): void => {
    setAlwaysOnTop((prev) => {
      const next = !prev;
      void window.usageMonitor
        .setAlwaysOnTop(next)
        .then(setAlwaysOnTop)
        .catch(() => setAlwaysOnTop(prev));
      return next;
    });
  }, []);

  const toggleCompactMode = useCallback((): void => {
    setActiveHelp(undefined);
    setCompactMode((prev) => !prev);
  }, []);

  const toggleTheme = useCallback((): void => {
    setActiveHelp(undefined);
    setThemeOverride((prev) => {
      const current = prev ?? systemTheme;
      return current === "dark" ? "light" : "dark";
    });
  }, [systemTheme]);

  // System theme changes
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (): void => {
      if (!themeOverride) setSystemTheme(media.matches ? "dark" : "light");
    };
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [themeOverride]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  const toggleTokenVisibility = useCallback((): void => {
    if (tokenVisibilityInFlight.current) return;
    const visible = !tokensVisible;
    tokenVisibilityInFlight.current = true;
    setTokenVisibilityPending(true);
    setDisplayError("");
    setActiveHelp(undefined);
    setTokensVisible(visible);
  }, [tokensVisible]);

  // Clock tick & focus refresh (freezes when hidden to conserve background CPU and memory)
  useEffect(() => {
    const updateClock = (): void => setNow(Date.now());
    const handleWindowFocus = (): void => {
      updateClock();
      setActiveHelp(undefined);
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        updateClock();
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        updateClock();
      }
    }, 30_000);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Dismiss help on blur, visibility change, or cursor leaving the window
  useEffect(() => {
    const closeHelp = (): void => setActiveHelp(undefined);
    const handleWindowExit = (event: MouseEvent): void => {
      if (!event.relatedTarget) {
        closeHelp();
      }
    };
    window.addEventListener("blur", closeHelp);
    document.addEventListener("visibilitychange", closeHelp);
    window.addEventListener("mouseout", handleWindowExit);
    document.documentElement.addEventListener("mouseleave", handleWindowExit);
    document.addEventListener("mouseleave", handleWindowExit);
    return () => {
      window.removeEventListener("blur", closeHelp);
      document.removeEventListener("visibilitychange", closeHelp);
      window.removeEventListener("mouseout", handleWindowExit);
      document.documentElement.removeEventListener("mouseleave", handleWindowExit);
      document.removeEventListener("mouseleave", handleWindowExit);
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const isMac = isMacOS();
    const handleKeyboard = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setActiveHelp(undefined);
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (isShortcutMatch(event, "KeyC", isMac)) {
        event.preventDefault();
        toggleCompactMode();
      } else if (isShortcutMatch(event, "KeyL", isMac)) {
        event.preventDefault();
        toggleTheme();
      } else if (isShortcutMatch(event, "KeyP", isMac)) {
        event.preventDefault();
        toggleAlwaysOnTop();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [toggleAlwaysOnTop, toggleCompactMode, toggleTheme]);

  // IPC subscription and initial state
  useEffect(() => {
    let active = true;
    const unsubscribe = window.usageMonitor.subscribe((next) => {
      if (active) {
        setSnapshot(next);
        const previous = previousSnapshot.current;
        if (previous?.refreshing.length && !next.refreshing.length) {
          setNotice(
            next.providers.some((provider) => provider.error)
              ? "Refresh failed: keeping last known quota."
              : "Quota refreshed.",
          );
        }
        if (!next.providers.some((provider) => provider.error)) setError(false);
        previousSnapshot.current = next;
      }
    });
    void window.usageMonitor
      .getState()
      .then((next) => {
        if (active) {
          setSnapshot(next);
          previousSnapshot.current = next;
          setNotice("Quota loaded.");
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setNotice("Failed to load quota.");
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback((): void => {
    setError(false);
    setNotice("");
    void window.usageMonitor.refresh().catch(() => setError(true));
  }, []);

  const openClaudeSetup = useCallback((action: ClaudeSetupAction): void => {
    setError(false);
    void window.usageMonitor
      .openClaudeSetup(action)
      .then(({ opened }) => {
        if (!opened) {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, []);

  const openAntigravitySetup = useCallback((action: AntigravitySetupAction): void => {
    setError(false);
    void window.usageMonitor
      .openAntigravitySetup(action)
      .then(({ opened }) => {
        if (!opened) {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, []);

  const finishTokenVisibilityAdjust = useCallback((): void => {
    tokenVisibilityInFlight.current = false;
    setTokenVisibilityPending(false);
  }, []);

  return {
    snapshot,
    error,
    activeHelp,
    setActiveHelp,
    notice,
    now,
    compactMode,
    toggleCompactMode,
    tokensVisible,
    tokenVisibilityPending,
    toggleTokenVisibility,
    finishTokenVisibilityAdjust,
    displayError,
    setDisplayError,
    effectiveTheme,
    toggleTheme,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
    openClaudeSetup,
    openAntigravitySetup,
  };
};
