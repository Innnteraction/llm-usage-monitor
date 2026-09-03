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

  it("accepts only a strict boolean token visibility payload", async () => {
    const { dependencies, handlers, trustedEvent } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.setTokensVisible);

    await expect(handler?.(trustedEvent, { visible: false })).resolves.toBeUndefined();
    await expect(handler?.(trustedEvent, { visible: false, height: 1 })).rejects.toThrow();
    await expect(handler?.(trustedEvent, { visible: "false" })).rejects.toThrow();
    expect(dependencies.setTokensVisible).toHaveBeenCalledTimes(1);
    expect(dependencies.setTokensVisible).toHaveBeenCalledWith(false);
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
});
