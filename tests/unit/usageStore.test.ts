import { describe, expect, it, vi } from "vitest";
import type { ProviderId, ProviderSnapshot } from "../../src/shared/index";
import { createUsageStore, type QuotaProvider } from "../../src/usage/index";

const initialSnapshot = (providerId: ProviderId): ProviderSnapshot => ({
  providerId,
  status: "unavailable",
  fetchedAt: "2026-09-01T03:00:00.000Z",
  quotaWindows: [],
});

const freshSnapshot = (providerId: ProviderId): ProviderSnapshot => ({
  providerId,
  status: "fresh",
  fetchedAt: "2026-09-01T03:01:00.000Z",
  lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
  quotaWindows: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("UsageStore refresh coordination", () => {
  it("runs providers in parallel and isolates an unexpected failure", async () => {
    const codex = deferred<ProviderSnapshot>();
    const claude = deferred<ProviderSnapshot>();
    const providers: QuotaProvider[] = [
      { id: "codex", fetchQuota: () => codex.promise },
      { id: "claude", fetchQuota: () => claude.promise },
    ];
    const store = createUsageStore({
      providers,
      initialSnapshots: [initialSnapshot("codex"), initialSnapshot("claude")],
    });

    const refresh = store.refresh();
    expect(store.getState().refreshing).toEqual(["codex", "claude"]);
    codex.reject(new Error("private provider output"));
    claude.resolve(freshSnapshot("claude"));
    await refresh;

    expect(store.getState().providers).toEqual([
      initialSnapshot("codex"),
      freshSnapshot("claude"),
    ]);
    expect(store.getState().refreshing).toEqual([]);
  });

  it("merges repeated refreshes for the same provider", async () => {
    const result = deferred<ProviderSnapshot>();
    const fetchQuota = vi.fn(() => result.promise);
    const store = createUsageStore({
      providers: [{ id: "claude", fetchQuota }],
      initialSnapshots: [initialSnapshot("claude")],
    });

    const first = store.refresh("claude");
    const second = store.refresh("claude");
    result.resolve(freshSnapshot("claude"));
    await Promise.all([first, second]);

    expect(fetchQuota).toHaveBeenCalledTimes(1);
    expect(store.getState().providers).toEqual([freshSnapshot("claude")]);
  });

  it("tracks overlapping provider refreshes independently", async () => {
    const codex = deferred<ProviderSnapshot>();
    const claude = deferred<ProviderSnapshot>();
    const store = createUsageStore({
      providers: [
        { id: "codex", fetchQuota: () => codex.promise },
        { id: "claude", fetchQuota: () => claude.promise },
      ],
      initialSnapshots: [initialSnapshot("codex"), initialSnapshot("claude")],
    });

    const codexRefresh = store.refresh("codex");
    const claudeRefresh = store.refresh("claude");
    expect(store.getState().refreshing).toEqual(["codex", "claude"]);

    codex.resolve(freshSnapshot("codex"));
    await codexRefresh;
    expect(store.getState().refreshing).toEqual(["claude"]);

    claude.resolve(freshSnapshot("claude"));
    await claudeRefresh;
    expect(store.getState().refreshing).toEqual([]);
  });
});
