// Electron fake-provider 화면과 Rust가 읽을 공통 snapshot을 함께 저장한다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".work", "parity-reference");
mkdirSync(output, { recursive: true });
if (process.argv.includes("--snapshot-only")) {
  process.env.LLM_USAGE_MONITOR_E2E_ANTIGRAVITY = "1";
  const { createFakeUsageStore } = await import("../src/main/fakeUsage.ts");
  const snapshot = createFakeUsageStore(() => new Date("2026-09-19T12:00:00.000Z")).getState();
  writeFileSync(path.join(output, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
} else {
const { _electron: electron } = await import("@playwright/test");
const userData = mkdtempSync(path.join(tmpdir(), "llm-parity-reference-"));
const app = await electron.launch({
  args: [root], chromiumSandbox: true,
  env: { ...process.env, LLM_USAGE_MONITOR_E2E: "1",
    LLM_USAGE_MONITOR_E2E_ANTIGRAVITY: "1",
    LLM_USAGE_MONITOR_E2E_KEEP_VISIBLE: "1", LLM_USAGE_MONITOR_E2E_USER_DATA: userData },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.screenshot({ path: path.join(output, "startup.png") });
  await page.getByRole("heading", { name: "Antigravity", exact: true }).waitFor();
  const snapshot = await page.evaluate(() => window.usageMonitor.getState());
  await page.clock.install({ fixedTime: new Date(snapshot.updatedAt) });
  writeFileSync(path.join(output, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
  const metrics = {};
  for (const compact of [false, true]) {
    if (compact) await page.getByRole("button", { name: "Collapse to compact mode", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(700);
      const name = `${compact ? "compact" : "detail"}-${theme}`;
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      metrics[name] = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, scale: devicePixelRatio,
        font: getComputedStyle(document.body).fontFamily,
        elements: [...document.querySelectorAll(".app-header,.provider-card,.quota,.compact-row,.app-footer")].map(el => {
          const r = el.getBoundingClientRect();
          return { className: el.className, x:r.x, y:r.y, width:r.width, height:r.height };
        }),
      }));
    }
  }
  writeFileSync(path.join(output, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
} finally { await app.close(); }

}
