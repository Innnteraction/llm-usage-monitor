import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

const appPath = path.resolve(
  "out",
  "LLM Usage Monitor-win32-x64",
  "resources",
  "app.asar",
);

test("standalone window refresh, layout and close flow", async () => {
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(
      page.getByRole("heading", { name: "watching quota providers" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Claude Code" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      providerCards: document.querySelectorAll(".provider-card").length,
      textMeters: document.querySelectorAll(".quota-meter").length,
      stylesheets: document.styleSheets.length,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    expect(layout).toMatchObject({
      viewportWidth: 420,
      scrollWidth: 420,
      providerCards: 2,
      textMeters: 4,
      stylesheets: 1,
      background: "rgb(16, 16, 16)",
    });
    expect(layout.viewportHeight).toBeGreaterThanOrEqual(320);
    expect(layout.viewportHeight).toBeLessThanOrEqual(360);
    expect(layout.scrollHeight).toBe(layout.viewportHeight);
    await page.screenshot({
      path: test.info().outputPath("tui-quota-overview.png"),
    });

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
    await page.getByRole("button", { name: "refresh" }).click();
    await expect(fiveHour).toHaveText("43%");

    const closed = page.waitForEvent("close");
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await closed;
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
