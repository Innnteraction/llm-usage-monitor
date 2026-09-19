import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import {
  ClaudeQuotaProvider,
  CodexQuotaProvider,
  AntigravityQuotaProvider,
  createClaudeInitialSnapshot,
  createCodexInitialSnapshot,
  createAntigravityInitialSnapshot,
} from "../providers/index";
import type { AppSnapshot, ProviderId } from "../shared/index";
import {
  createLocalUsageCoordinator,
  createUsagePoller,
  createUsageStore,
  createVendorHealthPoller,
  type QuotaProvider,
  type VendorHealthPoller,
} from "../usage/index";
import {
  ClaudeLocalUsageScanner,
  CodexLocalUsageScanner,
  LocalUsageCheckpointStore,
  rootKey,
} from "../local-usage/index";
import {
  mergeCachedSnapshots,
  SNAPSHOT_CACHE_FILENAME,
  SnapshotCache,
  sharedCacheDirectory,
} from "../main/snapshotCache";
import { createFakeUsageStore } from "../main/fakeUsage";

export const CLAUDE_SETUP_READY_MARKER = "claude-setup-ready-v1";

export interface UsageMonitorCoreOptions {
  userDataDir: string;
  providers?: QuotaProvider[];
  useFakeProviders?: boolean;
  clock?: () => Date;
  sharedDataDir?: string;
}

export class UsageMonitorCore {
  public readonly userDataDir: string;
  public readonly providers: QuotaProvider[];
  public readonly useFakeProviders: boolean;

  private readonly clock: () => Date;
  private readonly store: ReturnType<typeof createUsageStore>;
  private readonly poller?: ReturnType<typeof createUsagePoller>;
  private readonly localUsageCoordinator?: ReturnType<typeof createLocalUsageCoordinator>;
  private readonly vendorHealthPoller?: VendorHealthPoller;
  private readonly snapshotCache?: SnapshotCache;
  private readonly pendingBackground = new Set<Promise<unknown>>();
  private readonly markerPath: string;

  private unsubscribeCache?: () => void;
  private unsubscribeSetup?: () => void;
  private setupReadyWritten = false;
  private isStarted = false;
  private isStopped = false;

  private constructor(
    options: UsageMonitorCoreOptions,
    store: ReturnType<typeof createUsageStore>,
    providers: QuotaProvider[],
    poller?: ReturnType<typeof createUsagePoller>,
    localUsageCoordinator?: ReturnType<typeof createLocalUsageCoordinator>,
    vendorHealthPoller?: VendorHealthPoller,
    snapshotCache?: SnapshotCache,
    setupWasReady = false,
  ) {
    this.userDataDir = options.userDataDir;
    this.providers = providers;
    this.useFakeProviders = options.useFakeProviders ?? false;
    this.clock = options.clock ?? (() => new Date());
    this.store = store;
    this.poller = poller;
    this.localUsageCoordinator = localUsageCoordinator;
    this.vendorHealthPoller = vendorHealthPoller;
    this.snapshotCache = snapshotCache;
    this.markerPath = path.join(this.userDataDir, CLAUDE_SETUP_READY_MARKER);
    this.setupReadyWritten = setupWasReady;

    this.initSubscriptions();
  }

