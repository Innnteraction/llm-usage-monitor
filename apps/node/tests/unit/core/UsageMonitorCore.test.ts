import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UsageMonitorCore } from "../../../src/core/index";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("UsageMonitorCore (Headless Backend Engine)", () => {
  it("initializes without Electron UI and provides valid initial snapshot", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "llm-core-test-"));
    try {
      const core = await UsageMonitorCore.create({
        userDataDir: tempDir,
        useFakeProviders: true,
      });

      expect(core).toBeDefined();
      expect(core.userDataDir).toBe(tempDir);

      const state = core.getState();
      expect(state).toBeDefined();
      expect(state.schemaVersion).toBe(1);
      expect(Array.isArray(state.providers)).toBe(true);
      expect(state.providers.length).toBeGreaterThan(0);

      // Start core polling/monitoring
      await core.start();

      // Subscription test
      let updatedSnapshot: unknown;
      const unsubscribe = core.subscribe((snapshot) => {
        updatedSnapshot = snapshot;
      });

      // Manual refresh
      await core.refresh();
      expect(updatedSnapshot).toBeDefined();

      unsubscribe();

      // Graceful stop test
      await expect(core.stop()).resolves.not.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("handles Claude setup marker path checking properly", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "llm-core-test-marker-"));
    try {
      const core = await UsageMonitorCore.create({
        userDataDir: tempDir,
        useFakeProviders: true,
      });

      const readyInitially = await core.isClaudeSetupReady();
      expect(readyInitially).toBe(false);

      await core.stop();
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("pauses background polling when hidden and resumes with immediate refresh when shown", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ status: { indicator: "none", description: "Operational" } }),
          { status: 200 },
        ),
      ),
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "llm-core-pause-"));
    const prevCodexHome = process.env.CODEX_HOME;
    const prevClaudeDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = path.join(tempDir, "codex");
    process.env.CLAUDE_CONFIG_DIR = path.join(tempDir, "claude");
    let collectCount = 0;
    const fakeProvider = {
      id: "codex" as const,
      fetchQuota: vi.fn(async () => {
        collectCount += 1;
        return {
          providerId: "codex" as const,
          status: "fresh" as const,
          fetchedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
          lastSuccessfulAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
          quotaWindows: [],
        };
      }),
    };

    try {
      const core = await UsageMonitorCore.create({
        userDataDir: tempDir,
        sharedDataDir: tempDir,
        providers: [fakeProvider],
        updateIntervalMinutes: 2,
      });

      // 시작 전(숨김 상태)에는 수집하지 않음
      await vi.advanceTimersByTimeAsync(180_000);
      expect(collectCount).toBe(0);

      // 화면 표시 시 resume() -> 즉시 수집
      await core.resume();
      expect(collectCount).toBe(1);

      // 2분 후 자동 수집
      await vi.advanceTimersByTimeAsync(120_000);
      expect(collectCount).toBe(2);

      // 숨김 시 pause() -> 타이머 중단
      await core.pause();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(collectCount).toBe(2);

      // 다시 표시 시 resume() -> 즉시 업데이트
      await core.resume();
      expect(collectCount).toBe(3);

      await core.stop();
    } finally {
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
      if (prevClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevClaudeDir;
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
