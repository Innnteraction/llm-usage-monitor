import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeCachedSnapshots,
  SNAPSHOT_CACHE_FILENAME,
  SnapshotCache,
} from "../../src/main/index";
import type { AppSnapshot, ProviderSnapshot } from "../../src/shared/index";

const temporaryDirectories: string[] = [];

const freshProvider = (usedPercent = 31): ProviderSnapshot => ({
  providerId: "codex",
  accountLabel: "private.account@example.invalid",
  status: "fresh",
  fetchedAt: "2026-09-01T03:01:00.000Z",
  lastSuccessfulAt: "2026-09-01T03:01:00.000Z",
  quotaWindows: [
    {
      id: "codex-weekly",
      kind: "weekly",
      label: "Weekly",
      usedPercent,
      source: "codex_app_server",
      status: "fresh",
    },
  ],
  error: {
    code: "unexpected",
    message: "private.account@example.invalid must not be cached",
  },
});

const appSnapshot = (provider: ProviderSnapshot): AppSnapshot => ({
  schemaVersion: 1,
  providers: [provider],
  refreshing: [],
  updatedAt: provider.fetchedAt,
});

const createCache = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "llm-usage-monitor-cache-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, SNAPSHOT_CACHE_FILENAME);
  return { cache: new SnapshotCache(filePath), directory, filePath };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SnapshotCache", () => {
  it("atomically stores only sanitized successful snapshots", async () => {
    const { cache, directory, filePath } = await createCache();
    await cache.save(appSnapshot(freshProvider()));

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("private.account");
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      providers: [{ providerId: "codex", status: "fresh" }],
    });
    expect(await readdir(directory)).toEqual([SNAPSHOT_CACHE_FILENAME]);

    const loaded = await new SnapshotCache(filePath).load();
    expect(loaded[0]).toMatchObject({
      providerId: "codex",
      status: "stale",
      fetchedAt: "2026-09-01T03:01:00.000Z",
      quotaWindows: [{ usedPercent: 31, status: "stale" }],
    });
    expect(loaded[0]).not.toHaveProperty("accountLabel");
    expect(loaded[0]).not.toHaveProperty("error");
  });

  it("never stores local usage and rejects legacy cache containing it", async () => {
    const { cache, filePath } = await createCache();
    const provider = {
      ...freshProvider(),
      localUsage: {
        scope: "local_device" as const,
        scannedFileCount: 1,
        failedFileCount: 0,
        inputTokens: 1234,
        outputTokens: 5,
        totalTokens: 1239,
        partial: false,
        calculatedAt: "2026-09-01T03:01:00.000Z",
      },
    };
    await cache.save(appSnapshot(provider));
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("localUsage");
    expect(raw).not.toContain("inputTokens");
    expect(raw).not.toContain("1234");
    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 1, providers: [provider] }),
      "utf8",
    );
    expect(await cache.load()).toEqual([]);
  });

  it("replaces the cache with the latest complete snapshot", async () => {
    const { cache, filePath } = await createCache();
    await Promise.all([
      cache.save(appSnapshot(freshProvider(31))),
      cache.save(appSnapshot(freshProvider(48))),
    ]);

    expect(await readFile(filePath, "utf8")).toContain('"usedPercent":48');
  });

  it("discards corrupt and unsupported cache files", async () => {
    const { cache, filePath } = await createCache();
    await writeFile(filePath, "{not-json", "utf8");
    expect(await cache.load()).toEqual([]);

    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 0, providers: [] }),
      "utf8",
    );
    expect(await cache.load()).toEqual([]);
  });

  it("merges cached providers without inventing missing providers", () => {
    const codex = freshProvider();
    const claude: ProviderSnapshot = {
      providerId: "claude",
      status: "unavailable",
      fetchedAt: "2026-09-01T03:00:00.000Z",
      quotaWindows: [],
    };
    expect(mergeCachedSnapshots([codex, claude], [codex])).toEqual([
      codex,
      claude,
    ]);
  });
});
