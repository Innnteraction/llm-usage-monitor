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

  const publish = (): void => {
    for (const listener of listeners) {
      listener(snapshot);
    }
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

      snapshot = appSnapshotSchema.parse({
        ...snapshot,
        refreshing: selected.map(({ id }) => id),
        updatedAt: clock().toISOString(),
      });
      publish();

      const refreshed = await Promise.all(
        selected.map((provider) => provider.fetchQuota()),
      );
      const byProvider = new Map(
        refreshed.map((providerSnapshot) => [
          providerSnapshot.providerId,
          providerSnapshot,
        ]),
      );
      snapshot = appSnapshotSchema.parse({
        ...snapshot,
        providers: snapshot.providers.map(
          (current) => byProvider.get(current.providerId) ?? current,
        ),
        refreshing: [],
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
