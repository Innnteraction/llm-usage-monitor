import {
  appSnapshotSchema,
  type AppSnapshot,
  type ProviderId,
  type ProviderSnapshot,
  type QuotaWindow,
  type LocalTokenUsage,
  type LocalUsageProviderId,
  localTokenUsageSchema,
  providerSnapshotSchema,
} from "../shared/index";

export interface QuotaProvider {
  readonly id: ProviderId;
  fetchQuota(): Promise<ProviderSnapshot>;
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
  const currentMap = new Map(currentWindows.map((window) => [window.id, window]));
  const processedIds = new Set<string>();

  const merged = freshWindows.map((freshWindow) => {
    processedIds.add(freshWindow.id);
    const prev = currentMap.get(freshWindow.id);

    const isMissingUsage =
      freshWindow.usedPercent === undefined || freshWindow.status === "unavailable";

    if (isMissingUsage && prev && prev.usedPercent !== undefined) {
      return {
        ...freshWindow,
        usedPercent: prev.usedPercent,
        resetsAt: freshWindow.resetsAt ?? prev.resetsAt,
        status: "stale" as const,
      };
    }

    return freshWindow;
  });

  for (const prev of currentWindows) {
    if (!processedIds.has(prev.id) && prev.usedPercent !== undefined) {
      merged.push({
        ...prev,
        status: "stale" as const,
      });
      processedIds.add(prev.id);
    }
  }

  return merged;
};

const retainLastSuccessfulSnapshot = (
  current: ProviderSnapshot,
  failure: ProviderSnapshot,
): ProviderSnapshot => {
  if (!current.lastSuccessfulAt) {
    return providerSnapshotSchema.parse({
      ...failure,
      ...(current.localUsage ? { localUsage: current.localUsage } : {}),
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
      .filter((providerId) => inFlight.has(providerId));

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
    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
