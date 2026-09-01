import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  Tray,
  type Rectangle,
} from "electron";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ClaudeQuotaProvider,
  CodexQuotaProvider,
  createClaudeInitialSnapshot,
  createCodexInitialSnapshot,
} from "../providers/index";
import { createUsagePoller, createUsageStore } from "../usage/index";
import {
  openClaudeSetup,
} from "./claudeSetup";
import {
  registerIpcHandlers,
} from "./ipc";
import {
  mergeCachedSnapshots,
  SNAPSHOT_CACHE_FILENAME,
  SnapshotCache,
} from "./snapshotCache";
import { createFakeUsageStore } from "./fakeUsage";
import { createTrayIcon } from "./trayIcon";

const WINDOW_SIZE = { width: 420, height: 320 };
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

export const calculatePopoverPosition = (
  anchor: { x: number; y: number },
  workArea: Rectangle,
): { x: number; y: number } => ({
  x: Math.min(
    Math.max(anchor.x - Math.round(WINDOW_SIZE.width / 2), workArea.x),
    workArea.x + workArea.width - WINDOW_SIZE.width,
  ),
  y: workArea.y + workArea.height - WINDOW_SIZE.height,
});

const positionNearTray = (
  window: BrowserWindow,
  trayBounds?: Rectangle,
): void => {
  const cursor = screen.getCursorScreenPoint();
  const anchor = trayBounds
    ? {
        x: trayBounds.x + Math.round(trayBounds.width / 2),
        y: trayBounds.y + Math.round(trayBounds.height / 2),
      }
    : cursor;
  const display = screen.getDisplayNearestPoint(anchor);
  const position = calculatePopoverPosition(anchor, display.workArea);
  window.setPosition(position.x, position.y, false);
};

const loadRenderer = (window: BrowserWindow): void => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  void window.loadFile(
    path.join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    ),
  );
};

export const startApplication = (): void => {
  let isQuitting = false;
  let mainWindow: BrowserWindow | undefined;
  let tray: Tray | undefined;

  const packagedSmoke =
    process.env.LLM_USAGE_MONITOR_CLAUDE_PACKAGED_SMOKE === "1";
  const e2eUserData =
    process.env.LLM_USAGE_MONITOR_E2E_USER_DATA ??
    (packagedSmoke
      ? path.join(tmpdir(), `llm-usage-monitor-smoke-${process.pid}`)
      : undefined);
  const usesIsolatedTestData =
    process.env.LLM_USAGE_MONITOR_E2E === "1" ||
    packagedSmoke;
  if (usesIsolatedTestData && e2eUserData) {
    app.setPath("userData", path.resolve(e2eUserData));
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const showWindow = (): void => {
    if (!mainWindow) {
      return;
    }
    positionNearTray(mainWindow, tray?.getBounds());
    mainWindow.show();
    mainWindow.focus();
  };

  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("window-all-closed", () => {
    // The tray owns the Windows application lifecycle.
  });

  void app.whenReady().then(async () => {
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
    const providers = [new CodexQuotaProvider(), new ClaudeQuotaProvider()];
    const defaultSnapshots = [
      createCodexInitialSnapshot(initialTime),
      createClaudeInitialSnapshot(initialTime),
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

    mainWindow = new BrowserWindow({
      ...WINDOW_SIZE,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: "LLM Usage Monitor",
      icon: path.join(
        app.getAppPath(),
        "assets",
        "icons",
        "app-icon.ico",
      ),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        sandbox: true,
        webSecurity: true,
      },
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        mainWindow?.hide();
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
    mainWindow.on("blur", () => {
      if (!keepVisibleForTest) {
        mainWindow?.hide();
      }
    });

    const ipcController = registerIpcHandlers(ipcMain, mainWindow, {
      getState: async () => store.getState(),
      refresh: async (providerId) =>
        poller?.refresh(providerId) ?? store.refresh(providerId),
      getPreferences: async () => ({
        launchAtLogin: app.getLoginItemSettings().openAtLogin,
      }),
      setLaunchAtLogin: async (enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return { launchAtLogin: app.getLoginItemSettings().openAtLogin };
      },
      openClaudeSetup,
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
        void markClaudeSetupReady(markerPath).catch(() => {
          setupReadyWritten = false;
        });
      }
    });
    void poller?.start();

    const refreshAll = (): void => {
      void (poller?.refresh() ?? store.refresh());
    };
    const updateLaunchAtLogin = (enabled: boolean): void => {
      app.setLoginItemSettings({ openAtLogin: enabled });
    };
    tray = new Tray(createTrayIcon());
    tray.setToolTip("LLM Usage Monitor");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "열기", click: showWindow },
        { label: "새로고침", click: refreshAll },
        {
          label: "Windows 로그인 시 시작",
          type: "checkbox",
          checked: app.getLoginItemSettings().openAtLogin,
          click: (menuItem) => updateLaunchAtLogin(menuItem.checked),
        },
        { type: "separator" },
        {
          label: "종료",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("click", () => {
      if (mainWindow?.isVisible()) {
        mainWindow.hide();
      } else {
        showWindow();
      }
    });

    mainWindow.once("ready-to-show", () => {
      if (keepVisibleForTest || !setupWasReady) {
        showWindow();
      }
    });
    mainWindow.on("closed", () => {
      poller?.stop();
      unsubscribe();
      unsubscribeCache();
      unsubscribeSetup();
      ipcController.dispose();
      tray?.destroy();
      tray = undefined;
      mainWindow = undefined;
    });
    loadRenderer(mainWindow);
  });
};
