import {
  appSnapshotSchema,
  type AppSnapshot,
  type ProviderId,
  type ProviderSnapshot,
  type QuotaWindow,
  type LocalTokenUsage,
  type LocalUsageProviderId,
  type VendorServiceStatus,
  localTokenUsageSchema,
  providerSnapshotSchema,
  vendorServiceStatusSchema,
} from "../shared/index";

export interface QuotaProvider {
  readonly id: ProviderId;
  fetchQuota(): Promise<ProviderSnapshot>;
  dispose?(): Promise<void>;
}

export interface UsageStoreOptions {
  providers: QuotaProvider[];
  initialSnapshots: ProviderSnapshot[];
  clock?: () => Date;
}

type SnapshotListener = (snapshot: AppSnapshot) => void;

export const mergeQuotaWindows = (
  currentWindows: QuotaWindow[],
  freshWindows: QuotaWindow[],
): QuotaWindow[] => {
  // Successful authoritative responses replace missing/deleted limits too.
  // Whole-provider failures are handled separately by retainLastSuccessfulSnapshot.
  void currentWindows;
  return freshWindows;
};

const retainLastSuccessfulSnapshot = (
  current: ProviderSnapshot,
  failure: ProviderSnapshot,
): ProviderSnapshot => {
  if (!current.lastSuccessfulAt) {
    return providerSnapshotSchema.parse({
      ...failure,
      ...(current.localUsage ? { localUsage: current.localUsage } : {}),
      ...(current.serviceStatus ? { serviceStatus: current.serviceStatus } : {}),
    });
  }

  return providerSnapshotSchema.parse({
    ...current,
    status: "stale",
    fetchedAt: failure.fetchedAt,
    quotaWindows: current.quotaWindows.map((window) => ({
      ...window,
      status: window.status === "unavailable" ? "unavailable" : "stale",
    })),
    ...(current.serviceStatus ? { serviceStatus: current.serviceStatus } : {}),
    ...(failure.error ? { error: failure.error } : {}),
  });
};

