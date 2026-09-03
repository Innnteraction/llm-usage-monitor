import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

const appPath = process.env.LLM_USAGE_MONITOR_E2E_DEV === "1"
  ? path.resolve(".")
  : path.resolve("out", "LLM Usage Monitor-win32-x64", "resources", "app.asar");

for (const colorScheme of ["dark", "light"] as const) {
  for (const scale of [1, 1.5]) {
    test(`lays out Antigravity quotas in ${colorScheme} at ${scale}x`, async () => {
      const app = await electron.launch({
        args: [appPath, `--force-device-scale-factor=${scale}`],
        env: {
          ...process.env,
          LLM_USAGE_MONITOR_E2E: "1",
          LLM_USAGE_MONITOR_E2E_ANTIGRAVITY: "1",
          LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath(
            `agy-${colorScheme}-${scale}-user-data`,
          ),
        },
      });

      try {
        const page = await app.firstWindow();
        await page.emulateMedia({ colorScheme });
        const antigravity = page.locator(".provider-card").filter({
          has: page.getByRole("heading", { name: "Antigravity" }),
        });
        await expect(antigravity).toBeVisible();
        await expect(antigravity.locator("h3")).toHaveText([
          "Gemini 5h",
          "Gemini Weekly",
          "Claude/GPT 5h",
          "Claude/GPT Weekly",
        ]);
        await expect(antigravity.locator(".quota-meter")).toHaveCount(4);
        await expect(antigravity.locator(".local-usage")).toHaveCount(0);
        await expect(page.locator(".local-usage")).toHaveCount(2);
        await expect(
          antigravity.locator("footer").getByText("source Antigravity CLI", {
            exact: true,
          }),
        ).toBeVisible();

        const layout = await page.evaluate(() => {
          const list = document.querySelector<HTMLElement>(".provider-list")!;
          list.scrollTop = list.scrollHeight;
          const card = [...document.querySelectorAll<HTMLElement>(".provider-card")]
            .find((element) => element.querySelector("h2")?.textContent === "Antigravity")!;
          const footer = card.querySelector<HTMLElement>("footer")!;
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            nativeScrollWidth: document.documentElement.scrollWidth,
            documentFits:
              document.documentElement.scrollHeight === window.innerHeight,
            listScrolled: list.scrollTop > 0,
            footer: footer.getBoundingClientRect().toJSON(),
            resetFits: [...document.querySelectorAll<HTMLElement>(".quota-reset")]
              .every((element) => element.scrollWidth <= element.clientWidth),
          };
        });
        const nativeWidth = await app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize()[0],
        );
        if (scale === 1) {
          expect(layout.width).toBe(480);
          expect(layout.height).toBe(360);
          expect(nativeWidth).toBe(480);
        } else {
          expect(layout.width).toBeGreaterThanOrEqual(480);
          expect(layout.width).toBeLessThanOrEqual(484);
          expect(layout.height).toBeGreaterThanOrEqual(360);
          expect(layout.height).toBeLessThanOrEqual(364);
          expect(nativeWidth).toBeGreaterThanOrEqual(480);
          expect(nativeWidth).toBeLessThanOrEqual(484);
        }
        expect(layout.width).toBe(nativeWidth);
        expect(layout.nativeScrollWidth).toBe(layout.width);
        expect(layout.documentFits).toBe(true);
        expect(layout.listScrolled).toBe(true);
        expect(layout.footer.top).toBeGreaterThanOrEqual(0);
        expect(layout.footer.bottom).toBeLessThanOrEqual(layout.height);
        expect(layout.resetFits).toBe(true);

        const themeToggle = page.locator(".theme-toggle");
        const expectedThemePressed = String(colorScheme === "dark");
        await expect(themeToggle).toHaveAttribute("aria-pressed", expectedThemePressed);
        await themeToggle.click();
        await expect(themeToggle).not.toHaveAttribute(
          "aria-pressed",
          expectedThemePressed,
        );
        await themeToggle.click();
        await expect(themeToggle).toHaveAttribute("aria-pressed", expectedThemePressed);

        const help = page.getByRole("button", { name: "? Help" });
        await help.focus();
        await expect(page.getByRole("tooltip")).toContainText(
          "The theme follows your OS setting at launch.",
        );
        const tooltipLayout = await page.evaluate(() => {
          const tooltip = document.querySelector<HTMLElement>("[role=tooltip]")!;
          const footer = document.querySelector<HTMLElement>(".app-footer")!;
          return {
            tooltip: tooltip.getBoundingClientRect().toJSON(),
            footerTop: footer.getBoundingClientRect().top,
            width: window.innerWidth,
            height: window.innerHeight,
          };
        });
        expect(tooltipLayout.tooltip.left).toBeGreaterThanOrEqual(0);
        expect(tooltipLayout.tooltip.right).toBeLessThanOrEqual(tooltipLayout.width);
        expect(tooltipLayout.tooltip.top).toBeGreaterThanOrEqual(0);
        expect(tooltipLayout.tooltip.bottom).toBeLessThanOrEqual(
          tooltipLayout.footerTop - 5,
        );
        await page.screenshot({
          path: test.info().outputPath(`agy-${colorScheme}-${scale}-tooltip.png`),
        });
        await page.getByRole("button", { name: "refresh" }).focus();
        await page.locator(".app-header").hover({ position: { x: 2, y: 2 } });
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await page.screenshot({
          path: test.info().outputPath(`agy-${colorScheme}-${scale}-overview.png`),
        });

        await expect(
          antigravity.getByRole("button", { name: "20%" }).first(),
        ).toBeVisible();
        await page.getByRole("button", { name: "refresh" }).click();
        await expect(
          antigravity.getByRole("button", { name: "21%" }).first(),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "refresh" })).toBeEnabled();

        await page.getByRole("button", { name: "Tokens" }).click();
        await expect(page.locator(".local-usage")).toHaveCount(0);
        if (scale === 1) {
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(304);
        } else {
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(304);
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(308);
        }
        await page.getByRole("button", { name: "Tokens" }).click();
        await expect(page.locator(".local-usage")).toHaveCount(2);
        if (scale === 1) {
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(360);
        } else {
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(360);
          await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(364);
        }
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  }
}