  public static async create(options: UsageMonitorCoreOptions): Promise<UsageMonitorCore> {
    const useFake = options.useFakeProviders ?? false;
    const initialTime = options.clock ? options.clock() : new Date();

    const antigravityProvider = new AntigravityQuotaProvider();
    const providers = options.providers ?? [
      new CodexQuotaProvider(),
      new ClaudeQuotaProvider(),
      antigravityProvider,
    ];

    const defaultSnapshots = [
      createCodexInitialSnapshot(initialTime),
      createClaudeInitialSnapshot(initialTime),
      createAntigravityInitialSnapshot(initialTime),
    ];

    const snapshotCache = useFake
      ? undefined
      : new SnapshotCache(
          path.join(options.sharedDataDir ?? sharedCacheDirectory(), SNAPSHOT_CACHE_FILENAME),
          path.join(options.userDataDir, "usage-snapshot-v1.json"),
        );

    const cachedSnapshots = (await snapshotCache?.load()) ?? [];

    const store = useFake
      ? createFakeUsageStore()
      : createUsageStore({
          providers,
          initialSnapshots: mergeCachedSnapshots(
            defaultSnapshots,
            cachedSnapshots,
          ),
          clock: options.clock,
        });

    const poller = useFake
      ? undefined
      : createUsagePoller({
          store,
          providerIds: providers.map(({ id }) => id),
          clock: options.clock,
        });

    const checkpointStore = useFake
      ? undefined
      : new LocalUsageCheckpointStore(
          path.join(options.sharedDataDir ?? sharedCacheDirectory(), "local-usage-index-v2.json"),
        );

    if (checkpointStore) {
      void checkpointStore.load().then(async cached => {
        for (const id of ["codex", "claude"] as const) {
          const root = id === "codex" ? path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "sessions") : path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "projects");
          const section=cached.providers[id];
          if (section.summary && section.rootKey === await rootKey(root) && !store.getState().providers.find(p=>p.providerId===id)?.localUsage) store.updateLocalUsage(id, section.summary);
        }
      }).catch(() => undefined);
    }
    const localUsageCoordinator = useFake
      ? undefined
      : createLocalUsageCoordinator({
          store,
          onProgress: (id, active) => store.setTaskRefreshing("local", id, active),
          scanners: [
            new CodexLocalUsageScanner({ checkpointStore: checkpointStore! }),
            new ClaudeLocalUsageScanner({ checkpointStore: checkpointStore! }),
          ],
        });

    const vendorHealthPoller = useFake
      ? undefined
      : createVendorHealthPoller({
          onProgress: (id, active) => store.setTaskRefreshing("health", id, active),
          providerIds: providers.map(({ id }) => id),
          onUpdate: (providerId, status) => {
            store.updateVendorServiceStatus(providerId, status);
          },
          clock: options.clock,
        });

    const markerPath = path.join(options.userDataDir, CLAUDE_SETUP_READY_MARKER);
    const setupWasReady = await UsageMonitorCore.checkPathExists(markerPath);

    return new UsageMonitorCore(
      options,
      store,
      providers,
      poller,
      localUsageCoordinator,
      vendorHealthPoller,
      snapshotCache,
      setupWasReady,
    );
  }

  private static async checkPathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private static async markFileReady(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "ready\n", { encoding: "utf8", flag: "w" });
  }

  private initSubscriptions(): void {
    if (this.snapshotCache) {
      this.unsubscribeCache = this.store.subscribe((state) => {
        void this.snapshotCache?.save(state);
      });
    }

    this.unsubscribeSetup = this.store.subscribe((state) => {
      if (
        !this.setupReadyWritten &&
        state.providers.some(
          ({ providerId, status }) =>
            providerId === "claude" && status === "fresh",
        )
      ) {
        this.setupReadyWritten = true;
        void this.trackBackground(
          UsageMonitorCore.markFileReady(this.markerPath).catch(() => {
            this.setupReadyWritten = false;
          }),
        );
      }
    });
  }

  public trackBackground<T>(operation: Promise<T>): Promise<T> {
    this.pendingBackground.add(operation);
    void operation.then(
      () => this.pendingBackground.delete(operation),
      () => this.pendingBackground.delete(operation),
    );
    return operation;
  }

  public async start(): Promise<void> {
    if (this.isStarted || this.isStopped) return;
    this.isStarted = true;
    await Promise.all([
      this.poller?.start(),
      this.localUsageCoordinator?.start(),
      this.vendorHealthPoller?.start(),
    ]).catch(() => undefined);
  }

  public refresh(providerId?: ProviderId): Promise<void> {
    if (this.isStopped) return Promise.resolve();
    return this.trackBackground(
      Promise.all([
        this.poller?.refresh(providerId) ?? this.store.refresh(providerId),
        this.localUsageCoordinator?.refresh(providerId),
        this.vendorHealthPoller?.refresh(providerId),
      ]).then(() => undefined),
    );
  }

  public getState(): AppSnapshot {
    return this.store.getState();
  }

  public subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    return this.store.subscribe(listener);
  }

  public async isClaudeSetupReady(): Promise<boolean> {
    return UsageMonitorCore.checkPathExists(this.markerPath);
  }

  public async stop(): Promise<void> {
    if (this.isStopped) return;
    this.isStopped = true;

    this.unsubscribeCache?.();
    this.unsubscribeSetup?.();

    const closePromises: Promise<unknown>[] = [
      ...this.pendingBackground,
    ];
    if (this.poller) {
      closePromises.push(this.poller.stop());
    }
    if (this.localUsageCoordinator) {
      closePromises.push(this.localUsageCoordinator.stop());
    }
    if (this.vendorHealthPoller) {
      closePromises.push(this.vendorHealthPoller.stop());
    }

    for (const provider of this.providers) {
      if (typeof provider.dispose === "function") {
        closePromises.push(provider.dispose());
      } else if ("close" in provider && typeof (provider as { close: () => Promise<void> }).close === "function") {
        closePromises.push((provider as { close: () => Promise<void> }).close());
      }
    }

    try {
      await Promise.allSettled(closePromises);
    } finally {
      try {
        await this.snapshotCache?.save(this.store.getState());
        await this.snapshotCache?.flush();
      } catch {
        // flush 실패가 다른 리소스 정리를 방해하지 않음
      }
    }
  }
}
