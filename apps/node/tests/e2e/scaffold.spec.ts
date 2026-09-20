import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { executablePath, appArgs } from "./appPath";

test("tray popover refresh, layout, hide and quit flow", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(
      page.getByRole("heading", { name: "watching quota providers" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Claude Code" }),
    ).toBeVisible();
    await expect(page.getByText("codex.user@example.com")).toBeVisible();
    await expect(page.getByText("claude.user@example.com")).toBeVisible();
    await expect(page.getByText("Fable", { exact: true })).toBeVisible();
    const tokenToggle = page.getByRole("button", { name: "Tokens" });
    const themeToggle = page.getByRole("button", { name: "Dark theme" });
    await expect(tokenToggle).toHaveAttribute("aria-pressed", "false");
    await expect(tokenToggle).toHaveAttribute("title", "Tokens: off (Ctrl+Shift+T)");
    await expect(tokenToggle.locator("span[aria-hidden=true]")).toHaveText("🪙");
    await expect(themeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(themeToggle).toHaveAttribute("title", "Dark theme (Ctrl+Shift+L)");
    await expect(themeToggle.locator("span[aria-hidden=true]")).toHaveText("🌙");
    await expect(page.getByRole("button", { name: "? Help" })).toBeVisible();
    await expect(page.locator(".footer-shortcuts")).toHaveText(
      "Ctrl⇧T tokens · Ctrl⇧L theme",
    );

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      providerCards: document.querySelectorAll(".provider-card").length,
      textMeters: document.querySelectorAll(".quota-meter").length,
      additionalSummaries:
        document.querySelectorAll(".additional-limits").length,
      stylesheets: document.styleSheets.length,
      background: getComputedStyle(document.body).backgroundColor,
      localUsageLines: document.querySelectorAll(".local-usage").length,
    }));
    expect(layout).toMatchObject({
      viewportWidth: 480,
      scrollWidth: 480,
      providerCards: 2,
      textMeters: 4,
      additionalSummaries: 1,
      stylesheets: 1,
      background: "rgb(16, 16, 16)",
      localUsageLines: 0,
    });
    expect(layout.viewportHeight).toBe(304);
    expect(layout.scrollHeight).toBe(layout.viewportHeight);
    await expect(page.getByText("+2 additional limits")).toBeVisible();
    const reserveInSnapshot = await page.evaluate(async () => {
      const snapshot = await window.usageMonitor.getState();
      return snapshot.providers
        .find((provider) => provider.providerId === "codex")
        ?.quotaWindows.some((window) => window.label === "gpt-reserve Weekly");
    });
    expect(reserveInSnapshot).toBe(true);
    await expect(
      page.getByText(/updated \d{1,2}:\d{2} (AM|PM)/).first(),
    ).toBeVisible();
    await tokenToggle.click();
    await expect(page.locator(".local-usage")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "total 1.2M" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "partial 1" })).toBeVisible();
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getContentSize(),
        ),
      )
      .toEqual([480, 360]);
    await page.screenshot({
      path: test.info().outputPath("tui-quota-overview-normal.png"),
    });
    const total = page.getByRole("button", { name: "total 1.2M" });
    await total.hover();
    const totalTooltip = page.getByRole("tooltip");
    await expect(totalTooltip).toContainText("축약 전 합계: 1,230,000 tokens");
    await expect(totalTooltip).toContainText("total = input + output");
    const typeScale = await page.evaluate(() => ({
      root: Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      ),
      heading: Number.parseFloat(
        getComputedStyle(document.querySelector("h1")!).fontSize,
      ),
      token: Number.parseFloat(
        getComputedStyle(
          document.querySelector(".local-usage .local-token-trigger")!,
        ).fontSize,
      ),
      tooltip: Number.parseFloat(
        getComputedStyle(document.querySelector(".local-token-tooltip")!)
          .fontSize,
      ),
    }));
    expect(typeScale.root).toBeCloseTo(17.6, 1);
    expect(typeScale.heading).toBeCloseTo(14.432, 2);
    expect(typeScale.token).toBeCloseTo(9.504, 2);
    expect(typeScale.tooltip).toBeCloseTo(10.208, 2);
    await page.screenshot({
      path: test.info().outputPath("tui-quota-overview-total-tooltip.png"),
    });
    await total.focus();
    await expect(totalTooltip).toBeVisible();
    const tooltipLayout = await page.evaluate(() => {
      const box = document
        .querySelector<HTMLElement>("[role=tooltip]")
        ?.getBoundingClientRect();
      return (
        box && {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: window.innerWidth,
          height: window.innerHeight,
        }
      );
    });
    expect(tooltipLayout).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    });
    expect(tooltipLayout!.left).toBeGreaterThanOrEqual(0);
    expect(tooltipLayout!.top).toBeGreaterThanOrEqual(0);
    expect(tooltipLayout!.right).toBeLessThanOrEqual(tooltipLayout!.width);
    expect(tooltipLayout!.bottom).toBeLessThanOrEqual(tooltipLayout!.height);
    const childBounds = await page.evaluate(() => {
      const elements = [
        ...document.querySelectorAll<HTMLElement>(
          ".app-header, .provider-card, .quota, .quota-reset, .local-usage, .scope-note, [role=tooltip]",
        ),
      ];
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        resetWidths: [
          ...document.querySelectorAll<HTMLElement>(".quota-reset"),
        ].map((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
        boxes: elements.map((element) => element.getBoundingClientRect()),
      };
    });
    expect(childBounds.scrollWidth).toBe(childBounds.width);
    for (const reset of childBounds.resetWidths) {
      expect(reset.scrollWidth).toBeLessThanOrEqual(reset.clientWidth);
    }
    for (const box of childBounds.boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(childBounds.width);
      expect(box.bottom).toBeLessThanOrEqual(childBounds.height);
    }

    await tokenToggle.click();
    await expect(page.locator(".local-usage")).toHaveCount(0);
    await expect(tokenToggle).toBeEnabled();
    await expect(tokenToggle).toHaveAttribute("aria-pressed", "false");
    await expect(tokenToggle).toHaveAttribute("title", "Tokens: off (Ctrl+Shift+T)");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getContentSize(),
        ),
      )
      .toEqual([480, 304]);
    const compactWindowBounds = await electronApp.evaluate(
      ({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const bounds = window?.getBounds();
        return bounds
          ? { bounds, workArea: screen.getDisplayMatching(bounds).workArea }
          : undefined;
      },
    );
    expect(compactWindowBounds).toBeDefined();
    expect(compactWindowBounds!.bounds.x).toBeGreaterThanOrEqual(
      compactWindowBounds!.workArea.x,
    );
    expect(compactWindowBounds!.bounds.y).toBeGreaterThanOrEqual(
      compactWindowBounds!.workArea.y,
    );
    expect(compactWindowBounds!.bounds.x + compactWindowBounds!.bounds.width).toBeLessThanOrEqual(
      compactWindowBounds!.workArea.x + compactWindowBounds!.workArea.width,
    );
    expect(compactWindowBounds!.bounds.y + compactWindowBounds!.bounds.height).toBeLessThanOrEqual(
      compactWindowBounds!.workArea.y + compactWindowBounds!.workArea.height,
    );
    const compactLayout = await page.evaluate(() => ({
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      tokenTriggers: document.querySelectorAll(".local-usage .local-token-trigger").length,
    }));
    expect(compactLayout).toMatchObject({
      height: 304,
      scrollHeight: 304,
      scrollWidth: 480,
      tokenTriggers: 0,
    });
    await page.screenshot({
      path: test.info().outputPath("tui-compact-dark.png"),
    });

    await themeToggle.click();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(themeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(themeToggle).toHaveAttribute("title", "Light theme (Ctrl+Shift+L)");
    await expect(themeToggle.locator("span[aria-hidden=true]")).toHaveText("☀️");
    await page.screenshot({
      path: test.info().outputPath("tui-compact-light.png"),
    });
    await page.keyboard.press("Control+Shift+L");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 16, 16)");
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator(".local-usage")).toHaveCount(2);
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getContentSize(),
        ),
      )
      .toEqual([480, 360]);
    for (const [name, text] of [
      ["since 9/1", "가장 이른 이벤트 날짜"],
      ["cache write 20K", "정확한 cache write: 20,000 tokens"],
      ["partial 1", "확인된 부분 합계"],
    ] as const) {
      const trigger = page.getByRole("button", { name }).first();
      await trigger.hover();
      await expect(page.getByRole("tooltip")).toContainText(text);
      await page.getByRole("tooltip").hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await trigger.focus();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeVisible();
    }

    const isolation = await page.evaluate(() => ({
      methods: Object.keys(window.usageMonitor).sort(),
      processType: typeof (globalThis as { process?: unknown }).process,
      requireType: typeof (globalThis as { require?: unknown }).require,
    }));
    expect(isolation).toEqual({
      methods: [
        "getPreferences",
        "getState",
        "openClaudeSetup",
        "refresh",
        "setLaunchAtLogin",
        "setTokensVisible",
        "subscribe",
      ],
      processType: "undefined",
      requireType: "undefined",
    });
    const weekly = page.getByTestId("codex-weekly-value");
    await expect(weekly).toHaveText("63%");
    await page.getByRole("button", { name: "refresh" }).click();
    await expect(weekly).toHaveText("64%");

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
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await expect(page.getByRole("button", { name: "refresh" })).toBeVisible();
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isFocused(),
        ),
      )
      .toBe(true);
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await total.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Escape",
      });
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
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await expect(page.getByRole("button", { name: "refresh" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const closed = page.waitForEvent("close");
    await electronApp.evaluate(({ app }) => app.quit());
    await closed;
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("starts hidden after Claude setup has succeeded once", async ({
  browserName,
}, testInfo) => {
  const userData = testInfo.outputPath(`${browserName}-ready-user-data`);
  await mkdir(userData, { recursive: true });
  await writeFile(
    path.join(userData, "claude-setup-ready-v1"),
    "ready\n",
    "utf8",
  );
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_KEEP_VISIBLE: "0",
      LLM_USAGE_MONITOR_E2E_USER_DATA: userData,
    },
  });

  try {
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(false);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("keeps display choices through refresh and popover visibility changes", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("display-toggle-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
    const additional = page.getByRole("button", { name: "+2 additional limits" });
    await additional.click();
    await expect(additional).toHaveAttribute("aria-expanded", "true");

    await expect(page.locator(".local-usage")).toHaveCount(0);
    await page.getByRole("button", { name: "refresh" }).click();
    await expect(page.locator(".local-usage")).toHaveCount(0);
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.hide();
    });
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show();
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await expect(page.getByRole("button", { name: "refresh" })).toBeVisible();
    await expect(page.locator(".local-usage")).toHaveCount(0);
    await expect(additional).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

    await page.evaluate(() => {
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();
      for (const options of [
        { repeat: true },
        { isComposing: true },
        {},
      ]) {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            code: "KeyT",
            ctrlKey: true,
            shiftKey: true,
            ...options,
          }),
        );
      }
      input.remove();
    });
    await expect(page.locator(".local-usage")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator(".local-usage")).toHaveCount(2);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("labels Fable as unavailable when Claude CLI omits it", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
      LLM_USAGE_MONITOR_E2E_CLAUDE_NO_FABLE: "1",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByText("not provided by Claude CLI")).toBeVisible();
    await expect(page.getByText("Fable", { exact: true })).toBeVisible();
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("explains stale, unavailable, missing cache and pending reset states", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_PHASE6_ERRORS: "1",
      LLM_USAGE_MONITOR_E2E_PHASE6_MISSING_CACHE: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("phase6-status-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.locator(".provider-card").first().locator(".status")).toHaveText(
      /stale/,
    );
    await expect(page.getByText("네트워크 연결을 확인합니다.")).toBeVisible();
    await expect(page.getByText(/마지막 성공 \d{1,2}:\d{2} (AM|PM)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "reset pending" })).toBeVisible();
    await page.getByRole("button", { name: "Tokens" }).click();
    await page.getByRole("button", { name: "reset pending" }).hover();
    await expect(page.getByRole("tooltip")).toContainText("reset 확인 대기");
    await page.getByRole("button", { name: "cache read --" }).first().hover();
    await expect(page.getByRole("tooltip")).toContainText("cache read 값이 제공되지 않았습니다");

    const claudeCard = page.locator(".provider-card").filter({ hasText: "Claude Code" });
    await expect(claudeCard.locator(".status")).toHaveText(/unavailable/);
    await expect(claudeCard.getByText("CLI가 설치되지 않았습니다.")).toBeVisible();
    await expect(claudeCard.locator(".quota-meter")).toHaveCount(0);
    await expect(claudeCard.getByText("not provided", { exact: true })).toHaveCount(2);
    await expect(claudeCard.getByText(/remaining/)).toHaveCount(0);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("updates the countdown on its 30 second timer without refreshing provider values", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_PHASE6_CLOCK: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("phase6-clock-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.clock.install({ time: Date.now() });
    await page.reload();
    const weekly = page.getByTestId("codex-weekly-value");
    await expect(weekly).toHaveText("63%");
    const codexWeeklyReset = page
      .locator(".provider-card")
      .filter({ hasText: "Codex" })
      .locator(".quota")
      .filter({ hasText: "7d" })
      .getByRole("button", { name: /resets/ });
    await expect(codexWeeklyReset).toHaveText("1m");
    const updated = await page.locator(".provider-card").first().locator("footer").getByText(/updated/).textContent();
    await page.clock.runFor(30_000);
    await expect(codexWeeklyReset).toHaveText("0m");
    await expect(weekly).toHaveText("63%");
    await expect(page.locator(".provider-card").first().locator("footer").getByText(/updated/)).toHaveText(updated!);
    await expect(page.getByRole("button", { name: "refresh" })).toBeEnabled();
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("updates the countdown on window focus without refreshing provider values", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("phase6-focus-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    const weekly = page.getByTestId("codex-weekly-value");
    await expect(weekly).toHaveText("63%");
    await page.evaluate(() => {
      const clock = Date.now();
      Date.now = () => clock + 8 * 24 * 60 * 60 * 1000;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page.locator(".provider-card").first().getByRole("button", {
        name: "reset pending",
      }),
    ).toBeVisible();
    await expect(weekly).toHaveText("63%");
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("uses accessible dark and light TUI colors at 100 and 150 percent", async () => {
  for (const colorScheme of ["dark", "light"] as const) {
    for (const scale of [1, 1.5]) {
      const electronApp = await electron.launch({
        chromiumSandbox: true,
        executablePath,
        args: appArgs([`--force-device-scale-factor=${scale}`]),
        env: {
          ...process.env,
          LLM_USAGE_MONITOR_E2E: "1",
          LLM_USAGE_MONITOR_E2E_PHASE6_LONG_CONTENT: "1",
          LLM_USAGE_MONITOR_E2E_PHASE6_ERRORS: "1",
          LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath(
            `phase6-${colorScheme}-${scale}-user-data`,
          ),
        },
      });

      try {
        const page = await electronApp.firstWindow();
        await page.emulateMedia({ colorScheme });
        const toggle = page.getByRole("button", { name: "+2 additional limits" });
        await toggle.focus();
        await page.keyboard.press("Enter");
        await page.screenshot({
          path: test.info().outputPath(
            `tui-${colorScheme}-${scale}-expanded-error.png`,
          ),
        });
        const account = page.getByRole("button", {
          name: "codex.account.with.a.deliberately.long.label@example.com",
        });
        await account.focus();
        await expect(page.getByRole("tooltip")).toBeVisible();
        const upperPlacement = await page.evaluate(() => {
          const anchor = document.querySelector<HTMLElement>(".account-label button")!;
          const tooltip = document.querySelector<HTMLElement>("[role=tooltip]")!;
          return {
            anchorBottom: anchor.getBoundingClientRect().bottom,
            tooltipTop: tooltip.getBoundingClientRect().top,
          };
        });
        expect(upperPlacement.tooltipTop).toBeGreaterThanOrEqual(
          upperPlacement.anchorBottom + 5,
        );

        const help = page.getByRole("button", { name: "? Help" });
        await help.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tooltip")).toContainText(
          "The theme follows your OS setting at launch.",
        );
        await expect(page.getByRole("tooltip")).toContainText("Tab/Shift+Tab");
        await expect(page.getByRole("tooltip")).toContainText("Enter or Space");
        await page.screenshot({
          path: test.info().outputPath(`tui-${colorScheme}-${scale}-footer-help.png`),
        });
        await page.getByRole("button", { name: "refresh" }).focus();
        await page.locator(".app-header").hover({ position: { x: 2, y: 2 } });
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await help.focus();
        await page.keyboard.press("Space");
        await expect(page.getByRole("tooltip")).toContainText("Escape to hide the popover");

        await page.getByRole("button", { name: "Tokens" }).click();
        await expect(page.locator(".local-usage")).toHaveCount(2);
        const claudeTotal = page.getByTestId("claude-local-total");
        await claudeTotal.scrollIntoViewIfNeeded();
        await claudeTotal.focus();
        await expect(page.getByRole("tooltip")).toBeVisible();
        const lowerPlacement = await page.evaluate(() => {
          const tooltip = document.querySelector<HTMLElement>("[role=tooltip]")!;
          const footer = document.querySelector<HTMLElement>(".app-footer")!;
          const anchor = document.querySelector<HTMLElement>(
            '[data-testid="claude-local-total"]',
          )!;
          return {
            anchorTop: anchor.getBoundingClientRect().top,
            tooltipBottom: tooltip.getBoundingClientRect().bottom,
            footerTop: footer.getBoundingClientRect().top,
          };
        });
        expect(lowerPlacement.tooltipBottom).toBeLessThanOrEqual(
          lowerPlacement.anchorTop - 5,
        );
        expect(lowerPlacement.tooltipBottom).toBeLessThanOrEqual(
          lowerPlacement.footerTop - 5,
        );
        await page.screenshot({
          path: test.info().outputPath(`tui-${colorScheme}-${scale}-claude-tooltip.png`),
        });
        await page.locator(".app-header").hover({ position: { x: 2, y: 2 } });
        const scrollbars = await page.evaluate(() => {
          const list = document.querySelector<HTMLElement>(".provider-list")!;
          const tooltip = document.querySelector<HTMLElement>("[role=tooltip]")!;
          const color = (property: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${property})`;
            document.body.append(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          };
          list.scrollTop = list.scrollHeight;
          return {
            listScrollable: list.scrollHeight > list.clientHeight,
            listScrolled: list.scrollTop > 0,
            listScrollbarGutter: getComputedStyle(list).scrollbarGutter,
            listScrollbarWidth: getComputedStyle(
              list,
              "::-webkit-scrollbar",
            ).width,
            listThumbColor: getComputedStyle(
              list,
              "::-webkit-scrollbar-thumb",
            ).backgroundColor,
            listTrackColor: getComputedStyle(
              list,
              "::-webkit-scrollbar-track",
            ).backgroundColor,
            tooltipScrollbarWidth: getComputedStyle(
              tooltip,
              "::-webkit-scrollbar",
            ).width,
            tooltipThumbColor: getComputedStyle(
              tooltip,
              "::-webkit-scrollbar-thumb",
            ).backgroundColor,
            tooltipTrackColor: getComputedStyle(
              tooltip,
              "::-webkit-scrollbar-track",
            ).backgroundColor,
            muted: color("--muted"),
            surface: color("--surface"),
            tooltipSurface: color("--tooltip-surface"),
          };
        });
        expect(scrollbars.listScrollbarGutter).toBe("stable");
        expect(scrollbars.listScrollbarWidth).toBe("8px");
        expect(scrollbars.listThumbColor).toBe(scrollbars.muted);
        expect(scrollbars.listTrackColor).toBe(scrollbars.surface);
        expect(scrollbars.tooltipScrollbarWidth).toBe("8px");
        expect(scrollbars.tooltipThumbColor).toBe(scrollbars.muted);
        expect(scrollbars.tooltipTrackColor).toBe(scrollbars.tooltipSurface);
        await page.getByRole("button", { name: "refresh" }).focus();
        await page.locator(".app-header").hover({ position: { x: 2, y: 2 } });
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await account.focus();
        await expect(page.getByRole("tooltip")).toBeVisible();

        const contrast = await page.evaluate(() => {
          const ratio = (foreground: string, background: string): number => {
            const channels = (color: string) =>
              color.match(/\d+/g)!.slice(0, 3).map(Number).map((value) => {
                const normalized = value / 255;
                return normalized <= 0.04045
                  ? normalized / 12.92
                  : ((normalized + 0.055) / 1.055) ** 2.4;
              });
            const luminance = (color: string) => {
              const [red = 0, green = 0, blue = 0] = channels(color);
              return red * 0.2126 + green * 0.7152 + blue * 0.0722;
            };
            const first = luminance(foreground);
            const second = luminance(background);
            return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
          };
          const bodyColor = getComputedStyle(document.body).backgroundColor;
          const textSelectors = [
            "h1",
            "h2",
            ".account-label",
            ".account-client",
            ".provider-index",
            ".status",
            ".quota-label",
            ".local-usage",
            ".scope-note",
            ".provider-error",
            ".quota-not-provided-text",
            ".quota-value",
          ];
          const textRatios = textSelectors.flatMap((selector) =>
            [...document.querySelectorAll<HTMLElement>(selector)].map((element) =>
              ratio(getComputedStyle(element).color, bodyColor),
            ),
          );
          const account = document.querySelector<HTMLElement>(".account-label")!;
          const accountStyle = getComputedStyle(account);
          const tooltip = document.querySelector<HTMLElement>(".local-token-tooltip")!;
          return {
            textRatios,
            focusRatio: ratio(accountStyle.outlineColor, bodyColor),
            focusStyle: accountStyle.outlineStyle,
            width: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            resetFits: [...document.querySelectorAll<HTMLElement>(".quota-reset")].every(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
            tooltipRatio: ratio(
              getComputedStyle(tooltip).color,
              getComputedStyle(tooltip).backgroundColor,
            ),
            tooltipFits: tooltip.scrollWidth <= tooltip.clientWidth,
            statusRatios: ["--low", "--medium", "--high"].map((name) => {
              const probe = document.createElement("span");
              probe.style.color = `var(${name})`;
              document.body.append(probe);
              const color = getComputedStyle(probe).color;
              probe.remove();
              return ratio(color, bodyColor);
            }),
          };
        });
        expect(contrast.textRatios.every((value) => value >= 4.5)).toBe(true);
        expect(contrast.focusRatio).toBeGreaterThanOrEqual(3);
        expect(contrast.focusStyle).toBe("dotted");
        expect(contrast.tooltipRatio).toBeGreaterThanOrEqual(4.5);
        expect(contrast.tooltipFits).toBe(true);
        expect(contrast.statusRatios.every((value) => value >= 3)).toBe(true);
        expect(contrast.width).toBe(contrast.viewport);
        expect(contrast.resetFits).toBe(true);
      } finally {
        await electronApp.close().catch(() => undefined);
      }
    }
  }
});

test("captures normal dark and light quota overviews at 100 and 150 percent", async () => {
  for (const colorScheme of ["dark", "light"] as const) {
    for (const scale of [1, 1.5]) {
      const electronApp = await electron.launch({
        chromiumSandbox: true,
        executablePath,
        args: appArgs([`--force-device-scale-factor=${scale}`]),
        env: {
          ...process.env,
          LLM_USAGE_MONITOR_E2E: "1",
          LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath(
            `phase6-${colorScheme}-${scale}-normal-user-data`,
          ),
        },
      });

      try {
        const page = await electronApp.firstWindow();
        await page.emulateMedia({ colorScheme });
        await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
        if (scale === 1) {
          await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(480);
        }
        const nativeWidth = await electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize()[0],
        );
        await page.getByRole("button", { name: "Tokens" }).click();
        await expect(page.locator(".local-usage")).toHaveCount(2);
        const layout = await page.evaluate(() => {
          const list = document.querySelector<HTMLElement>(".provider-list")!;
          const listBounds = list.getBoundingClientRect();
          const scope = document.querySelector<HTMLElement>(".scope-note")!;
          const controls = document.querySelector<HTMLElement>(".footer-controls")!;
          const shortcuts = document.querySelector<HTMLElement>(".footer-shortcuts")!;
          const scopeItems = scope.querySelectorAll<HTMLElement>("span");
          const scopeBounds = scope.getBoundingClientRect();
          const controlsBounds = controls.getBoundingClientRect();
          const shortcutsBounds = shortcuts.getBoundingClientRect();
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            documentFits:
              document.documentElement.scrollHeight === window.innerHeight &&
              document.documentElement.scrollWidth === window.innerWidth,
            listFits:
              list.scrollHeight <= list.clientHeight &&
              list.scrollWidth <= list.clientWidth,
            footerFits: [...document.querySelectorAll<HTMLElement>(
              ".provider-card footer",
            )].every((footer) => {
              const bounds = footer.getBoundingClientRect();
              return bounds.top >= listBounds.top && bounds.bottom <= listBounds.bottom;
            }),
            footerAlignment:
              Math.abs(scopeItems[0]!.getBoundingClientRect().left - scopeBounds.left) <= 1 &&
              Math.abs(scopeItems[1]!.getBoundingClientRect().right - scopeBounds.right) <= 1 &&
              Math.abs(controlsBounds.left - scopeBounds.left) <= 1 &&
              Math.abs(shortcutsBounds.right - scopeBounds.right) <= 1 &&
              Math.abs(
                controlsBounds.top + controlsBounds.height / 2 -
                  (shortcutsBounds.top + shortcutsBounds.height / 2),
              ) <= 1,
          };
        });
        if (scale === 1) {
          expect(layout.height).toBe(360);
          expect(nativeWidth).toBe(480);
        } else {
          expect(layout.height).toBeGreaterThanOrEqual(360);
          expect(layout.height).toBeLessThanOrEqual(364);
          expect(nativeWidth).toBeGreaterThanOrEqual(480);
          expect(nativeWidth).toBeLessThanOrEqual(484);
        }
        expect(layout.width).toBe(nativeWidth);
        expect(layout.documentFits).toBe(true);
        expect(layout.listFits).toBe(true);
        expect(layout.footerFits).toBe(true);
        expect(layout.footerAlignment).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`tui-${colorScheme}-${scale}-normal.png`),
        });
        await page.getByRole("button", { name: "Tokens" }).click();
        await expect(page.locator(".local-usage")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Tokens" }),
        ).toHaveAttribute("aria-pressed", "false");
        await expect(
          page.getByRole("button", { name: "Tokens" }),
        ).toBeEnabled();
        const compact = await page.evaluate(() => {
          const list = document.querySelector<HTMLElement>(".provider-list")!;
          const listBounds = list.getBoundingClientRect();
          return {
            height: window.innerHeight,
            listClientHeight: list.clientHeight,
            listScrollHeight: list.scrollHeight,
            localUsageCount: document.querySelectorAll(".local-usage").length,
            footerBounds: [...document.querySelectorAll<HTMLElement>(
              ".provider-card footer",
            )].map((footer) => footer.getBoundingClientRect().toJSON()),
            listFits:
              list.scrollHeight <= list.clientHeight &&
              list.scrollWidth <= list.clientWidth,
            footerFits: [...document.querySelectorAll<HTMLElement>(
              ".provider-card footer",
            )].every((footer) => {
              const bounds = footer.getBoundingClientRect();
              return bounds.top >= listBounds.top && bounds.bottom <= listBounds.bottom;
            }),
            controlFits: [...document.querySelectorAll<HTMLElement>(
              ".footer-help > *",
            )].every((control) => {
              const bounds = control.getBoundingClientRect();
              return bounds.left >= 0 && bounds.right <= window.innerWidth;
            }),
          };
        });
        if (scale === 1) {
          expect(compact.height).toBe(304);
        } else {
          expect(compact.height).toBeGreaterThanOrEqual(304);
          expect(compact.height).toBeLessThanOrEqual(308);
        }
        expect(compact.listFits, JSON.stringify({ colorScheme, scale, compact })).toBe(true);
        expect(compact.footerFits).toBe(true);
        expect(compact.controlFits).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`tui-${colorScheme}-${scale}-compact.png`),
        });
        const help = page.getByRole("button", { name: "? Help" });
        await help.focus();
        await expect(page.getByRole("tooltip")).toContainText(
          "The theme follows your OS setting at launch.",
        );
        await page.screenshot({
          path: test.info().outputPath(
            `tui-${colorScheme}-${scale}-normal-help.png`,
          ),
        });
      } finally {
        await electronApp.close().catch(() => undefined);
      }
    }
  }
});

test("expands additional limits with the keyboard and auto-sizes the popover", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_PHASE6_LONG_CONTENT: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("phase6-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    const toggle = page.getByRole("button", { name: "+2 additional limits" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const collapsedHeight = await page.evaluate(() => window.innerHeight);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(collapsedHeight);
    await expect(
      page.getByRole("heading", {
        name: "Example Codex model with a deliberately long primary label",
      }),
    ).toBeVisible();
    await expect(page.getByText("gpt-reserve Weekly", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const account = page.getByRole("button", {
      name: "codex.account.with.a.deliberately.long.label@example.com",
    });
    await account.focus();
    await expect(page.getByRole("tooltip")).toContainText(
      "codex.account.with.a.deliberately.long.label@example.com",
    );

    await page.getByRole("button", { name: "refresh" }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const layout = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".provider-list")!;
      const header = document.querySelector<HTMLElement>(".app-header")!;
      const footer = document.querySelector<HTMLElement>(".scope-note")!;
      const lastProviderFooter = document.querySelectorAll<HTMLElement>(
        ".provider-card footer",
      )[1]!;
      const before = {
        header: header.getBoundingClientRect().top,
        footer: footer.getBoundingClientRect().bottom,
      };
      return {
        listScrollable: list.scrollHeight > list.clientHeight,
        listAtBottom: list.scrollTop > 0,
        listScrollWidth: list.scrollWidth,
        listClientWidth: list.clientWidth,
        resetOverflow: [...document.querySelectorAll<HTMLElement>(
          ".quota-reset",
        )].every((reset) => reset.scrollWidth <= reset.clientWidth),
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        listScrollTop: list.scrollTop,
        lastProviderFooterBottom:
          lastProviderFooter.getBoundingClientRect().bottom,
        listBottom: list.getBoundingClientRect().bottom,
        headerStable: header.getBoundingClientRect().top === before.header,
        footerStable: footer.getBoundingClientRect().bottom === before.footer,
        freshEdgeGap:
          list.getBoundingClientRect().left + list.clientWidth -
          Math.max(
            ...[...document.querySelectorAll<HTMLElement>(
              ".status, .quota-reset",
            )].map((element) => element.getBoundingClientRect().right),
          ),
      };
    });
    expect(layout).toEqual({
      listScrollable: false,
      listAtBottom: false,
      listScrollWidth: expect.any(Number),
      listClientWidth: expect.any(Number),
      resetOverflow: true,
      listClientHeight: expect.any(Number),
      listScrollHeight: expect.any(Number),
      listScrollTop: expect.any(Number),
      lastProviderFooterBottom: expect.any(Number),
      listBottom: expect.any(Number),
      headerStable: true,
      footerStable: true,
      freshEdgeGap: expect.any(Number),
    });
    expect(layout.listScrollWidth).toBeLessThanOrEqual(layout.listClientWidth);
    expect(layout.lastProviderFooterBottom).toBeLessThanOrEqual(
      layout.listBottom + 1,
    );
    expect(layout.freshEdgeGap).toBeGreaterThanOrEqual(7);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("starts with additional limits collapsed after a fresh launch", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_PHASE6_LONG_CONTENT: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("phase6-relaunch-user-data"),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(
      page.getByRole("button", { name: "+2 additional limits" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Tokens" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      page.getByRole("heading", {
        name: "Example Codex model with a deliberately long primary label",
      }),
    ).toHaveCount(0);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("shows calculating local usage state", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
      LLM_USAGE_MONITOR_E2E_LOCAL_USAGE_STATE: "calculating",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.getByRole("button", { name: "Tokens" }).click();
    await expect(
      page.getByText("this PC calculating", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("shows no local logs state", async () => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
      LLM_USAGE_MONITOR_E2E_LOCAL_USAGE_STATE: "no_logs",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.getByRole("button", { name: "Tokens" }).click();
    await expect(
      page.getByText("this PC no local logs", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("keeps the TUI inside the popover at 150 percent scale", async ({
  browserName,
}, testInfo) => {
  const electronApp = await electron.launch({
    chromiumSandbox: true,
    executablePath,
    args: appArgs(["--force-device-scale-factor=1.5"]),
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: testInfo.outputPath(
        `${browserName}-scaled-user-data`,
      ),
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(
      page.getByRole("heading", { name: "watching quota providers" }),
    ).toBeVisible();
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scale: window.devicePixelRatio,
    }));
    const nativeWidth = await electronApp.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize()[0],
    );
    expect(layout.width).toBeGreaterThanOrEqual(480);
    expect(layout.width).toBeLessThanOrEqual(484);
    expect(layout.width).toBe(nativeWidth);
    expect(layout.height).toBeGreaterThanOrEqual(304);
    expect(layout.height).toBeLessThanOrEqual(308);
    expect(layout.scrollWidth).toBe(layout.width);
    expect(layout.scrollHeight).toBe(layout.height);
    expect(layout.scale).toBeGreaterThanOrEqual(1.4);
    await page.getByRole("button", { name: "Tokens" }).click();
    await expect(page.locator(".local-usage")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(360);
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(364);
    const input = page.getByRole("button", { name: "input 900K" });
    await input.focus();
    await expect(page.getByRole("tooltip")).toContainText(
      "정확한 input: 900,000 tokens",
    );
    const localLayout = await page.evaluate(() => {
      const boxes = [
        ...document.querySelectorAll<HTMLElement>(
          ".app-header, .provider-card, .quota, .quota-reset, .local-usage, .scope-note, [role=tooltip]",
        ),
      ].map((element) => element.getBoundingClientRect());
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        resetWidths: [
          ...document.querySelectorAll<HTMLElement>(".quota-reset"),
        ].map((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
        boxes,
      };
    });
    expect(localLayout.scrollWidth).toBe(localLayout.width);
    for (const reset of localLayout.resetWidths) {
      expect(reset.scrollWidth).toBeLessThanOrEqual(reset.clientWidth);
    }
    for (const box of localLayout.boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(localLayout.width);
      expect(box.bottom).toBeLessThanOrEqual(localLayout.height);
    }
    await page.screenshot({
      path: testInfo.outputPath("tui-quota-overview-150-tooltip.png"),
    });
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
