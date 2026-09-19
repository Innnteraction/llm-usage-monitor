import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { z } from "zod";
import {
  providerSnapshotSchema,
  type AppSnapshot,
  type ProviderSnapshot,
} from "../shared/index";

export const SNAPSHOT_CACHE_FILENAME = "quota-v2.json";
export const sharedCacheDirectory = (): string => process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "llm-usage-monitor", "shared")
  : path.join(homedir(), "Library", "Application Support", "llm-usage-monitor", "shared");

export const sharedLockPort = (directory: string): number => {
  let key = path.resolve(directory).replaceAll("\\", "/");
  if (process.platform === "win32") key = key.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return 49152 + createHash("sha256").update(key).digest().readUInt16BE(0) % 16384;
};
export const acquireSharedLock = (directory: string): Promise<Server> => new Promise((resolve, reject) => {
  const server = createServer((socket) => socket.destroy());
  server.once("error", reject);
  server.listen({ host: "127.0.0.1", port: sharedLockPort(directory), exclusive: true }, () => resolve(server));
});

const cacheEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
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

  constructor(private readonly filePath: string, private readonly legacyPath?: string) {}

  async load(): Promise<ProviderSnapshot[]> {
    try {
      let value: unknown;
      try { value = JSON.parse(await readFile(this.filePath, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !this.legacyPath) throw error;
        const old = JSON.parse(await readFile(this.legacyPath, "utf8")) as { schemaVersion: number; providers: unknown[] };
        if (old.schemaVersion !== 1) return [];
        value = { schemaVersion: 2, providers: old.providers };
      }
      const envelope = cacheEnvelopeSchema.parse(value);
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
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(
          temporaryPath,
          JSON.stringify({ schemaVersion: 2, providers }),
          "utf8",
        );
        await rename(temporaryPath, this.filePath);
      })
      .catch(() => undefined);
    return this.writeQueue;
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }
}
