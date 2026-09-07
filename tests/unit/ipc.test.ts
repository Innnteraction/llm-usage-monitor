import type { BrowserWindow, IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../../src/main/index";
import {
  IPC_CHANNELS,
  type AppSnapshot,
  type UserPreferences,
} from "../../src/shared/index";

type InvokeHandler = (
  event: { sender: unknown; senderFrame: unknown },
  ...args: unknown[]
) => unknown;

const snapshot: AppSnapshot = {
  schemaVersion: 1,
  providers: [],
  refreshing: [],
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const createHarness = () => {
  const handlers = new Map<string, InvokeHandler>();
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  } as unknown as IpcMain;

  const mainFrame = {};
  const webContents = {
    mainFrame,
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const window = { webContents } as unknown as BrowserWindow;
  const preferences: UserPreferences = { launchAtLogin: false };
  const dependencies = {
    getState: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => undefined),
    getPreferences: vi.fn(async () => preferences),
    setLaunchAtLogin: vi.fn(async (enabled: boolean) => ({
      launchAtLogin: enabled,
    })),
    setTokensVisible: vi.fn(async () => undefined),
    openClaudeSetup: vi.fn(async () => ({ opened: true })),
    getAlwaysOnTop: vi.fn(async () => false),
    setAlwaysOnTop: vi.fn(async (enabled: boolean) => enabled),
  };

  const controller = registerIpcHandlers(ipcMain, window, dependencies);
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  return { controller, dependencies, handlers, trustedEvent, webContents };
};

describe("restricted IPC handlers", () => {
  it("returns a validated snapshot to the trusted renderer frame", async () => {
    const { handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.getState);

    await expect(handler?.(trustedEvent)).resolves.toEqual(snapshot);
  });

  it("rejects untrusted senders before invoking dependencies", async () => {
    const { dependencies, handlers } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.getState);

    await expect(
      handler?.({ sender: {}, senderFrame: {} }),
    ).rejects.toThrow("Untrusted IPC sender");
    expect(dependencies.getState).not.toHaveBeenCalled();
  });

  it("rejects refresh payloads outside the public provider IDs", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.refresh);

    await expect(
      handler?.(trustedEvent, { providerId: "unknown" }),
    ).rejects.toThrow();
    expect(dependencies.refresh).not.toHaveBeenCalled();
  });

  it("allows only fixed Claude setup actions", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.openClaudeSetup);

    await expect(
      handler?.(trustedEvent, { action: "login" }),
    ).resolves.toEqual({ opened: true });
    await expect(
      handler?.(trustedEvent, { action: "arbitrary-command" }),
    ).rejects.toThrow();
    expect(dependencies.openClaudeSetup).toHaveBeenCalledTimes(1);
  });

  it("accepts a strict token visibility payload with an optional bounded height", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.setTokensVisible);

    await expect(handler?.(trustedEvent, { visible: false })).resolves.toBeUndefined();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: 304 })).resolves.toBeUndefined();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: 0 })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: 304.5 })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: 4097 })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: Number.NaN })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: false, contentHeight: Number.POSITIVE_INFINITY })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: false, height: 1 })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: "false" })).rejects.toThrow();
    expect(dependencies.setTokensVisible).toHaveBeenCalledTimes(2);
    expect(dependencies.setTokensVisible).toHaveBeenNthCalledWith(1, false, undefined);
    expect(dependencies.setTokensVisible).toHaveBeenNthCalledWith(2, false, 304);
  });

  it("rejects untrusted token visibility requests before changing the window", async () => {
    const { dependencies, handlers } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.setTokensVisible);

    await expect(
      handler?.({ sender: {}, senderFrame: {} }, { visible: false }),
    ).rejects.toThrow("Untrusted IPC sender");
    expect(dependencies.setTokensVisible).not.toHaveBeenCalled();
  });

  it("propagates token visibility dependency failures", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.setTokensVisible);
    dependencies.setTokensVisible.mockRejectedValueOnce(new Error("resize failed"));

    await expect(handler?.(trustedEvent, { visible: true })).rejects.toThrow(
      "resize failed",
    );
  });

  it("gets and sets alwaysOnTop state with schema validation", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const getHandler = handlers.get(IPC_CHANNELS.getAlwaysOnTop);
    const setHandler = handlers.get(IPC_CHANNELS.setAlwaysOnTop);

    await expect(getHandler?.(trustedEvent)).resolves.toEqual({ alwaysOnTop: false });
    expect(dependencies.getAlwaysOnTop).toHaveBeenCalledTimes(1);

    await expect(setHandler?.(trustedEvent, { enabled: true })).resolves.toEqual({ alwaysOnTop: true });
    expect(dependencies.setAlwaysOnTop).toHaveBeenCalledWith(true);

    await expect(setHandler?.(trustedEvent, { enabled: "true" })).rejects.toThrow();
  });

  it("publishes only schema-valid state and removes handlers", () => {
    const { controller, handlers, webContents } = createHarness();

    controller.publishState(snapshot);
    expect(webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.stateChanged,
      snapshot,
    );

    controller.dispose();
    expect(handlers.size).toBe(0);
  });

  it("silently swallows frame disposal errors when publishing state", () => {
    const { controller, webContents } = createHarness();
    webContents.send.mockImplementationOnce(() => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    });

    expect(() => controller.publishState(snapshot)).not.toThrow();
  });
});
