import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  Tray,
} from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UsageMonitorCore } from "../core/index";
import type { AppSnapshot, ProviderId } from "../shared/index";
import { openAntigravitySetup } from "./antigravitySetup";
import { openClaudeSetup } from "./claudeSetup";
import { registerIpcHandlers } from "./ipc";
import { configureRuntime, registerRendererDiagnostics, registerRuntimeDiagnostics } from "./runtime";
import {
  ensurePlatformPath,
  getAlwaysOnTopLevel,
  setupPlatformDock,
} from "./platform/index";
import { createTrayIcon } from "./trayIcon";
import { createBeforeQuitHandler, createTrayMenuTemplate } from "./trayMenu";
import {
  calculatePopoverPosition,
  clampPopoverHeight,
  clampWindowPosition,
  selectPopoverAnchor,
} from "./windowPosition";

const WINDOW_SIZE = { width: 480, height: 360 };
const COMPACT_WINDOW_HEIGHT = 304;
const MINI_WINDOW_HEIGHT = 124;

interface StoredPreferences {
  alwaysOnTop?: boolean;
}

const loadStoredPreferences = async (filePath: string): Promise<StoredPreferences> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as StoredPreferences;
  } catch {
    return {};
  }
};

const saveStoredPreferences = async (filePath: string, prefs: StoredPreferences): Promise<void> => {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(prefs, null, 2), "utf8");
  } catch {
    // ignore
  }
};

const positionNearTray = (
  window: BrowserWindow,
  trayBounds?: Electron.Rectangle,
): void => {
  const cursor = screen.getCursorScreenPoint();
  const anchor = selectPopoverAnchor(
    trayBounds,
    screen.getAllDisplays().map(({ bounds }) => bounds),
    cursor,
  );
  const display = screen.getDisplayNearestPoint(anchor);
  const [contentWidth, contentHeight] = window.getContentSize();
  const position = calculatePopoverPosition(anchor, display.workArea, {
    width: contentWidth ?? WINDOW_SIZE.width,
    height: contentHeight ?? WINDOW_SIZE.height,
  });
  window.setPosition(position.x, position.y, false);
};

const resizeWindow = (
  window: BrowserWindow,
  trayBounds: Electron.Rectangle | undefined,
  visible: boolean,
  contentHeight: number | undefined,
  customPosition: { x: number; y: number } | undefined,
): void => {
  const currentPoint = customPosition ?? selectPopoverAnchor(
    trayBounds,
    screen.getAllDisplays().map(({ bounds }) => bounds),
    screen.getCursorScreenPoint(),
  );
  const display = screen.getDisplayNearestPoint(currentPoint);
  const minHeight =
    contentHeight && contentHeight < COMPACT_WINDOW_HEIGHT
      ? Math.max(MINI_WINDOW_HEIGHT, contentHeight)
      : visible
        ? WINDOW_SIZE.height
        : COMPACT_WINDOW_HEIGHT;
  const height = clampPopoverHeight(
    contentHeight,
    minHeight,
    display.workArea.height,
  );
  const [currentWidth, currentHeight] = window.getContentSize();
  if (currentWidth !== WINDOW_SIZE.width || currentHeight !== height) {
    window.setContentSize(WINDOW_SIZE.width, height);
  }

  if (customPosition) {
    const clamped = clampWindowPosition(
      customPosition,
      { width: WINDOW_SIZE.width, height },
      display.workArea,
    );
    window.setPosition(clamped.x, clamped.y, false);
  } else {
    positionNearTray(window, trayBounds);
  }
};

const loadRenderer = async (window: BrowserWindow): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  await window.loadFile(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  );
};

