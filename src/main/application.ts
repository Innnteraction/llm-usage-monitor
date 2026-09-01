import {
  app,
  BrowserWindow,
  ipcMain,
} from "electron";
import path from "node:path";
import {
  ClaudeQuotaProvider,
  CodexQuotaProvider,
  createClaudeInitialSnapshot,
  createCodexInitialSnapshot,
} from "../providers/index";
import { createUsagePoller, createUsageStore } from "../usage/index";
import { registerIpcHandlers } from "./index";
import { createFakeUsageStore } from "./fakeUsage";

const WINDOW_SIZE = { width: 420, height: 320 };

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
  let mainWindow: BrowserWindow | undefined;

  const e2eUserData = process.env.LLM_USAGE_MONITOR_E2E_USER_DATA;
  if (process.env.LLM_USAGE_MONITOR_E2E === "1" && e2eUserData) {
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
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  };

  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => {
    app.quit();
  });

  void app.whenReady().then(() => {
    const useFakeProviders = process.env.LLM_USAGE_MONITOR_E2E === "1";
    const initialTime = new Date();
    const providers = [new CodexQuotaProvider(), new ClaudeQuotaProvider()];
    const store = useFakeProviders
      ? createFakeUsageStore()
      : createUsageStore({
          providers,
          initialSnapshots: [
            createCodexInitialSnapshot(initialTime),
            createClaudeInitialSnapshot(initialTime),
          ],
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
      frame: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      title: "LLM Usage Monitor",
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
    });
    const unsubscribe = store.subscribe(ipcController.publishState);
    void poller?.start();

    mainWindow.once("ready-to-show", () => {
      showWindow();
    });
    mainWindow.on("closed", () => {
      poller?.stop();
      unsubscribe();
      ipcController.dispose();
      mainWindow = undefined;
    });
    loadRenderer(mainWindow);
  });
};
