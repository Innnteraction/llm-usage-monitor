import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  Tray,
  type Rectangle,
} from "electron";
import path from "node:path";
import {
  CodexQuotaProvider,
  createCodexInitialSnapshot,
} from "../providers/index";
import type { ProviderSnapshot } from "../shared/index";
import { createUsageStore } from "../usage/index";
import { registerIpcHandlers } from "./index";
import { createFakeUsageStore } from "./fakeUsage";
import { createTrayIcon } from "./trayIcon";

const WINDOW_SIZE = { width: 420, height: 600 };

const createClaudePlaceholder = (fetchedAt: Date): ProviderSnapshot => ({
  providerId: "claude",
  status: "unavailable",
  fetchedAt: fetchedAt.toISOString(),
  quotaWindows: [
    {
      id: "claude-five-hour",
      kind: "five_hour",
      label: "5h",
      source: "claude_cli",
      status: "unavailable",
    },
    {
      id: "claude-weekly",
      kind: "weekly",
      label: "Weekly",
      source: "claude_cli",
      status: "unavailable",
    },
  ],
  error: {
    code: "unavailable",
    message: "Claude Code quota integration is planned for Phase 3.",
  },
});

const positionNearTray = (
  window: BrowserWindow,
  trayBounds?: Rectangle,
): void => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(
    trayBounds
      ? {
          x: trayBounds.x + Math.round(trayBounds.width / 2),
          y: trayBounds.y + Math.round(trayBounds.height / 2),
        }
      : cursor,
  );
  const workArea = display.workArea;
  const anchorX = trayBounds
    ? trayBounds.x + Math.round(trayBounds.width / 2)
    : cursor.x;
  const x = Math.min(
    Math.max(anchorX - Math.round(WINDOW_SIZE.width / 2), workArea.x),
    workArea.x + workArea.width - WINDOW_SIZE.width,
  );
  const y = workArea.y + workArea.height - WINDOW_SIZE.height;
  window.setPosition(x, y, false);
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
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("window-all-closed", () => {
    // The tray owns the Windows application lifecycle.
  });

  void app.whenReady().then(() => {
    const useFakeProviders = process.env.LLM_USAGE_MONITOR_E2E === "1";
    const initialTime = new Date();
    const store = useFakeProviders
      ? createFakeUsageStore()
      : createUsageStore({
          providers: [new CodexQuotaProvider()],
          initialSnapshots: [
            createCodexInitialSnapshot(initialTime),
            createClaudePlaceholder(initialTime),
          ],
        });
    mainWindow = new BrowserWindow({
      ...WINDOW_SIZE,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
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
      if (process.env.LLM_USAGE_MONITOR_E2E !== "1") {
        mainWindow?.hide();
      }
    });

    const ipcController = registerIpcHandlers(ipcMain, mainWindow, {
      getState: async () => store.getState(),
      refresh: async (providerId) => store.refresh(providerId),
      getPreferences: async () => ({
        launchAtLogin: app.getLoginItemSettings().openAtLogin,
      }),
      setLaunchAtLogin: async (enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return { launchAtLogin: app.getLoginItemSettings().openAtLogin };
      },
    });
    const unsubscribe = store.subscribe(ipcController.publishState);
    if (!useFakeProviders) {
      void store.refresh("codex");
    }

    tray = new Tray(createTrayIcon());
    tray.setToolTip("LLM Usage Monitor");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "열기", click: showWindow },
        { label: "새로고침", click: () => void store.refresh() },
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
      if (process.env.LLM_USAGE_MONITOR_E2E === "1") {
        showWindow();
      }
    });
    mainWindow.on("closed", () => {
      unsubscribe();
      ipcController.dispose();
      mainWindow = undefined;
    });
    loadRenderer(mainWindow);
  });
};
