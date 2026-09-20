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
  it("preserves local usage regardless of quota refresh completion order", async () => {
    const fresh = deferred<ProviderSnapshot>();
    const unavailable = deferred<ProviderSnapshot>();
    const store = createUsageStore({
      providers: [
        {
          id: "codex",
          fetchQuota: vi
            .fn<() => Promise<ProviderSnapshot>>()
            .mockReturnValueOnce(fresh.promise)
            .mockReturnValueOnce(unavailable.promise),
        },
      ],
      initialSnapshots: [initialSnapshot("codex")],
    });
    const localUsage = {
      scope: "local_device" as const,
      scannedFileCount: 1,
      failedFileCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      partial: false,
      calculatedAt: "2026-09-01T03:02:00.000Z",
    };

    const firstRefresh = store.refresh("codex");
    store.updateLocalUsage("codex", localUsage);
    fresh.resolve(freshSnapshot("codex"));
    await firstRefresh;
    expect(store.getState().providers[0]?.localUsage).toEqual(localUsage);

    const secondRefresh = store.refresh("codex");
    unavailable.resolve({
      ...initialSnapshot("codex"),
      fetchedAt: "2026-09-01T03:03:00.000Z",
      error: { code: "network", message: "Sanitized provider failure." },
    });
    await secondRefresh;
    expect(store.getState().providers[0]).toMatchObject({
      status: "stale",
      localUsage,
    });
  });

  it("merges valid local usage without replacing quota state", () => {
    const store = createUsageStore({
      providers: [],
      initialSnapshots: [freshSnapshot("codex")],
    });
    store.updateLocalUsage("codex", {
      scope: "local_device",
      scannedFileCount: 1,
      failedFileCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      partial: false,
      calculatedAt: "2026-09-01T03:02:00.000Z",
    });
    expect(store.getState().providers[0]).toMatchObject({
      status: "fresh",
      lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
      localUsage: { totalTokens: 15 },
    });
    const stateBeforeUnknownProvider = store.getState();
    const updatedAtBeforeUnknownProvider = stateBeforeUnknownProvider.updatedAt;
    store.updateLocalUsage("claude", {
      scope: "local_device",
      scannedFileCount: 1,
      failedFileCount: 0,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      partial: false,
      calculatedAt: "2026-09-01T03:02:00.000Z",
    });
    expect(store.getState().providers).toHaveLength(1);
    expect(store.getState()).toBe(stateBeforeUnknownProvider);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeUnknownProvider);
  });

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

  it.each([
    "rate_limited",
    "network",
    "timeout",
    "unsupported_output",
  ] as const)(
    "retains the last successful value as stale after %s",
    async (errorCode) => {
      const failure: ProviderSnapshot = {
        providerId: "codex",
        status: "unavailable",
        fetchedAt: "2026-09-01T03:02:00.000Z",
        quotaWindows: [],
        error: { code: errorCode, message: "Sanitized provider failure." },
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
        error: { code: errorCode },
      });
    },
  );

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

  it("does not resurrect previously measured quota when a successful response reports it unavailable", async () => {
    const firstFresh: ProviderSnapshot = {
      providerId: "antigravity",
      status: "fresh",
      fetchedAt: "2026-09-01T03:01:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
      quotaWindows: [
        {
          id: "agy-gemini-5h",
          kind: "five_hour",
          label: "Gemini 5h",
          usedPercent: 30,
          resetsAt: "2026-09-01T08:00:00.000Z",
          source: "antigravity_cli",
          status: "fresh",
        },
        {
          id: "agy-gemini-weekly",
          kind: "model_weekly",
          label: "Gemini Weekly",
          usedPercent: 75,
          resetsAt: "2026-09-08T00:00:00.000Z",
          source: "antigravity_cli",
          status: "fresh",
        },
      ],
    };

    // 두 번째 응답: gemini-5h는 갱신되었으나 gemini-weekly는 unavailable (또는 usedPercent 없음)
    const secondPartial: ProviderSnapshot = {
      providerId: "antigravity",
      status: "fresh",
      fetchedAt: "2026-09-01T03:02:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:02:00.000Z",
      quotaWindows: [
        {
          id: "agy-gemini-5h",
          kind: "five_hour",
          label: "Gemini 5h",
          usedPercent: 45,
          resetsAt: "2026-09-01T08:00:00.000Z",
          source: "antigravity_cli",
          status: "fresh",
        },
        {
          id: "agy-gemini-weekly",
          kind: "model_weekly",
          label: "Gemini Weekly",
          source: "antigravity_cli",
          status: "unavailable",
        },
      ],
    };

    const fetchQuota = vi
      .fn<() => Promise<ProviderSnapshot>>()
      .mockResolvedValueOnce(firstFresh)
      .mockResolvedValueOnce(secondPartial);

    const store = createUsageStore({
      providers: [{ id: "antigravity", fetchQuota }],
      initialSnapshots: [initialSnapshot("antigravity")],
    });

    await store.refresh("antigravity");
    expect(store.getState().providers[0]?.quotaWindows).toEqual(firstFresh.quotaWindows);

    await store.refresh("antigravity");
    const updatedWindows = store.getState().providers[0]?.quotaWindows;
    expect(updatedWindows).toHaveLength(2);

    const fiveHour = updatedWindows?.find((w) => w.id === "agy-gemini-5h");
    const weekly = updatedWindows?.find((w) => w.id === "agy-gemini-weekly");

    expect(fiveHour).toMatchObject({
      usedPercent: 45,
      status: "fresh",
    });
    expect(weekly).toMatchObject({ status: "unavailable" });
    expect(weekly?.usedPercent).toBeUndefined();
    expect(weekly?.resetsAt).toBeUndefined();
  });

  it("removes quota omitted from a successful response and restores it on recovery", async () => {
    const firstFresh: ProviderSnapshot = {
      providerId: "codex",
      status: "fresh",
      fetchedAt: "2026-09-01T03:01:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
      quotaWindows: [
        {
          id: "codex-weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 60,
          source: "codex_app_server",
          status: "fresh",
        },
        {
          id: "codex-model-extra",
          kind: "model_weekly",
          label: "Extra",
          usedPercent: 20,
          source: "codex_app_server",
          status: "fresh",
        },
      ],
    };

    // 누락된 응답
    const secondOmitted: ProviderSnapshot = {
      providerId: "codex",
      status: "fresh",
      fetchedAt: "2026-09-01T03:02:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:02:00.000Z",
      quotaWindows: [
        {
          id: "codex-weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 65,
          source: "codex_app_server",
          status: "fresh",
        },
      ],
    };

    // 복원된 응답
    const thirdRecovered: ProviderSnapshot = {
      providerId: "codex",
      status: "fresh",
      fetchedAt: "2026-09-01T03:03:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:03:00.000Z",
      quotaWindows: [
        {
          id: "codex-weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 70,
          source: "codex_app_server",
          status: "fresh",
        },
        {
          id: "codex-model-extra",
          kind: "model_weekly",
          label: "Extra",
          usedPercent: 35,
          source: "codex_app_server",
          status: "fresh",
        },
      ],
    };

    const fetchQuota = vi
      .fn<() => Promise<ProviderSnapshot>>()
      .mockResolvedValueOnce(firstFresh)
      .mockResolvedValueOnce(secondOmitted)
      .mockResolvedValueOnce(thirdRecovered);

    const store = createUsageStore({
      providers: [{ id: "codex", fetchQuota }],
      initialSnapshots: [initialSnapshot("codex")],
    });

    await store.refresh("codex");
    await store.refresh("codex");

    const omittedWindows = store.getState().providers[0]?.quotaWindows;
    const staleExtra = omittedWindows?.find((w) => w.id === "codex-model-extra");
    expect(staleExtra).toBeUndefined();

    await store.refresh("codex");
    const recoveredWindows = store.getState().providers[0]?.quotaWindows;
    const freshExtra = recoveredWindows?.find((w) => w.id === "codex-model-extra");
    expect(freshExtra).toMatchObject({
      usedPercent: 35,
      status: "fresh",
    });
  });
});
