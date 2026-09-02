import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  providerSnapshotSchema,
  type AppSnapshot,
  type ProviderSnapshot,
} from "../shared/index";

export const SNAPSHOT_CACHE_FILENAME = "usage-snapshot-v1.json";

const cacheEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    providers: z.array(z.unknown()),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeForCache = (
  snapshot: ProviderSnapshot,
): Omit<ProviderSnapshot, "accountLabel" | "error"> => ({
  providerId: snapshot.providerId,
  status: snapshot.status,
  fetchedAt: snapshot.fetchedAt,
  ...(snapshot.lastSuccessfulAt
    ? { lastSuccessfulAt: snapshot.lastSuccessfulAt }
    : {}),
  quotaWindows: snapshot.quotaWindows,
});

const parseCachedProvider = (value: unknown): ProviderSnapshot => {
  if (
    !isRecord(value) ||
    "accountLabel" in value ||
    "error" in value ||
    "localUsage" in value
  ) {
    throw new Error("Unsupported snapshot cache.");
  }
  const parsed = providerSnapshotSchema.parse(value);
  if (!parsed.lastSuccessfulAt) {
    throw new Error("Snapshot cache has no successful value.");
  }
  return providerSnapshotSchema.parse({
    ...parsed,
    status: "stale",
    fetchedAt: parsed.lastSuccessfulAt,
    quotaWindows: parsed.quotaWindows.map((window) => ({
      ...window,
      status: window.status === "unavailable" ? "unavailable" : "stale",
    })),
  });
};

export const mergeCachedSnapshots = (
  defaults: ProviderSnapshot[],
  cached: ProviderSnapshot[],
): ProviderSnapshot[] =>
  defaults.map(
    (fallback) =>
      cached.find(({ providerId }) => providerId === fallback.providerId) ??
      fallback,
  );

export class SnapshotCache {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<ProviderSnapshot[]> {
    try {
      const envelope = cacheEnvelopeSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
      return envelope.providers.map(parseCachedProvider);
    } catch {
      return [];
    }
  }

  save(snapshot: AppSnapshot): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(async () => {
        const providers = snapshot.providers
          .filter(({ lastSuccessfulAt }) => Boolean(lastSuccessfulAt))
          .map(sanitizeForCache);
        const temporaryPath = `${this.filePath}.tmp`;
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(
          temporaryPath,
          JSON.stringify({ schemaVersion: 1, providers }),
          "utf8",
        );
        await rename(temporaryPath, this.filePath);
      })
      .catch(() => undefined);
    return this.writeQueue;
  }
}
