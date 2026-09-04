import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  Tray,
} from "electron";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ClaudeQuotaProvider,
  CodexQuotaProvider,
  AntigravityQuotaProvider,
  createClaudeInitialSnapshot,
  createCodexInitialSnapshot,
  createAntigravityInitialSnapshot,
} from "../providers/index";
import type { ProviderId } from "../shared/index";
import {
  createLocalUsageCoordinator,
  createUsagePoller,
  createUsageStore,
} from "../usage/index";
import {
  ClaudeLocalUsageScanner,
  CodexLocalUsageScanner,
  LocalUsageCheckpointStore,
} from "../local-usage/index";
import { openClaudeSetup } from "./claudeSetup";
import { registerIpcHandlers } from "./ipc";
import {
  ensurePlatformPath,
  getAlwaysOnTopLevel,
  setupPlatformDock,
} from "./platform/index";
import {
  mergeCachedSnapshots,
  SNAPSHOT_CACHE_FILENAME,
  SnapshotCache,
} from "./snapshotCache";
import { createFakeUsageStore } from "./fakeUsage";
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
const CLAUDE_SETUP_READY_MARKER = "claude-setup-ready-v1";

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const markClaudeSetupReady = async (filePath: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "ready\n", { encoding: "utf8", flag: "w" });
};

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

const MINI_WINDOW_HEIGHT = 160;

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

const loadRenderer = (window: BrowserWindow): void => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  void window.loadFile(
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
  let tokensVisible = false;
  let requestedContentHeight: number | undefined;
  let isAlwaysOnTop = false;
  let customPosition: { x: number; y: number } | undefined;

  const packagedSmoke =
    process.env.LLM_USAGE_MONITOR_CLAUDE_PACKAGED_SMOKE === "1";
  const e2eUserData =
    process.env.LLM_USAGE_MONITOR_E2E_USER_DATA ??
    (packagedSmoke
      ? path.join(tmpdir(), `llm-usage-monitor-smoke-${process.pid}`)
      : undefined);
  const usesIsolatedTestData =
    process.env.LLM_USAGE_MONITOR_E2E === "1" || packagedSmoke;
  if (usesIsolatedTestData && e2eUserData) {
    app.setPath("userData", path.resolve(e2eUserData));
  }

  const isDevMode = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  if (isDevMode) {
    app.commandLine.appendSwitch("disable-http-cache");
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
    const markerPath = path.join(
      app.getPath("userData"),
      CLAUDE_SETUP_READY_MARKER,
    );
    const setupWasReady = await pathExists(markerPath);
    const initialTime = new Date();
    const antigravityProvider = new AntigravityQuotaProvider();
    const providers = [new CodexQuotaProvider(), new ClaudeQuotaProvider(), antigravityProvider];
    const defaultSnapshots = [
      createCodexInitialSnapshot(initialTime),
      createClaudeInitialSnapshot(initialTime),
      createAntigravityInitialSnapshot(initialTime),
    ];
    const snapshotCache = useFakeProviders
      ? undefined
      : new SnapshotCache(
          path.join(app.getPath("userData"), SNAPSHOT_CACHE_FILENAME),
        );
    const cachedSnapshots = (await snapshotCache?.load()) ?? [];
    const store = useFakeProviders
      ? createFakeUsageStore()
      : createUsageStore({
          providers,
          initialSnapshots: mergeCachedSnapshots(
            defaultSnapshots,
            cachedSnapshots,
          ),
        });
    const poller = useFakeProviders
      ? undefined
      : createUsagePoller({
          store,
          providerIds: providers.map(({ id }) => id),
        });
    const checkpointStore = useFakeProviders
      ? undefined
      : new LocalUsageCheckpointStore(
          path.join(app.getPath("userData"), "local-usage-index-v1.json"),
        );
    const localUsageCoordinator = useFakeProviders
      ? undefined
      : createLocalUsageCoordinator({
          store,
          scanners: [
            new CodexLocalUsageScanner({
              checkpointStore: checkpointStore!,
            }),
            new ClaudeLocalUsageScanner({
              checkpointStore: checkpointStore!,
            }),
          ],
        });
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

    const pendingBackground = new Set<Promise<unknown>>();
    const trackBackground = <T>(operation: Promise<T>): Promise<T> => {
      pendingBackground.add(operation);
      void operation.then(
        () => pendingBackground.delete(operation),
        () => pendingBackground.delete(operation),
      );
      return operation;
    };
    const refreshUsage = (providerId?: ProviderId): Promise<void> =>
      trackBackground(
        Promise.all([
          poller?.refresh(providerId) ?? store.refresh(providerId),
          providerId === "antigravity"
            ? undefined
            : localUsageCoordinator?.refresh(providerId),
        ]).then(() => undefined),
      );

    const ipcController = registerIpcHandlers(ipcMain, mainWindow, {
      getState: async () => store.getState(),
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
    const unsubscribe = store.subscribe(ipcController.publishState);
    const unsubscribeCache = snapshotCache
      ? store.subscribe((state) => {
          void snapshotCache.save(state);
        })
      : () => undefined;
    let setupReadyWritten = setupWasReady;
    const unsubscribeSetup = store.subscribe((state) => {
      if (
        !setupReadyWritten &&
        state.providers.some(
          ({ providerId, status }) =>
            providerId === "claude" && status === "fresh",
        )
      ) {
        setupReadyWritten = true;
        void trackBackground(
          markClaudeSetupReady(markerPath).catch(() => {
            setupReadyWritten = false;
          }),
        );
      }
    });
    let shutdownPromise: Promise<void> | undefined;
    shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        mainWindow?.hide();
        unsubscribe();
        unsubscribeCache();
        unsubscribeSetup();
        ipcController.dispose();
        try {
          await Promise.allSettled([
            antigravityProvider.close(),
            poller?.stop(),
            localUsageCoordinator?.stop(),
            ...pendingBackground,
          ]);
        } finally {
          try {
            await snapshotCache?.flush();
          } catch {
            // A best-effort cache flush must not leave IPC or tray resources alive.
          }
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
    void Promise.all([poller?.start(), localUsageCoordinator?.start()]).catch(
      () => undefined,
    );

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

    mainWindow.once("ready-to-show", () => {
      if (keepVisibleForTest || isDevMode || !setupWasReady) {
        showWindow();
      }
    });
    mainWindow.on("closed", () => {
      void shutdown?.().catch(() => undefined);
      mainWindow = undefined;
    });
    loadRenderer(mainWindow);
  });
};
