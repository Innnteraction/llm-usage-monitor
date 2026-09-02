import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const appPath = path.resolve(
  "out",
  "LLM Usage Monitor-win32-x64",
  "resources",
  "app.asar",
);

test("tray popover refresh, layout, hide and quit flow", async () => {
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
    await expect(page.getByText("codex.user@example.com")).toBeVisible();
    await expect(page.getByText("claude.user@example.com")).toBeVisible();
    await expect(page.getByText("Fable", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "total 1.2M" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "partial 1" })).toBeVisible();

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
      viewportWidth: 420,
      scrollWidth: 420,
      providerCards: 2,
      textMeters: 4,
      additionalSummaries: 1,
      stylesheets: 1,
      background: "rgb(16, 16, 16)",
      localUsageLines: 2,
    });
    expect(layout.viewportHeight).toBeGreaterThanOrEqual(320);
    expect(layout.viewportHeight).toBeLessThanOrEqual(360);
    expect(layout.scrollHeight).toBe(layout.viewportHeight);
    await expect(page.getByText("+2 additional limits")).toBeVisible();
    await expect(
      page.getByText(/updated \d{1,2}:\d{2} (AM|PM)/).first(),
    ).toBeVisible();
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
        getComputedStyle(document.querySelector(".local-token-trigger")!)
          .fontSize,
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
    });
    await expect(page.getByRole("button", { name: "refresh" })).toBeVisible();

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
    args: [appPath],
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

test("labels Fable as unavailable when Claude CLI omits it", async () => {
  const electronApp = await electron.launch({
    args: [appPath],
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

test("shows calculating local usage state", async () => {
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
      LLM_USAGE_MONITOR_E2E_LOCAL_USAGE_STATE: "calculating",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(
      page.getByText("this PC calculating", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("shows no local logs state", async () => {
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: test.info().outputPath("user-data"),
      LLM_USAGE_MONITOR_E2E_LOCAL_USAGE_STATE: "no_logs",
    },
  });

  try {
    const page = await electronApp.firstWindow();
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
    args: [appPath, "--force-device-scale-factor=1.5"],
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
    expect(layout.width).toBe(420);
    expect(layout.height).toBeGreaterThanOrEqual(320);
    expect(layout.height).toBeLessThanOrEqual(324);
    expect(layout.scrollWidth).toBe(layout.width);
    expect(layout.scrollHeight).toBe(layout.height);
    expect(layout.scale).toBeGreaterThanOrEqual(1.4);
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
