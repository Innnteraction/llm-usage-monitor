import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UsageMonitorCore } from "../../../src/core/UsageMonitorCore";

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
});
