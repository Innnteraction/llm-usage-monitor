import type {
  LocalUsageScanner,
  LocalUsageProviderId,
  LocalTokenUsage,
} from "../shared/index";

export const LOCAL_USAGE_DEBOUNCE_MS = 750;
export const LOCAL_USAGE_RECONCILE_MS = 60_000;

interface LocalUsageStore {
  updateLocalUsage(
    providerId: LocalUsageProviderId,
    usage: LocalTokenUsage,
  ): void;
}

export interface LocalUsageCoordinatorOptions {
  scanners: LocalUsageScanner[];
  store: LocalUsageStore;
  debounceMs?: number;
  reconcileMs?: number;
}

interface ScanEntry {
  controller: AbortController;
  queued: boolean;
  promise: Promise<void>;
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : (error as { name?: unknown })?.name === "AbortError";

export function createLocalUsageCoordinator({
  scanners,
  store,
  debounceMs = LOCAL_USAGE_DEBOUNCE_MS,
  reconcileMs = LOCAL_USAGE_RECONCILE_MS,
}: LocalUsageCoordinatorOptions) {
  const scannerById = new Map(
    scanners.map((scanner) => [scanner.providerId, scanner]),
  );
  const scans = new Map<LocalUsageProviderId, ScanEntry>();
  const debounceTimers = new Map<
    LocalUsageProviderId,
    ReturnType<typeof setTimeout>
  >();
  let unwatch: Array<() => void> = [];
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopPromise: Promise<void> | undefined;

  const request = (providerId: LocalUsageProviderId): Promise<void> => {
    if (!running) return Promise.resolve();
    const scanner = scannerById.get(providerId);
    if (!scanner) return Promise.resolve();
    const existing = scans.get(providerId);
    if (existing) {
      existing.queued = true;
      return existing.promise;
    }

    const entry: ScanEntry = {
      controller: new AbortController(),
      queued: false,
      promise: Promise.resolve(),
    };
    entry.promise = (async () => {
      do {
        entry.queued = false;
        try {
          const usage = await scanner.scan(entry.controller.signal);
          if (!entry.controller.signal.aborted)
            store.updateLocalUsage(providerId, usage);
        } catch (error) {
          if (!isAbort(error)) {
            /* isolated retry on later dirty/reconcile */
          }
        }
      } while (running && !entry.controller.signal.aborted && entry.queued);
    })().finally(() => {
      if (scans.get(providerId) === entry) scans.delete(providerId);
    });
    scans.set(providerId, entry);
    return entry.promise;
  };

  const dirty = (providerId: LocalUsageProviderId): void => {
    if (!running) return;
    const previous = debounceTimers.get(providerId);
    if (previous) clearTimeout(previous);
    debounceTimers.set(
      providerId,
      setTimeout(() => {
        debounceTimers.delete(providerId);
        void request(providerId);
      }, debounceMs),
    );
  };

  const refresh = async (providerId?: LocalUsageProviderId): Promise<void> => {
    const providerIds = providerId ? [providerId] : [...scannerById.keys()];
    await Promise.all(providerIds.map(request));
  };

  return {
    async start(): Promise<void> {
      if (running) return;
      if (stopPromise) await stopPromise;
      running = true;
      stopPromise = undefined;
      unwatch = [...scannerById.values()].map((scanner) => {
        try {
          return scanner.watch(() => dirty(scanner.providerId));
        } catch {
          return () => undefined;
        }
      });
      reconcileTimer = setInterval(() => {
        void refresh();
      }, reconcileMs);
      await refresh();
    },
    refresh,
    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      if (!running) return Promise.resolve();
      running = false;
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      if (reconcileTimer) clearInterval(reconcileTimer);
      reconcileTimer = undefined;
      for (const close of unwatch) close();
      unwatch = [];
      for (const entry of scans.values()) entry.controller.abort();
      stopPromise = Promise.all(
        [...scans.values()].map(({ promise }) => promise),
      ).then(() => undefined);
      return stopPromise;
    },
  };
}
