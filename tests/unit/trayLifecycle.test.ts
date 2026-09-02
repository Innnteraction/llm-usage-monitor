import { describe, expect, it, vi } from "vitest";
import { createBeforeQuitHandler, createTrayMenuTemplate } from "../../src/main";

describe("tray lifecycle helpers", () => {
  it("reads the actual launch-at-login value whenever the menu is rebuilt", async () => {
    const getLaunchAtLogin = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const setLaunchAtLogin = vi.fn();
    const actions = { open: vi.fn(), refresh: vi.fn(), setLaunchAtLogin, quit: vi.fn() };
    const first = createTrayMenuTemplate(getLaunchAtLogin, actions);
    const second = createTrayMenuTemplate(getLaunchAtLogin, actions);

    expect(first[2]).toMatchObject({ checked: false });
    expect(second[2]).toMatchObject({ checked: true });
    const checkbox = second[2] as { click(menuItem: { checked: boolean }): void };
    checkbox.click({ checked: false });
    await vi.waitFor(() => expect(setLaunchAtLogin).toHaveBeenCalledWith(false));
  });

  it("restores the actual checkbox value after a failed settings update", async () => {
    const getLaunchAtLogin = vi.fn(() => true);
    const template = createTrayMenuTemplate(getLaunchAtLogin, {
      open: vi.fn(),
      refresh: vi.fn(),
      setLaunchAtLogin: vi.fn(async () => { throw new Error("settings unavailable"); }),
      quit: vi.fn(),
    });
    const checkbox = template[2] as { click(menuItem: { checked: boolean }): void };
    const menuItem = { checked: false };
    checkbox.click(menuItem);
    await vi.waitFor(() => expect(menuItem.checked).toBe(true));
  });

  it("contains synchronous settings and readback failures", async () => {
    const setLaunchAtLogin = vi.fn(() => {
      throw new Error("settings unavailable");
    });
    const getLaunchAtLogin = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockImplementation(() => {
        throw new Error("readback unavailable");
      });
    const template = createTrayMenuTemplate(getLaunchAtLogin, {
      open: vi.fn(),
      refresh: vi.fn(),
      setLaunchAtLogin,
      quit: vi.fn(),
    });
    const checkbox = template[2] as { click(menuItem: { checked: boolean }): void };
    const menuItem = { checked: true };
    checkbox.click(menuItem);

    await vi.waitFor(() => expect(setLaunchAtLogin).toHaveBeenCalledWith(true));
    expect(menuItem.checked).toBe(true);
  });

  it("prevents repeated quits until one deferred shutdown completes", async () => {
    let complete: (() => void) | undefined;
    const shutdown = vi.fn(
      () => new Promise<void>((resolve) => { complete = resolve; }),
    );
    const hide = vi.fn();
    const quit = vi.fn();
    const handler = createBeforeQuitHandler({ hide, shutdown, quit });
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };

    handler(first);
    handler(second);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    complete?.();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());

    const finalQuit = { preventDefault: vi.fn() };
    handler(finalQuit);
    expect(finalQuit.preventDefault).not.toHaveBeenCalled();
  });
});