export function createUsageStore({
  providers,
  initialSnapshots,
  clock = () => new Date(),
}: UsageStoreOptions) {
  let snapshot = appSnapshotSchema.parse({
    schemaVersion: 1,
    providers: initialSnapshots,
    refreshing: [],
    updatedAt: clock().toISOString(),
  });
  const listeners = new Set<SnapshotListener>();
  const backgroundTasks = new Set<string>();
  const generations = new Map<ProviderId, number>();
  const inFlight = new Map<
    ProviderId,
    { generation: number; queued: boolean; promise: Promise<void> }
  >();

  const publish = (): void => {
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const refreshingProviderIds = (): ProviderId[] =>
    providers
      .map(({ id }) => id)
      .filter((providerId) => inFlight.has(providerId) || backgroundTasks.has(`local:${providerId}`) || backgroundTasks.has(`health:${providerId}`));

  const startRefresh = (provider: QuotaProvider): Promise<void> => {
    const current = inFlight.get(provider.id);
    if (current) {
      current.queued = true;
      return current.promise;
    }

    const generation = (generations.get(provider.id) ?? 0) + 1;
    generations.set(provider.id, generation);
    const entry = {
      generation,
      queued: false,
      promise: Promise.resolve(),
    };
    entry.promise = Promise.resolve()
      .then(() => provider.fetchQuota())
      .then((providerSnapshot) => {
        if (
          generations.get(provider.id) !== generation ||
          providerSnapshot.providerId !== provider.id
        ) {
          return;
        }
        snapshot = appSnapshotSchema.parse({
          ...snapshot,
          providers: snapshot.providers.map((currentSnapshot) =>
            currentSnapshot.providerId === provider.id
              ? providerSnapshot.status === "unavailable"
                ? retainLastSuccessfulSnapshot(
                    currentSnapshot,
                    providerSnapshot,
                  )
                : {
                    ...providerSnapshot,
                    quotaWindows: mergeQuotaWindows(
                      currentSnapshot.quotaWindows,
                      providerSnapshot.quotaWindows,
                    ),
                    ...(currentSnapshot.localUsage
                      ? { localUsage: currentSnapshot.localUsage }
                      : {}),
                    ...(currentSnapshot.serviceStatus
                      ? { serviceStatus: currentSnapshot.serviceStatus }
                      : {}),
                  }
              : currentSnapshot,
          ),
          updatedAt: clock().toISOString(),
        });
      })
      .catch(() => {
        const failure = providerSnapshotSchema.parse({
          providerId: provider.id,
          status: "unavailable",
          fetchedAt: clock().toISOString(),
          quotaWindows: [],
          error: {
            code: "unexpected",
            message: "Usage refresh failed unexpectedly.",
          },
        });
        snapshot = appSnapshotSchema.parse({
          ...snapshot,
          providers: snapshot.providers.map((currentSnapshot) =>
            currentSnapshot.providerId === provider.id
              ? retainLastSuccessfulSnapshot(currentSnapshot, failure)
              : currentSnapshot,
          ),
          updatedAt: clock().toISOString(),
        });
      })
      .then(() => {
        if (inFlight.get(provider.id)?.generation !== generation) {
          return;
        }
        if (entry.queued) {
          publish();
          inFlight.delete(provider.id);
          return startRefresh(provider);
        }
        inFlight.delete(provider.id);
        snapshot = appSnapshotSchema.parse({
          ...snapshot,
          refreshing: refreshingProviderIds(),
          updatedAt: clock().toISOString(),
        });
        publish();
      });
    inFlight.set(provider.id, entry);
    return entry.promise;
  };

  return {
    setTaskRefreshing(kind: "local" | "health", providerId: ProviderId, active: boolean): void {
      const key = `${kind}:${providerId}`;
      if (active) backgroundTasks.add(key); else backgroundTasks.delete(key);
      snapshot = { ...snapshot, refreshing: refreshingProviderIds() };
      publish();
    },
    getState(): AppSnapshot {
      return snapshot;
    },
    async refresh(providerId?: ProviderId): Promise<void> {
      const selected = providers.filter(
        (provider) => providerId === undefined || provider.id === providerId,
      );
      if (selected.length === 0) {
        return;
      }

      const before = inFlight.size;
      const refreshes = selected.map(startRefresh);
      if (inFlight.size !== before) {
        snapshot = appSnapshotSchema.parse({
          ...snapshot,
          refreshing: refreshingProviderIds(),
          updatedAt: clock().toISOString(),
        });
        publish();
      }
      await Promise.all(refreshes);
    },
    updateLocalUsage(
      providerId: LocalUsageProviderId,
      usage: LocalTokenUsage,
    ): void {
      if (
        !snapshot.providers.some(
          (provider) => provider.providerId === providerId,
        )
      ) {
        return;
      }
      const parsed = localTokenUsageSchema.safeParse(usage);
      if (!parsed.success) return;
      snapshot = appSnapshotSchema.parse({
        ...snapshot,
        providers: snapshot.providers.map((provider) => {
          if (provider.providerId !== providerId) return provider;
          return { ...provider, localUsage: parsed.data };
        }),
        updatedAt: clock().toISOString(),
      });
      publish();
    },
    updateVendorServiceStatus(
      providerId: ProviderId,
      serviceStatus: VendorServiceStatus,
    ): void {
      if (
        !snapshot.providers.some(
          (provider) => provider.providerId === providerId,
        )
      ) {
        return;
      }
      const parsed = vendorServiceStatusSchema.safeParse(serviceStatus);
      if (!parsed.success) return;
      snapshot = appSnapshotSchema.parse({
        ...snapshot,
        providers: snapshot.providers.map((provider) => {
          if (provider.providerId !== providerId) return provider;
          return { ...provider, serviceStatus: parsed.data };
        }),
        updatedAt: clock().toISOString(),
      });
      publish();
    },
    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
