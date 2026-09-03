import { describe, expect, it } from "vitest";
import {
  AntigravityProcessError,
  AntigravityQuotaProvider,
  type AntigravityProcessRunner,
} from "../../src/providers/antigravity/index";
import type { ProviderSnapshot } from "../../src/shared/index";
import { createUsageStore } from "../../src/usage/index";

const raw = JSON.stringify({ status: "success", num_turns: 0, command: { name: "usage", data: { groups: [] } } });
class FakeRunner implements AntigravityProcessRunner {
  closed = false;
  constructor(private readonly result: string | Error | Promise<string>) {}
  async readUsage(): Promise<string> { if (this.result instanceof Error) throw this.result; return this.result; }
  async close(): Promise<void> { this.closed = true; }
}
const clock = () => new Date("2026-09-01T00:00:00.000Z");

describe("Antigravity provider integration", () => {
  it("normalizes a fake CLI response and always closes its runner", async () => {
    const runner = new FakeRunner(raw);
    const snapshot = await new AntigravityQuotaProvider({ runnerFactory: () => runner, clock }).fetchQuota();
    expect(snapshot).toMatchObject({ providerId: "antigravity", status: "fresh", lastSuccessfulAt: "2026-09-01T00:00:00.000Z", quotaWindows: [] });
    expect(runner.closed).toBe(true);
  });

  it.each(["not_installed", "not_authenticated", "rate_limited", "network", "timeout", "unsupported", "process_failed"] as const)("maps %s without retaining raw errors", async (reason) => {
    const provider = new AntigravityQuotaProvider({ runnerFactory: () => new FakeRunner(new AntigravityProcessError(reason)), clock });
    const snapshot = await provider.fetchQuota();
    expect(snapshot.error?.code).toBe(reason === "unsupported" ? "unsupported_output" : reason);
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("maps malformed output and factory exceptions to sanitized failures", async () => {
    const malformed = new AntigravityQuotaProvider({ runnerFactory: () => new FakeRunner("private malformed"), clock });
    expect((await malformed.fetchQuota()).error?.code).toBe("unsupported_output");
    const thrown = new AntigravityQuotaProvider({ runnerFactory: () => { throw new Error("private"); }, clock });
    const snapshot = await thrown.fetchQuota();
    expect(snapshot.error?.code).toBe("process_failed");
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("closes active runners and refuses later work", async () => {
    let resolve!: (value: string) => void;
    const runner = new FakeRunner(new Promise<string>((done) => { resolve = done; }));
    const provider = new AntigravityQuotaProvider({ runnerFactory: () => runner, clock });
    const pending = provider.fetchQuota();
    await Promise.resolve();
    await provider.close();
    resolve(raw);
    await pending;
    expect(runner.closed).toBe(true);
    expect((await provider.fetchQuota()).error?.code).toBe("process_failed");
  });

  it("keeps successful Antigravity quota stale while preserving another provider local usage", async () => {
    const goodProvider = new AntigravityQuotaProvider({
      runnerFactory: () => new FakeRunner(JSON.stringify({
        status: "success",
        num_turns: 0,
        command: { name: "usage", data: { groups: [{ name: "Gemini Models", buckets: [{ window: "weekly", remaining_fraction: 0.5, reset_time: "2026-09-02T00:00:00Z" }] }] } },
      })),
      clock,
    });
    const antigravityGood = await goodProvider.fetchQuota();
    const codexWithLocal: ProviderSnapshot = {
      providerId: "codex",
      status: "fresh",
      fetchedAt: clock().toISOString(),
      lastSuccessfulAt: clock().toISOString(),
      quotaWindows: [],
      localUsage: {
        scope: "local_device",
        scannedFileCount: 1,
        failedFileCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        partial: false,
        calculatedAt: clock().toISOString(),
      },
    };
    const failingProvider = new AntigravityQuotaProvider({
      runnerFactory: () => new FakeRunner(new AntigravityProcessError("timeout")),
      clock,
    });
    const codexProvider = { id: "codex" as const, fetchQuota: async (): Promise<ProviderSnapshot> => ({ providerId: "codex", status: "fresh", fetchedAt: clock().toISOString(), lastSuccessfulAt: clock().toISOString(), quotaWindows: [] }) };
    const store = createUsageStore({
      providers: [failingProvider, codexProvider],
      initialSnapshots: [antigravityGood, codexWithLocal],
      clock,
    });
    await store.refresh();
    const antigravity = store.getState().providers.find(({ providerId }) => providerId === "antigravity");
    const codex = store.getState().providers.find(({ providerId }) => providerId === "codex");
    expect(antigravity).toMatchObject({ status: "stale", lastSuccessfulAt: antigravityGood.lastSuccessfulAt, error: { code: "timeout" } });
    expect(antigravity?.quotaWindows).toEqual(antigravityGood.quotaWindows.map((window) => ({ ...window, status: "stale" })));
    expect(antigravity?.localUsage).toBeUndefined();
    expect(codex?.status).toBe("fresh");
    expect(codex?.localUsage).toEqual(codexWithLocal.localUsage);
  });
});
