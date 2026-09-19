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
  onProgress?: (providerId: ProviderId, active: boolean) => void;
}

export function createVendorHealthPoller(options: VendorHealthPollerOptions) {
  const {
    providerIds,
    onUpdate,
    fetcher = fetchVendorServiceStatus,
    fetchOptions = {},
    onProgress,
    normalIntervalMs = HEALTH_POLL_NORMAL_INTERVAL_MS,
    incidentIntervalMs = HEALTH_POLL_INCIDENT_INTERVAL_MS,
  } = options;

  let running = false;
  let stopped = false;
  const timers = new Map<ProviderId, ReturnType<typeof setTimeout>>();
  const inFlight = new Map<ProviderId, { queued: boolean; promise: Promise<void> }>();
  const latestStatuses = new Map<ProviderId, VendorServiceStatus>();

  const request = (providerId: ProviderId): Promise<void> => {
    if (stopped) return Promise.resolve();
    const existing = inFlight.get(providerId);
    if (existing) { existing.queued = true; return existing.promise; }
    clearTimeout(timers.get(providerId));
    timers.delete(providerId);
    onProgress?.(providerId, true);
    const entry = { queued: false, promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(async () => {
      do {
        entry.queued = false;
        try {
          const status = await fetcher(providerId, undefined, fetchOptions);
          latestStatuses.set(providerId, status);
          onUpdate(providerId, status);
        } catch { /* isolated; retry using the incident interval */ }
      } while (!stopped && entry.queued);
    }).finally(() => {
      inFlight.delete(providerId);
      onProgress?.(providerId, false);
      if (running && !stopped) {
        const delay = latestStatuses.get(providerId)?.indicator === "operational"
          ? normalIntervalMs : incidentIntervalMs;
        timers.set(providerId, setTimeout(() => { void request(providerId); }, delay));
      }
    });
    inFlight.set(providerId, entry);
    return entry.promise;
  };
  const refresh = async (target?: ProviderId): Promise<void> => {
    await Promise.all(providerIds.filter(id => !target || id === target).map(request));
  };

  return {
    async start(): Promise<void> {
      if (running) return;
      stopped = false;
      running = true;
      await refresh();
    },
    refresh,
    async stop(): Promise<void> {
      running = false;
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all([...inFlight.values()].map(entry => entry.promise));
    },

    getStatuses(): ReadonlyMap<ProviderId, VendorServiceStatus> {
      return latestStatuses;
    },
  };
}

export type VendorHealthPoller = ReturnType<typeof createVendorHealthPoller>;
