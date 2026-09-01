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
}

export function calculatePollingDelay(
  snapshot: ProviderSnapshot | undefined,
  failureCount: number,
  now: Date,
): number {
  if (snapshot?.status === "fresh") {
    return POLLING_INTERVAL_MS;
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
}: UsagePollerOptions) {
  const timers = new Map<ProviderId, ReturnType<typeof setTimeout>>();
  const failureCounts = new Map<ProviderId, number>();
  let running = false;

  const clearTimer = (providerId: ProviderId): void => {
    const timer = timers.get(providerId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(providerId);
    }
  };

  const scheduleNext = (providerId: ProviderId): void => {
    clearTimer(providerId);
    const providerSnapshot = store
      .getState()
      .providers.find(({ providerId: current }) => current === providerId);
    const failed = providerSnapshot?.status !== "fresh";
    const failureCount = failed ? (failureCounts.get(providerId) ?? 0) : 0;
    const delay = calculatePollingDelay(
      providerSnapshot,
      failureCount,
      clock(),
    );
    failureCounts.set(providerId, failed ? failureCount + 1 : 0);
    timers.set(
      providerId,
      setTimeout(() => {
        void refreshProvider(providerId);
      }, delay),
    );
  };

  const refreshProvider = async (providerId: ProviderId): Promise<void> => {
    clearTimer(providerId);
    await store.refresh(providerId);
    if (running) {
      scheduleNext(providerId);
    }
  };

  const refresh = async (providerId?: ProviderId): Promise<void> => {
    const selected = providerId
      ? providerIds.filter((candidate) => candidate === providerId)
      : providerIds;
    await Promise.all(selected.map(refreshProvider));
  };

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }
      running = true;
      await refresh();
    },
    refresh,
    stop(): void {
      running = false;
      for (const providerId of providerIds) {
        clearTimer(providerId);
      }
    },
  };
}
