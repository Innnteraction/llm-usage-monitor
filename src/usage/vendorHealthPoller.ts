import type { ProviderId, VendorServiceStatus } from "../shared/index";
import {
  fetchVendorServiceStatus,
  type FetchStatusOptions,
} from "./vendorHealthFetcher";

export const HEALTH_POLL_NORMAL_INTERVAL_MS = 15 * 60 * 1000; // 15분
export const HEALTH_POLL_INCIDENT_INTERVAL_MS = 5 * 60 * 1000;  // 5분

export interface VendorHealthPollerOptions {
  providerIds: ProviderId[];
  onUpdate: (providerId: ProviderId, status: VendorServiceStatus) => void;
  fetcher?: typeof fetchVendorServiceStatus;
  fetchOptions?: FetchStatusOptions;
  normalIntervalMs?: number;
  incidentIntervalMs?: number;
  clock?: () => Date;
}

export function createVendorHealthPoller(options: VendorHealthPollerOptions) {
  const {
    providerIds,
    onUpdate,
    fetcher = fetchVendorServiceStatus,
    fetchOptions = {},
    normalIntervalMs = HEALTH_POLL_NORMAL_INTERVAL_MS,
    incidentIntervalMs = HEALTH_POLL_INCIDENT_INTERVAL_MS,
  } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  let startPromise: Promise<void> | undefined;
  let inFlight: Promise<void> | undefined;

  const latestStatuses = new Map<ProviderId, VendorServiceStatus>();

  const hasAnyIncident = (): boolean => {
    for (const status of latestStatuses.values()) {
      if (status.indicator !== "operational") {
        return true;
      }
    }
    return false;
  };

  const clearCurrentTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleNext = (): void => {
    if (!running || stopped) return;
    clearCurrentTimer();
    const delay = hasAnyIncident() ? incidentIntervalMs : normalIntervalMs;
    timer = setTimeout(() => {
      void runPollCycle();
    }, delay);
  };

  const pollProvider = async (providerId: ProviderId): Promise<void> => {
    try {
      const status = await fetcher(providerId, undefined, fetchOptions);
      latestStatuses.set(providerId, status);
      onUpdate(providerId, status);
    } catch {
      // ignore individual failure, fetcher already returns unknown on error
    }
  };

  const runPollCycle = async (targetProviderId?: ProviderId): Promise<void> => {
    if (stopped) return;
    clearCurrentTimer();

    const targets = targetProviderId
      ? providerIds.filter((id) => id === targetProviderId)
      : providerIds;

    const op = Promise.allSettled(targets.map(pollProvider)).then(() => undefined);
    inFlight = op;
    await op;
    inFlight = undefined;

    if (running && !stopped) {
      scheduleNext();
    }
  };

  return {
    async start(): Promise<void> {
      if (running) return;
      if (startPromise) return startPromise;

      stopped = false;
      running = true;
      startPromise = runPollCycle().finally(() => {
        startPromise = undefined;
      });
      return startPromise;
    },

    async refresh(targetProviderId?: ProviderId): Promise<void> {
      if (stopped) return;
      await runPollCycle(targetProviderId);
    },

    async stop(): Promise<void> {
      running = false;
      stopped = true;
      clearCurrentTimer();
      if (inFlight) {
        await inFlight;
      }
    },

    getStatuses(): ReadonlyMap<ProviderId, VendorServiceStatus> {
      return latestStatuses;
    },
  };
}

export type VendorHealthPoller = ReturnType<typeof createVendorHealthPoller>;
