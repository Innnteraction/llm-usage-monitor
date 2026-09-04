import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from "electron";
import {
  IPC_CHANNELS,
  alwaysOnTopResultSchema,
  appSnapshotSchema,
  noPayloadSchema,
  openClaudeSetupPayloadSchema,
  openClaudeSetupResultSchema,
  refreshPayloadSchema,
  refreshResultSchema,
  setAlwaysOnTopPayloadSchema,
  setLaunchAtLoginPayloadSchema,
  setTokensVisiblePayloadSchema,
  userPreferencesSchema,
  type AppSnapshot,
  type ClaudeSetupAction,
  type ProviderId,
  type UserPreferences,
} from "../shared/index";

export interface IpcDependencies {
  getState(): Promise<AppSnapshot>;
  refresh(providerId?: ProviderId): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  setLaunchAtLogin(enabled: boolean): Promise<UserPreferences>;
  setTokensVisible(visible: boolean, contentHeight?: number): Promise<void>;
  openClaudeSetup(action: ClaudeSetupAction): Promise<{ opened: boolean }>;
  getAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
}

const assertTrustedSender = (
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
): void => {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error("Untrusted IPC sender");
  }
};

const singlePayload = <T>(
  schema: { parse(value: unknown): T },
  args: unknown[],
): T => {
  if (args.length !== 1) {
    throw new Error("Invalid IPC payload count");
  }
  return schema.parse(args[0]);
};

export const registerIpcHandlers = (
  ipcMain: IpcMain,
  window: BrowserWindow,
  dependencies: IpcDependencies,
) => {
  ipcMain.handle(IPC_CHANNELS.getState, async (event, ...args) => {
    assertTrustedSender(event, window);
    noPayloadSchema.parse(args);
    return appSnapshotSchema.parse(await dependencies.getState());
  });

  ipcMain.handle(IPC_CHANNELS.refresh, async (event, ...args) => {
    assertTrustedSender(event, window);
    const { providerId } = singlePayload(refreshPayloadSchema, args);
    await dependencies.refresh(providerId);
    return refreshResultSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.getPreferences, async (event, ...args) => {
    assertTrustedSender(event, window);
    noPayloadSchema.parse(args);
    return userPreferencesSchema.parse(await dependencies.getPreferences());
  });

  ipcMain.handle(IPC_CHANNELS.setLaunchAtLogin, async (event, ...args) => {
    assertTrustedSender(event, window);
    const { enabled } = singlePayload(setLaunchAtLoginPayloadSchema, args);
    return userPreferencesSchema.parse(
      await dependencies.setLaunchAtLogin(enabled),
    );
  });

  ipcMain.handle(IPC_CHANNELS.setTokensVisible, async (event, ...args) => {
    assertTrustedSender(event, window);
    const { visible, contentHeight } = singlePayload(setTokensVisiblePayloadSchema, args);
    await dependencies.setTokensVisible(visible, contentHeight);
    return refreshResultSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.openClaudeSetup, async (event, ...args) => {
    assertTrustedSender(event, window);
    const { action } = singlePayload(openClaudeSetupPayloadSchema, args);
    return openClaudeSetupResultSchema.parse(
      await dependencies.openClaudeSetup(action),
    );
  });

  ipcMain.handle(IPC_CHANNELS.getAlwaysOnTop, async (event, ...args) => {
    assertTrustedSender(event, window);
    noPayloadSchema.parse(args);
    const alwaysOnTop = await dependencies.getAlwaysOnTop();
    return alwaysOnTopResultSchema.parse({ alwaysOnTop });
  });

  ipcMain.handle(IPC_CHANNELS.setAlwaysOnTop, async (event, ...args) => {
    assertTrustedSender(event, window);
    const { enabled } = singlePayload(setAlwaysOnTopPayloadSchema, args);
    const alwaysOnTop = await dependencies.setAlwaysOnTop(enabled);
    return alwaysOnTopResultSchema.parse({ alwaysOnTop });
  });

  return {
    publishState(snapshot: AppSnapshot): void {
      const safeSnapshot = appSnapshotSchema.parse(snapshot);
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.stateChanged, safeSnapshot);
      }
    },
    dispose(): void {
      ipcMain.removeHandler(IPC_CHANNELS.getState);
      ipcMain.removeHandler(IPC_CHANNELS.refresh);
      ipcMain.removeHandler(IPC_CHANNELS.getPreferences);
      ipcMain.removeHandler(IPC_CHANNELS.setLaunchAtLogin);
      ipcMain.removeHandler(IPC_CHANNELS.setTokensVisible);
      ipcMain.removeHandler(IPC_CHANNELS.openClaudeSetup);
      ipcMain.removeHandler(IPC_CHANNELS.getAlwaysOnTop);
      ipcMain.removeHandler(IPC_CHANNELS.setAlwaysOnTop);
    },
  };
};
