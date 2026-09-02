import type {
  AppSnapshot,
  LocalTokenUsage,
  LocalUsageProviderId,
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
  const longContent =
    process.env.LLM_USAGE_MONITOR_E2E_PHASE6_LONG_CONTENT === "1";
  const fiveHourUsed = (isCodex ? 42 : 28) + generation;
  const weeklyUsed = (isCodex ? 63 : 51) + generation;
  const localUsageState = process.env.LLM_USAGE_MONITOR_E2E_LOCAL_USAGE_STATE;
  const localUsage =
    localUsageState === "calculating"
      ? undefined
      : localUsageState === "no_logs"
        ? {
            scope: "local_device" as const,
            scannedFileCount: 0,
            failedFileCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            partial: false,
            calculatedAt: now.toISOString(),
          }
        : {
            scope: "local_device" as const,
            scannedFileCount: isCodex ? 9 : 4,
            failedFileCount: isCodex ? 0 : 1,
            inputTokens: longContent
              ? (isCodex ? 9_000_000_000 : 4_200_000_000)
              : (isCodex ? 900_000 : 420_000),
            outputTokens: longContent
              ? (isCodex ? 3_300_000_000 : 1_800_000_000)
              : (isCodex ? 330_000 : 180_000),
            cacheReadTokens: isCodex ? 700_000 : 200_000,
            cacheWriteTokens: isCodex ? 20_000 : 10_000,
            totalTokens: longContent
              ? (isCodex ? 12_300_000_000 : 6_000_000_000)
              : (isCodex ? 1_230_000 : 600_000),
            partial: !isCodex,
            calculatedAt: now.toISOString(),
            observedFrom: "2026-09-01T00:00:00.000Z",
          };

  return {
    providerId,
    accountLabel: longContent
      ? `${providerId}.account.with.a.deliberately.long.label@example.com`
      : isCodex
        ? "codex.user@example.com"
        : "claude.user@example.com",
    ...(isCodex ? {} : { authKind: "subscription" as const }),
    status: "fresh",
    fetchedAt: now.toISOString(),
    lastSuccessfulAt: now.toISOString(),
    ...(localUsage ? { localUsage } : {}),
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
      ...(isCodex
        ? [
            {
              id: "codex-limit-example-model-primary",
              kind: "other" as const,
              label:
                "Example Codex model with a deliberately long primary label",
              usedPercent: Math.min(17 + generation, 100),
              resetsAt: new Date(
                now.getTime() + 5 * 60 * 60 * 1000,
              ).toISOString(),
              source: "local_fixture" as const,
              status: "fresh" as const,
            },
            {
              id: "codex-limit-example-model-weekly",
              kind: "model_weekly" as const,
              label:
                "Example Codex model with a deliberately long weekly label",
              usedPercent: Math.min(31 + generation, 100),
              resetsAt: new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              source: "local_fixture" as const,
              status: "fresh" as const,
            },
          ]
        : process.env.LLM_USAGE_MONITOR_E2E_CLAUDE_NO_FABLE === "1"
          ? []
          : [
              {
                id: "claude-model-fable",
                kind: "model_weekly" as const,
                label: "Fable Weekly",
                usedPercent: Math.min(39 + generation, 100),
                resetsAt: new Date(
                  now.getTime() + 6 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                source: "local_fixture" as const,
                status: "fresh" as const,
              },
            ]),
    ],
  };
};

export const createFakeUsageStore = (clock: () => Date = () => new Date()) => {
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
    updateLocalUsage(
      providerId: LocalUsageProviderId,
      usage: LocalTokenUsage,
    ): void {
      snapshot = {
        ...snapshot,
        providers: snapshot.providers.map((provider) =>
          provider.providerId === providerId
            ? { ...provider, localUsage: usage }
            : provider,
        ),
      };
      publish();
    },
    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
