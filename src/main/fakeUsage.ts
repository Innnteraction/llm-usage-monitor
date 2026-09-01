import type {
  AppSnapshot,
  ProviderId,
  ProviderSnapshot,
} from "../shared/index";

type SnapshotListener = (snapshot: AppSnapshot) => void;

const buildProvider = (
  providerId: "codex" | "claude",
  generation: number,
  now: Date,
): ProviderSnapshot => {
  const isCodex = providerId === "codex";
  const fiveHourUsed = (isCodex ? 42 : 28) + generation;
  const weeklyUsed = (isCodex ? 63 : 51) + generation;

  return {
    providerId,
    status: "fresh",
    fetchedAt: now.toISOString(),
    lastSuccessfulAt: now.toISOString(),
    quotaWindows: [
      {
        id: `${providerId}-five-hour`,
        kind: "five_hour",
        label: "5h",
        usedPercent: Math.min(fiveHourUsed, 100),
        resetsAt: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
        source: "local_fixture",
        status: "fresh",
      },
      {
        id: `${providerId}-weekly`,
        kind: "weekly",
        label: "Weekly",
        usedPercent: Math.min(weeklyUsed, 100),
        resetsAt: new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        source: "local_fixture",
        status: "fresh",
      },
    ],
  };
};

export const createFakeUsageStore = (
  clock: () => Date = () => new Date(),
) => {
  let generation = 0;
  let snapshot: AppSnapshot = {
    schemaVersion: 1,
    providers: [
      buildProvider("codex", generation, clock()),
      buildProvider("claude", generation, clock()),
    ],
    refreshing: [],
    updatedAt: clock().toISOString(),
  };
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
      const refreshing: ProviderId[] = providerId
        ? [providerId]
        : ["codex", "claude"];
      snapshot = { ...snapshot, refreshing };
      publish();

      await new Promise((resolve) => setTimeout(resolve, 40));
      generation += 1;
      const now = clock();
      snapshot = {
        schemaVersion: 1,
        providers: [
          buildProvider("codex", generation, now),
          buildProvider("claude", generation, now),
        ],
        refreshing: [],
        updatedAt: now.toISOString(),
      };
      publish();
    },
    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
