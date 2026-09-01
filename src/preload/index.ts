import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";
import {
  IPC_CHANNELS,
  appSnapshotSchema,
  openClaudeSetupPayloadSchema,
  openClaudeSetupResultSchema,
  refreshPayloadSchema,
  refreshResultSchema,
  setLaunchAtLoginPayloadSchema,
  userPreferencesSchema,
  type UsageMonitorAPI,
} from "../shared/index";

const api: UsageMonitorAPI = {
  async getState() {
    return appSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.getState),
    );
  },
  async refresh(providerId) {
    const payload = refreshPayloadSchema.parse({ providerId });
    return refreshResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.refresh, payload),
    );
  },
  subscribe(listener) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      const result = appSnapshotSchema.safeParse(payload);
      if (result.success) {
        listener(result.data);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.stateChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.stateChanged, wrapped);
    };
  },
  async getPreferences() {
    return userPreferencesSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.getPreferences),
    );
  },
  async setLaunchAtLogin(enabled) {
    const payload = setLaunchAtLoginPayloadSchema.parse({ enabled });
    return userPreferencesSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.setLaunchAtLogin, payload),
    );
  },
  async openClaudeSetup(action) {
    const payload = openClaudeSetupPayloadSchema.parse({ action });
    return openClaudeSetupResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.openClaudeSetup, payload),
    );
  },
};

contextBridge.exposeInMainWorld("usageMonitor", api);