test("keeps other providers fresh when the Antigravity fixture is empty or fails", async () => {
  for (const scenario of ["empty", "error"]) {
    const app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        LLM_USAGE_MONITOR_E2E: "1",
        LLM_USAGE_MONITOR_E2E_ANTIGRAVITY: scenario,
        LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath(`agy-${scenario}`),
      },
    });
    try {
      const page = await app.firstWindow();
      const antigravity = page.locator(".provider-card").filter({
        has: page.getByRole("heading", { name: "Antigravity" }),
      });
      await expect(antigravity.getByText("not provided", { exact: true })).toHaveCount(1);
      await expect(antigravity.locator(".quota-meter")).toHaveCount(0);
      await expect(
        page.locator(".provider-card").filter({
          has: page.getByRole("heading", { name: "Codex" }),
        }).locator(".status-fresh"),
      ).toHaveCount(1);
      await expect(
        page.locator(".provider-card").filter({
          has: page.getByRole("heading", { name: "Claude Code" }),
        }).locator(".status-fresh"),
      ).toHaveCount(1);
      await expect(
        antigravity.locator(
          scenario === "empty" ? ".status-fresh" : ".status-unavailable",
        ),
      ).toHaveCount(1);
      await expect(page.locator(".local-usage")).toHaveCount(2);
      await page.getByRole("button", { name: "refresh" }).click();
      await expect(page.getByTestId("codex-weekly-value")).toHaveText("64%");
      await expect(
        page.locator(".provider-card").filter({
          has: page.getByRole("heading", { name: "Codex" }),
        }).locator(".status-fresh"),
      ).toHaveCount(1);
      await expect(
        page.locator(".provider-card").filter({
          has: page.getByRole("heading", { name: "Claude Code" }),
        }).locator(".status-fresh"),
      ).toHaveCount(1);
    } finally {
      await app.close().catch(() => undefined);
    }
  }
});