export const startApplication = (): void => {
  process.env.PATH = ensurePlatformPath();
  let isQuitting = false;
  let shutdown: (() => Promise<void>) | undefined;
  let beforeQuit: ((event: { preventDefault(): void }) => void) | undefined;
  let mainWindow: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let tokensVisible = true;
  let requestedContentHeight: number | undefined;
  let isAlwaysOnTop = false;
  let customPosition: { x: number; y: number } | undefined;
  let idleUnloadTimer: ReturnType<typeof setTimeout> | undefined;
  let ipcController: ReturnType<typeof registerIpcHandlers> | undefined;
  let coreInstance: UsageMonitorCore | undefined;

  const IDLE_UNLOAD_DELAY_MS = 30_000;

  const { isDevMode } = configureRuntime(app, process.env, Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL));
  if (isDevMode) {
    registerRuntimeDiagnostics(app, MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? "hmr" : app.isPackaged ? "packaged" : "unpackaged");
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const cancelIdleUnload = (): void => {
    if (idleUnloadTimer) {
      clearTimeout(idleUnloadTimer);
      idleUnloadTimer = undefined;
    }
  };

  const scheduleIdleUnload = (keepVisibleForTest = false): void => {
    cancelIdleUnload();
    if (isAlwaysOnTop || keepVisibleForTest || isDevMode) {
      return;
    }
    idleUnloadTimer = setTimeout(() => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isVisible() &&
        !isAlwaysOnTop &&
        !keepVisibleForTest &&
        !isDevMode
      ) {
        mainWindow.destroy();
        mainWindow = undefined;
        if (typeof global.gc === "function") {
          try {
            global.gc();
          } catch {
            // ignore
          }
        }
      }
    }, IDLE_UNLOAD_DELAY_MS);
  };

  const createMainWindow = async (keepVisibleForTest = false): Promise<BrowserWindow> => {
    const window = new BrowserWindow({
      width: WINDOW_SIZE.width,
      height: COMPACT_WINDOW_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: "LLM Usage Monitor",
      icon: createTrayIcon(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        sandbox: true,
        webSecurity: true,
      },
    });

    if (isAlwaysOnTop) {
      window.setAlwaysOnTop(true, getAlwaysOnTopLevel());
    }

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (isDevMode) {
      registerRendererDiagnostics(window.webContents);
    }
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        if (!isAlwaysOnTop) {
          window.hide();
          scheduleIdleUnload(keepVisibleForTest);
        }
      }
    });
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    window.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        window.hide();
        scheduleIdleUnload(keepVisibleForTest);
      }
    });
    window.on("moved", () => {
      if (isQuitting || window.isDestroyed()) return;
      const position = window.getPosition();
      const x = position[0];
      const y = position[1];
      if (typeof x === "number" && typeof y === "number") {
        customPosition = { x, y };
      }
    });
    window.on("blur", () => {
      if (!keepVisibleForTest && !isAlwaysOnTop) {
        window.hide();
        scheduleIdleUnload(keepVisibleForTest);
      }
    });
    window.on("closed", () => {
      if (mainWindow === window) {
        mainWindow = undefined;
      }
    });

    await loadRenderer(window);
    return window;
  };

  const showWindow = async (keepVisibleForTest = false): Promise<void> => {
    if (isQuitting) {
      return;
    }
    cancelIdleUnload();
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = await createMainWindow(keepVisibleForTest);
    }
    resizeWindow(
      mainWindow,
      tray?.getBounds(),
      tokensVisible,
      requestedContentHeight,
      customPosition,
    );
    mainWindow.show();
    mainWindow.focus();
    if (coreInstance && ipcController) {
      ipcController.publishState(coreInstance.getState());
    }
  };

  app.on("second-instance", () => { void showWindow(); });
  app.on("activate", () => { void showWindow(); });
  app.on("before-quit", (event) => {
    isQuitting = true;
    cancelIdleUnload();
    beforeQuit?.(event);
  });
  app.on("window-all-closed", () => {
    // The tray owns the Windows application lifecycle.
  });

  void app.whenReady().then(async () => {
    setupPlatformDock(app);
    const useFakeProviders = process.env.LLM_USAGE_MONITOR_E2E === "1";
    const keepVisibleForTest =
      useFakeProviders &&
      process.env.LLM_USAGE_MONITOR_E2E_KEEP_VISIBLE !== "0";

    const core = await UsageMonitorCore.create({
      userDataDir: app.getPath("userData"),
      useFakeProviders,
    });
    coreInstance = core;
    const setupWasReady = await core.isClaudeSetupReady();

    const preferencesPath = path.join(
      app.getPath("userData"),
      "preferences-v1.json",
    );
    const storedPrefs = await loadStoredPreferences(preferencesPath);
    isAlwaysOnTop = storedPrefs.alwaysOnTop ?? false;

    mainWindow = await createMainWindow(keepVisibleForTest);

    const refreshUsage = (providerId?: ProviderId): Promise<void> =>
      core.refresh(providerId);

    ipcController = registerIpcHandlers(ipcMain, () => mainWindow, {
      getState: async () => core.getState(),
      refresh: async (providerId) => {
        if (isQuitting) return;
        await refreshUsage(providerId);
      },
      getPreferences: async () => ({
        launchAtLogin: app.getLoginItemSettings().openAtLogin,
        alwaysOnTop: isAlwaysOnTop,
      }),
      setLaunchAtLogin: async (enabled) => {
        if (isQuitting) {
          return {
            launchAtLogin: app.getLoginItemSettings().openAtLogin,
            alwaysOnTop: isAlwaysOnTop,
          };
        }
        app.setLoginItemSettings({ openAtLogin: enabled });
        return {
          launchAtLogin: app.getLoginItemSettings().openAtLogin,
          alwaysOnTop: isAlwaysOnTop,
        };
      },
      setTokensVisible: async (visible, contentHeight) => {
        if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
        tokensVisible = visible;
        requestedContentHeight = contentHeight;
        resizeWindow(mainWindow, tray?.getBounds(), visible, contentHeight, customPosition);
      },
      openClaudeSetup,
      openAntigravitySetup,
      getAlwaysOnTop: async () => isAlwaysOnTop,
      setAlwaysOnTop: async (enabled) => {
        isAlwaysOnTop = enabled;
        if (enabled) {
          cancelIdleUnload();
        } else if (mainWindow && !mainWindow.isVisible()) {
          scheduleIdleUnload(keepVisibleForTest);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(enabled, getAlwaysOnTopLevel());
        }
        void saveStoredPreferences(preferencesPath, { alwaysOnTop: enabled });
        return isAlwaysOnTop;
      },
    });

    const updateTrayTooltip = (snapshot: AppSnapshot): void => {
      if (!tray) return;
      const incidents = snapshot.providers
        .filter(
          (p) =>
            p.serviceStatus &&
            (p.serviceStatus.indicator === "minor" ||
              p.serviceStatus.indicator === "major" ||
              p.serviceStatus.indicator === "critical"),
        )
        .map((p) => (p.providerId === "claude" ? "Claude" : p.providerId === "codex" ? "Codex" : "Antigravity"));

      if (incidents.length > 0) {
        tray.setToolTip(`LLM Usage Monitor (⚠️ ${incidents.join(", ")} incident)`);
      } else {
        tray.setToolTip("LLM Usage Monitor");
      }
    };

    const unsubscribe = core.subscribe((snapshot) => {
      ipcController?.publishState(snapshot);
      updateTrayTooltip(snapshot);
    });

    let shutdownPromise: Promise<void> | undefined;
    shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        cancelIdleUnload();
        mainWindow?.hide();
        mainWindow?.destroy();
        mainWindow = undefined;
        unsubscribe();
        ipcController?.dispose();
        try {
          await core.stop();
        } finally {
          tray?.destroy();
          tray = undefined;
        }
      })();
      return shutdownPromise;
    };

    beforeQuit = createBeforeQuitHandler({
      hide: () => {
        cancelIdleUnload();
        mainWindow?.hide();
      },
      shutdown,
      quit: () => app.quit(),
    });

    void core.start().catch(() => undefined);

    const refreshAll = (): void => {
      if (isQuitting) return;
      void refreshUsage().catch(() => undefined);
    };
    const updateLaunchAtLogin = (enabled: boolean): void => {
      if (isQuitting) return;
      app.setLoginItemSettings({ openAtLogin: enabled });
    };

    tray = new Tray(createTrayIcon());
    tray.setToolTip("LLM Usage Monitor");
    if (process.platform === "darwin") {
      tray.setIgnoreDoubleClickEvents(true);
    }
    const buildTrayMenu = () =>
      Menu.buildFromTemplate(
        createTrayMenuTemplate(
          () => app.getLoginItemSettings().openAtLogin,
          {
            open: () => { void showWindow(keepVisibleForTest); },
            refresh: refreshAll,
            setLaunchAtLogin: updateLaunchAtLogin,
            resetPosition: () => {
              customPosition = undefined;
              void showWindow(keepVisibleForTest);
            },
            quit: () => {
              isQuitting = true;
              app.quit();
            },
          },
        ),
      );
    tray.on("right-click", () => {
      if (!isQuitting) tray?.popUpContextMenu(buildTrayMenu());
    });
    tray.on("click", () => {
      if (isQuitting) return;
      if (mainWindow?.isVisible()) {
        if (isAlwaysOnTop) {
          mainWindow.focus();
        } else {
          mainWindow.hide();
          scheduleIdleUnload(keepVisibleForTest);
        }
      } else {
        void showWindow(keepVisibleForTest);
      }
    });

    const isAutostart =
      process.argv.includes("--hidden") ||
      process.argv.includes("--autostart");
    const shouldShowInitially =
      keepVisibleForTest ||
      isDevMode ||
      (process.platform === "darwin" ? !isAutostart : !setupWasReady);

    if (shouldShowInitially) {
      void showWindow(keepVisibleForTest);
    } else {
      scheduleIdleUnload(keepVisibleForTest);
    }
  }).catch(async () => {
    // 인증 및 provider 오류 본문을 포함할 수 있는 예외는 출력하지 않는다.
    console.error('[runtime] {"event":"startup-failed"}');
    isQuitting = true;
    try { await shutdown?.(); } finally { app.exit(1); }
  });
};
