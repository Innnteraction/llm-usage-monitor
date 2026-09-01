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
      clock: () => new Date("2026-09-01T03:02:00.000Z"),
    });

    const refresh = store.refresh();
    expect(store.getState().refreshing).toEqual(["codex", "claude"]);
    codex.reject(new Error("private provider output"));
    claude.resolve(freshSnapshot("claude"));
    await refresh;

    expect(store.getState().providers).toEqual([
      {
        ...initialSnapshot("codex"),
        fetchedAt: "2026-09-01T03:02:00.000Z",
        error: {
          code: "unexpected",
          message: "Usage refresh failed unexpectedly.",
        },
      },
      freshSnapshot("claude"),
    ]);
    expect(store.getState().refreshing).toEqual([]);
  });

  it("queues one follow-up for repeated refreshes of the same provider", async () => {
    const firstResult = deferred<ProviderSnapshot>();
    const secondResult = deferred<ProviderSnapshot>();
    const fetchQuota = vi
      .fn<() => Promise<ProviderSnapshot>>()
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);
    const store = createUsageStore({
      providers: [{ id: "claude", fetchQuota }],
      initialSnapshots: [initialSnapshot("claude")],
    });

    const first = store.refresh("claude");
    const second = store.refresh("claude");
    const third = store.refresh("claude");
    firstResult.resolve(freshSnapshot("claude"));
    await vi.waitFor(() => expect(fetchQuota).toHaveBeenCalledTimes(2));
    secondResult.resolve(freshSnapshot("claude"));
    await Promise.all([first, second, third]);

    expect(fetchQuota).toHaveBeenCalledTimes(2);
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

  it("retains the last successful value as stale after a provider failure", async () => {
    const failure: ProviderSnapshot = {
      providerId: "codex",
      status: "unavailable",
      fetchedAt: "2026-09-01T03:02:00.000Z",
      quotaWindows: [],
      error: { code: "timeout", message: "Codex refresh timed out." },
    };
    const fetchQuota = vi
      .fn<() => Promise<ProviderSnapshot>>()
      .mockResolvedValueOnce(freshSnapshot("codex"))
      .mockResolvedValueOnce(failure);
    const store = createUsageStore({
      providers: [{ id: "codex", fetchQuota }],
      initialSnapshots: [initialSnapshot("codex")],
    });

    await store.refresh("codex");
    await store.refresh("codex");

    expect(store.getState().providers[0]).toMatchObject({
      providerId: "codex",
      status: "stale",
      fetchedAt: failure.fetchedAt,
      lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
      error: { code: "timeout" },
    });
  });

  it("marks the last successful value stale after an unexpected throw", async () => {
    const fetchQuota = vi
      .fn<() => Promise<ProviderSnapshot>>()
      .mockResolvedValueOnce(freshSnapshot("claude"))
      .mockRejectedValueOnce(new Error("private provider output"));
    const store = createUsageStore({
      providers: [{ id: "claude", fetchQuota }],
      initialSnapshots: [initialSnapshot("claude")],
      clock: () => new Date("2026-09-01T03:03:00.000Z"),
    });

    await store.refresh("claude");
    await store.refresh("claude");

    expect(store.getState().providers[0]).toMatchObject({
      status: "stale",
      fetchedAt: "2026-09-01T03:03:00.000Z",
      error: { code: "unexpected" },
    });
    expect(JSON.stringify(store.getState())).not.toContain("private provider");
  });
});
