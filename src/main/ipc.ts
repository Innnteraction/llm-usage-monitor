import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from "electron";
import {
  IPC_CHANNELS,
  appSnapshotSchema,
  noPayloadSchema,
  refreshPayloadSchema,
  refreshResultSchema,
  setLaunchAtLoginPayloadSchema,
  userPreferencesSchema,
  type AppSnapshot,
  type ProviderId,
  type UserPreferences,
} from "../shared/index";

export interface IpcDependencies {
  getState(): Promise<AppSnapshot>;
  refresh(providerId?: ProviderId): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  setLaunchAtLogin(enabled: boolean): Promise<UserPreferences>;
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
    },
  };
};
