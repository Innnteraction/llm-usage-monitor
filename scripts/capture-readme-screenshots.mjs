// README용 화면 캡처 스크립트.
// 앱에 내장된 fake provider 모드(LLM_USAGE_MONITOR_E2E=1)로 실행하므로 실제 CLI·로그인이 필요 없고,
// 화면에 보이는 계정·수치는 모두 허구 데이터다.
//
// 사용법: pnpm screenshot:readme
// 전제:   .vite/build 와 .vite/renderer 가 있어야 한다 (pnpm package 또는 pnpm dev 1회 실행으로 생성).
/* global document, window */
import { _electron as electron } from "@playwright/test";
import console from "node:console";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(repoRoot, "docs", "images");
const scale = 2;

if (!existsSync(path.join(repoRoot, ".vite", "build", "main.js"))) {
  console.error("`.vite/build/main.js`가 없습니다. 먼저 `pnpm package`를 실행하세요.");
  process.exit(1);
}
mkdirSync(outputDir, { recursive: true });
const userData = mkdtempSync(path.join(tmpdir(), "llm-usage-monitor-readme-"));

const app = await electron.launch({
  args: [repoRoot, `--force-device-scale-factor=${scale}`],
  env: {
    ...process.env,
    LLM_USAGE_MONITOR_E2E: "1",
    LLM_USAGE_MONITOR_E2E_ANTIGRAVITY: "1",
    LLM_USAGE_MONITOR_E2E_KEEP_VISIBLE: "1",
    LLM_USAGE_MONITOR_E2E_USER_DATA: userData,
  },
});

try {
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("heading", { name: "Antigravity" }).waitFor();

  const workAreaHeight = await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0]?.getBounds();
    return bounds ? screen.getDisplayMatching(bounds).workArea.height : 0;
  });
  const waitForSize = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const fits = await page.evaluate((activeWorkAreaHeight) => {
        const root = document.documentElement;
        return (
          root.scrollWidth === window.innerWidth &&
          (root.scrollHeight === window.innerHeight ||
            window.innerHeight >= activeWorkAreaHeight - 4)
        );
      }, workAreaHeight);
      if (fits) break;
      if (Date.now() > deadline) throw new Error("창 자동 리사이즈가 끝나지 않았습니다.");
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(400);
  };

  const capture = async (name) => {
    await waitForSize();
    const file = path.join(outputDir, name);
    await page.screenshot({ path: file });
    console.log(`saved ${path.relative(repoRoot, file)}`);
  };

  const tokenToggle = page.getByRole("button", { name: "Tokens" });
  await tokenToggle.click();
  await page.getByRole("button", { name: "refresh" }).focus();
  await page.mouse.move(0, 0);
  await capture("overview-dark.png");

  await page.getByRole("button", { name: "Collapse to compact mode" }).click();
  await page.locator(".compact-table").waitFor();
  await page.mouse.move(0, 0);
  await capture("compact-dark.png");
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
