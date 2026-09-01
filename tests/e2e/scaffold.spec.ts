import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

const appPath = path.resolve(
  "out",
  "LLM Usage Monitor-win32-x64",
  "resources",
  "app.asar",
);

test("tray popover refresh, hide and quit flow", async () => {
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(
      page.getByRole("heading", { name: "LLM Usage Monitor" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Claude Code" }),
    ).toBeVisible();

    const isolation = await page.evaluate(() => ({
      methods: Object.keys(window.usageMonitor).sort(),
      processType: typeof (globalThis as { process?: unknown }).process,
      requireType: typeof (globalThis as { require?: unknown }).require,
    }));
    expect(isolation).toEqual({
      methods: [
        "getPreferences",
        "getState",
        "refresh",
        "setLaunchAtLogin",
        "subscribe",
      ],
      processType: "undefined",
      requireType: "undefined",
    });
    const fiveHour = page.getByTestId("codex-five_hour-value");
    await expect(fiveHour).toHaveText("42%");
    await page.getByRole("button", { name: "새로고침" }).click();
    await expect(fiveHour).toHaveText("43%");

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(false);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show();
    });
    await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();

    const closed = page.waitForEvent("close");
    await electronApp.evaluate(({ app }) => app.quit());
    await closed;
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
