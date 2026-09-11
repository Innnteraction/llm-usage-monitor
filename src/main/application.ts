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
import type { ProviderId } from "../shared/index";
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

  const { isDevMode } = configureRuntime(app, process.env, Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL));
  if (isDevMode) {
    registerRuntimeDiagnostics(app, MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? "hmr" : app.isPackaged ? "packaged" : "unpackaged");
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const showWindow = (): void => {
    if (isQuitting || !mainWindow) {
      return;
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
  };

  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", (event) => {
    isQuitting = true;
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
    const setupWasReady = await core.isClaudeSetupReady();

    const preferencesPath = path.join(
      app.getPath("userData"),
      "preferences-v1.json",
    );
    const storedPrefs = await loadStoredPreferences(preferencesPath);
    isAlwaysOnTop = storedPrefs.alwaysOnTop ?? false;

    mainWindow = new BrowserWindow({
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
      mainWindow.setAlwaysOnTop(true, getAlwaysOnTopLevel());
    }

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (isDevMode) {
      registerRendererDiagnostics(mainWindow.webContents);
    }
    mainWindow.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    mainWindow.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        if (!isAlwaysOnTop) {
          mainWindow?.hide();
        }
      }
    });
    mainWindow.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    mainWindow.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on("moved", () => {
      if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      const position = mainWindow.getPosition();
      const x = position[0];
      const y = position[1];
      if (typeof x === "number" && typeof y === "number") {
        customPosition = { x, y };
      }
    });
    mainWindow.on("blur", () => {
      if (!keepVisibleForTest && !isAlwaysOnTop) {
        mainWindow?.hide();
      }
    });

    const refreshUsage = (providerId?: ProviderId): Promise<void> =>
      core.refresh(providerId);

    const ipcController = registerIpcHandlers(ipcMain, mainWindow, {
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
      getAlwaysOnTop: async () => isAlwaysOnTop,
      setAlwaysOnTop: async (enabled) => {
        isAlwaysOnTop = enabled;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(enabled, getAlwaysOnTopLevel());
        }
        void saveStoredPreferences(preferencesPath, { alwaysOnTop: enabled });
        return isAlwaysOnTop;
      },
    });

    const unsubscribe = core.subscribe(ipcController.publishState);

    let shutdownPromise: Promise<void> | undefined;
    shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        mainWindow?.hide();
        unsubscribe();
        ipcController.dispose();
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
      hide: () => mainWindow?.hide(),
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
            open: showWindow,
            refresh: refreshAll,
            setLaunchAtLogin: updateLaunchAtLogin,
            resetPosition: () => {
              customPosition = undefined;
              if (mainWindow && !mainWindow.isDestroyed()) {
                positionNearTray(mainWindow, tray?.getBounds());
                mainWindow.show();
                mainWindow.focus();
              }
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
        }
      } else {
        showWindow();
      }
    });

    const isAutostart =
      process.argv.includes("--hidden") ||
      process.argv.includes("--autostart");
    const shouldShowInitially =
      keepVisibleForTest ||
      isDevMode ||
      (process.platform === "darwin" ? !isAutostart : !setupWasReady);

    mainWindow.once("ready-to-show", () => {
      if (shouldShowInitially) {
        showWindow();
      }
    });
    mainWindow.on("closed", () => {
      void shutdown?.().catch(() => undefined);
      mainWindow = undefined;
    });
    await loadRenderer(mainWindow);
  }).catch(async () => {
    // 인증 및 provider 오류 본문을 포함할 수 있는 예외는 출력하지 않는다.
    console.error('[runtime] {"event":"startup-failed"}');
    isQuitting = true;
    try { await shutdown?.(); } finally { app.exit(1); }
  });
};
