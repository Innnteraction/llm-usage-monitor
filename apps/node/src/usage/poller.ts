import type {
  AppSnapshot,
  ProviderId,
  ProviderSnapshot,
} from "../shared/index";

export const POLLING_INTERVAL_MS = 60_000;
export const POLLING_BACKOFF_MS = [
  60_000,
  120_000,
  240_000,
  480_000,
  900_000,
] as const;

interface PollingStore {
  getState(): AppSnapshot;
  refresh(providerId?: ProviderId): Promise<void>;
}

export interface UsagePollerOptions {
  store: PollingStore;
  providerIds: ProviderId[];
  clock?: () => Date;
  intervalMs?: number;
}

export function calculatePollingDelay(
  snapshot: ProviderSnapshot | undefined,
  failureCount: number,
  now: Date,
  intervalMs: number = POLLING_INTERVAL_MS,
): number {
  if (snapshot?.status === "fresh") {
    return intervalMs;
  }

  const retryAt = snapshot?.error?.retryAt;
  if (retryAt) {
    const retryDelay = new Date(retryAt).getTime() - now.getTime();
    if (Number.isFinite(retryDelay) && retryDelay > 0) {
      return retryDelay;
    }
  }

  return (
    POLLING_BACKOFF_MS[
      Math.min(Math.max(0, failureCount), POLLING_BACKOFF_MS.length - 1)
    ] ?? 900_000
  );
}

export function createUsagePoller({
  store,
  providerIds,
  clock = () => new Date(),
  intervalMs = POLLING_INTERVAL_MS,
}: UsagePollerOptions) {
  const timers = new Map<ProviderId, ReturnType<typeof setTimeout>>();
  const failureCounts = new Map<ProviderId, number>();
  const scheduledAt = new Map<ProviderId, number>();
  const inFlight = new Map<ProviderId, Promise<void>>();
  let pollingIntervalMs = intervalMs;
  let running = false;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;

  const clearTimer = (providerId: ProviderId): void => {
    const timer = timers.get(providerId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(providerId);
    }
  };

  const scheduleNext = (providerId: ProviderId): void => {
    if (!running || stopped) return;
    clearTimer(providerId);
    const providerSnapshot = store
      .getState()
      .providers.find(({ providerId: current }) => current === providerId);
    const failed = providerSnapshot?.status !== "fresh";
    const failureCount = failed ? (failureCounts.get(providerId) ?? 0) : 0;
    const now = clock();
    const delay = calculatePollingDelay(
      providerSnapshot,
      failureCount,
      now,
      pollingIntervalMs,
    );
    scheduledAt.set(providerId, now.getTime());
    failureCounts.set(providerId, failed ? failureCount + 1 : 0);
    timers.set(
      providerId,
      setTimeout(() => {
        void refreshProvider(providerId);
      }, delay),
    );
  };

  const setIntervalMs = (nextIntervalMs: number): void => {
    pollingIntervalMs = nextIntervalMs;
    if (!running || stopped) return;
    const nowMs = clock().getTime();
    for (const providerId of providerIds) {
      if (inFlight.has(providerId)) continue;
      const providerSnapshot = store
        .getState()
        .providers.find(({ providerId: current }) => current === providerId);
      if (providerSnapshot?.status !== "fresh") continue;
      clearTimer(providerId);
      const base = scheduledAt.get(providerId) ?? nowMs;
      const remaining = Math.max(0, pollingIntervalMs - (nowMs - base));
      if (remaining === 0) {
        void refreshProvider(providerId);
      } else {
        timers.set(
          providerId,
          setTimeout(() => {
            void refreshProvider(providerId);
          }, remaining),
        );
      }
    }
  };

  const refreshProvider = async (providerId: ProviderId): Promise<void> => {
    if (stopped) return;
    clearTimer(providerId);
    const existing = inFlight.get(providerId);
    if (existing) {
      // The store merges requests; schedule/backoff only once after the merged work.
      void store.refresh(providerId).catch(() => undefined);
      await existing;
      return;
    }
    const operation = Promise.resolve()
      .then(() => store.refresh(providerId))
      .catch(() => undefined)
      .finally(() => {
        if (running && !stopped) scheduleNext(providerId);
      });
    inFlight.set(providerId, operation);
    await operation;
    inFlight.delete(providerId);
  };

  const refresh = async (providerId?: ProviderId): Promise<void> => {
    const selected = providerId
      ? providerIds.filter((candidate) => candidate === providerId)
      : providerIds;
    await Promise.all(selected.map(refreshProvider));
  };

  return {
    start(): Promise<void> {
      if (running) {
        return Promise.resolve();
      }
      if (startPromise) return startPromise;
      startPromise = (async () => {
        if (stopPromise) {
          await stopPromise;
          stopPromise = undefined;
        }
        stopped = false;
        running = true;
        await refresh();
      })().finally(() => {
        startPromise = undefined;
      });
      return startPromise;
    },
    refresh,
    setIntervalMs,
    async stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      running = false;
      stopped = true;
      for (const providerId of providerIds) {
        clearTimer(providerId);
      }
      stopPromise = Promise.all([...inFlight.values()]).then(() => undefined);
      try {
        await stopPromise;
      } finally {
        stopPromise = undefined;
      }
    },
  };
}
