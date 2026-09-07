import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { executablePath } from "./appPath";

// 같은 package를 개발용 Electron / packaged EXE로 비교한다. hmr은 Forge 기동 후 실행한다.
const mode = process.env.LLM_USAGE_MONITOR_RUNTIME_MODE ?? "packaged";
const sandbox = process.env.LLM_USAGE_MONITOR_GPU_SANDBOX ?? "1";
const launch = (profile: string, dev = true) => electron.launch({
  chromiumSandbox: true,
  executablePath: process.env.LLM_USAGE_MONITOR_RUNTIME_EXECUTABLE ??
    (mode === "packaged" ? executablePath : undefined),
  args: mode === "packaged" ? [] : [mode === "hmr" ? path.resolve(".") : path.resolve(
    "out", `LLM Usage Monitor-${process.platform}-${process.arch}`,
    ...(process.platform === "darwin" ? ["LLM Usage Monitor.app", "Contents", "Resources"] : ["resources"]),
    "app.asar",
  )],
  env: {
    ...process.env,
    LLM_USAGE_MONITOR_DEV: dev ? "1" : "0",
    LLM_USAGE_MONITOR_E2E: "1",
    LLM_USAGE_MONITOR_E2E_USER_DATA: profile,
    LLM_USAGE_MONITOR_GPU_SANDBOX: sandbox,
  },
});

for (let iteration = 1; iteration <= 5; iteration++) {
  test(`runtime ${mode} sandbox=${sandbox} startup ${iteration}`, async () => {
    const profile = test.info().outputPath("fresh profile");
    const app = await launch(profile);
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole("heading", { name: "LLM Usage Monitor", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
      const state = await app.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const renderer = app.getAppMetrics().find(({ pid }) => pid === window.webContents.getOSProcessId());
        return {
          packaged: app.isPackaged,
          userData: app.getPath("userData"), sessionData: app.getPath("sessionData"),
          sandbox: renderer?.sandboxed,
          gpuBypass: app.commandLine.hasSwitch("disable-gpu-sandbox"),
        };
      });
      expect(state).toMatchObject({
        packaged: mode === "packaged", userData: profile, sessionData: profile,
        sandbox: true,
        gpuBypass: process.platform === "win32" && sandbox !== "1",
      });
      expect(await page.evaluate(() => ({
        node: "require" in window, process: "process" in window,
        bridge: typeof window.usageMonitor.getState,
      }))).toEqual({ node: false, process: false, bridge: "function" });
      if (mode === "hmr") expect(page.url()).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):17321\//);
      else expect(page.url()).toMatch(/^file:/);
      const hmrConnected = mode === "hmr" ? page.waitForEvent("websocket").then(async (socket) => {
        expect(socket.url()).toMatch(/^ws:\/\/127\.0\.0\.1:17321\//);
        await socket.waitForEvent("framereceived", {
          predicate: ({ payload }) => JSON.parse(String(payload)).type === "connected",
        });
      }) : undefined;
      await page.reload();
      await hmrConnected;
      await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
      expect((await page.evaluate(() => window.usageMonitor.getState())).providers.length).toBeGreaterThan(0);
      if (iteration === 1) {
        await page.getByRole("button", { name: "refresh", exact: true }).click();
        await expect(page.getByRole("status")).toHaveText("Quota refreshed.");
        await page.getByRole("button", { name: "Tokens", exact: true }).click();
        await expect(page.locator(".local-usage")).toHaveCount(2);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
        await app.evaluate(({ app }) => app.emit("activate"));
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
      }
      if (iteration === 1) await page.screenshot({ path: test.info().outputPath("startup.png") });
    } finally { await app.close(); }
  });
}

test("separate profiles coexist without sharing preferences or Chromium storage", async () => {
  const first = await launch(test.info().outputPath("installed profile"), false);
  let second: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const firstPage = await first.firstWindow();
    await expect(firstPage.getByRole("heading", { name: "Codex" })).toBeVisible();
    await firstPage.evaluate(() => localStorage.setItem("isolation-sentinel", "first"));
    second = await launch(test.info().outputPath("development profile"));
    const secondPage = await second.firstWindow();
    await expect(secondPage.getByRole("heading", { name: "Codex" })).toBeVisible();
    expect(await secondPage.evaluate(() => localStorage.getItem("isolation-sentinel"))).toBeNull();
    expect(await first.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(true);
    expect(await second.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(true);
  } finally {
    await second?.close();
    await first.close();
  }
});
