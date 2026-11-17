import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot, ProviderSnapshot } from "../../src/shared/index";
import {
  POLLING_BACKOFF_MS,
  POLLING_INTERVAL_MS,
  calculatePollingDelay,
  createUsagePoller,
} from "../../src/usage/index";

const now = new Date("2026-09-01T03:00:00.000Z");

const providerSnapshot = (
  status: ProviderSnapshot["status"],
  retryAt?: string,
): ProviderSnapshot => ({
  providerId: "codex",
  status,
  fetchedAt: now.toISOString(),
  quotaWindows: [],
  ...(retryAt
    ? {
        error: {
          code: "rate_limited",
          message: "Retry later.",
          retryAt,
        },
      }
    : {}),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usage polling", () => {
  it("uses 60 seconds after success and capped exponential backoff", () => {
    expect(calculatePollingDelay(providerSnapshot("fresh"), 4, now)).toBe(
      POLLING_INTERVAL_MS,
    );
    expect(
      [0, 1, 2, 3, 4, 5].map((failureCount) =>
        calculatePollingDelay(
          providerSnapshot("unavailable"),
          failureCount,
          now,
        ),
      ),
    ).toEqual([...POLLING_BACKOFF_MS, POLLING_BACKOFF_MS.at(-1)]);
  });

  it("prioritizes a future Retry-After time", () => {
    expect(
      calculatePollingDelay(
        providerSnapshot(
          "unavailable",
          new Date(now.getTime() + 75_000).toISOString(),
        ),
        4,
        now,
      ),
    ).toBe(75_000);
  });

  it("refreshes immediately, schedules again and stops cleanly", async () => {
    vi.useFakeTimers();
    let snapshot: AppSnapshot = {
      schemaVersion: 1,
      providers: [providerSnapshot("fresh")],
      refreshing: [],
      updatedAt: now.toISOString(),
    };
    const refresh = vi.fn(async () => {
      snapshot = { ...snapshot, updatedAt: now.toISOString() };
    });
    const poller = createUsagePoller({
      store: { getState: () => snapshot, refresh },
      providerIds: ["codex"],
      clock: () => now,
    });

    await poller.start();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    await poller.stop();
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps manual refresh available before polling starts", async () => {
    const refresh = vi.fn(async () => undefined);
    const poller = createUsagePoller({
      store: {
        getState: () => ({ schemaVersion: 1, providers: [providerSnapshot("fresh")], refreshing: [], updatedAt: now.toISOString() }),
        refresh,
      },
      providerIds: ["codex"],
      clock: () => now,
    });

    await poller.refresh("codex");
    expect(refresh).toHaveBeenCalledTimes(1);
    await poller.stop();
    await poller.refresh("codex");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("can start again after an awaited stop", async () => {
    const refresh = vi.fn(async () => undefined);
    const poller = createUsagePoller({
      store: {
        getState: () => ({ schemaVersion: 1, providers: [providerSnapshot("fresh")], refreshing: [], updatedAt: now.toISOString() }),
        refresh,
      },
      providerIds: ["codex"],
      clock: () => now,
    });

    await poller.start();
    await poller.stop();
    await poller.start();
    expect(refresh).toHaveBeenCalledTimes(2);
    await poller.stop();
  });

  it("waits for an in-flight refresh and suppresses timers after stop", async () => {
    vi.useFakeTimers();
    let complete: (() => void) | undefined;
    const refresh = vi.fn(
      () => new Promise<void>((resolve) => { complete = resolve; }),
    );
    const poller = createUsagePoller({
      store: { getState: () => ({ schemaVersion: 1, providers: [providerSnapshot("fresh")], refreshing: [], updatedAt: now.toISOString() }), refresh },
      providerIds: ["codex"],
      clock: () => now,
    });
    const start = poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopped = poller.stop();
    expect(refresh).toHaveBeenCalledTimes(1);
    complete?.();
    await Promise.all([start, stopped]);
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("contains rejected refreshes without scheduling after stop", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => { throw new Error("fixture failure"); });
    const poller = createUsagePoller({
      store: { getState: () => ({ schemaVersion: 1, providers: [providerSnapshot("unavailable")], refreshing: [], updatedAt: now.toISOString() }), refresh },
      providerIds: ["codex"],
      clock: () => now,
    });
    await poller.start();
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    await poller.stop();
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("supports custom intervals and reschedules fresh providers immediately on change", async () => {
    vi.useFakeTimers();
    let currentTime = now.getTime();
    const snapshot: AppSnapshot = {
      schemaVersion: 1,
      providers: [providerSnapshot("fresh")],
      refreshing: [],
      updatedAt: now.toISOString(),
    };
    const refresh = vi.fn(async () => undefined);
    const poller = createUsagePoller({
      store: { getState: () => snapshot, refresh },
      providerIds: ["codex"],
      clock: () => new Date(currentTime),
      intervalMs: 300_000,
    });

    await poller.start();
    expect(refresh).toHaveBeenCalledTimes(1);

    // 90초 경과 후 주기를 1분(60_000ms)으로 줄이면 이미 지났으므로 즉시 실행됨
    currentTime += 90_000;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    poller.setIntervalMs(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);

    // 다음 실행 후 주기를 5분으로 늘리면 60초 시점에는 실행되지 않고 5분 시점에 실행됨
    poller.setIntervalMs(300_000);
    currentTime += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    currentTime += 240_000;
    await vi.advanceTimersByTimeAsync(240_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    await poller.stop();
  });

  it("supports repeated stop and start cycles for pause/resume", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const poller = createUsagePoller({
      store: {
        getState: () => ({
          schemaVersion: 1,
          providers: [providerSnapshot("fresh")],
          refreshing: [],
          updatedAt: now.toISOString(),
        }),
        refresh,
      },
      providerIds: ["codex"],
      clock: () => now,
      intervalMs: 120_000,
    });

    await poller.start();
    expect(refresh).toHaveBeenCalledTimes(1);

    await poller.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    await poller.start();
    expect(refresh).toHaveBeenCalledTimes(2);
    await poller.stop();
  });
});
