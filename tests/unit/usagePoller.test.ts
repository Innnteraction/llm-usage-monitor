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

    poller.stop();
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
