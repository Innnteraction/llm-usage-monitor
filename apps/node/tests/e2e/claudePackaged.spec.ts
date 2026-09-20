import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

const executablePath = path.resolve(
  "out",
  "LLM Usage Monitor-win32-x64",
  "LLM Usage Monitor.exe",
);

test("packaged app loads native PTY and reads Claude quota", async () => {
  test.setTimeout(60_000);
  const electronApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_CLAUDE_PACKAGED_SMOKE: "1",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    const claudeCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Claude Code" }),
    });
    await expect(claudeCard.locator(".status")).toHaveText(/fresh$/, {
      timeout: 45_000,
    });
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
