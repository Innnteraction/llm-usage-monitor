import {
  appSnapshotSchema,
  type AppSnapshot,
  type ProviderId,
  type ProviderSnapshot,
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
    { generation: number; promise: Promise<void> }
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
      return current.promise;
    }

    const generation = (generations.get(provider.id) ?? 0) + 1;
    generations.set(provider.id, generation);
    const promise = Promise.resolve()
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
              ? providerSnapshot
              : currentSnapshot,
          ),
          updatedAt: clock().toISOString(),
        });
      })
      .catch(() => {
        // Providers publish sanitized failures; unexpected throws retain the last snapshot.
      })
      .finally(() => {
        if (inFlight.get(provider.id)?.generation !== generation) {
          return;
        }
        inFlight.delete(provider.id);
        snapshot = appSnapshotSchema.parse({
          ...snapshot,
          refreshing: refreshingProviderIds(),
          updatedAt: clock().toISOString(),
        });
        publish();
      });
    inFlight.set(provider.id, { generation, promise });
    return promise;
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
    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
