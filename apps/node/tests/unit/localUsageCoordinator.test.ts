import { describe, expect, it, vi } from "vitest";
import type {
  LocalTokenUsage,
  LocalUsageScanner,
} from "../../src/shared/index";
import {
  createLocalUsageCoordinator,
  LOCAL_USAGE_DEBOUNCE_MS,
  LOCAL_USAGE_RECONCILE_MS,
} from "../../src/usage/index";

const usage = (provider = "codex"): LocalTokenUsage => ({
  scope: "local_device",
  scannedFileCount: 1,
  failedFileCount: 0,
  inputTokens: provider === "codex" ? 10 : 20,
  outputTokens: 3,
  totalTokens: provider === "codex" ? 13 : 23,
  partial: false,
  calculatedAt: "2026-09-01T00:00:00.000Z",
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("LocalUsageCoordinator", () => {
  it("starts scanners in parallel and queues only one follow-up", async () => {
    vi.useFakeTimers();
    const codexFirst = deferred<LocalTokenUsage>();
    const codexScan = vi
      .fn()
      .mockReturnValueOnce(codexFirst.promise)
      .mockResolvedValue(usage());
    const claudeScan = vi.fn().mockResolvedValue(usage("claude"));
    let dirty!: () => void;
    const scanners: LocalUsageScanner[] = [
      {
        providerId: "codex",
        scan: codexScan,
        watch: (listener) => {
          dirty = listener;
          return () => undefined;
        },
      },
      { providerId: "claude", scan: claudeScan, watch: () => () => undefined },
    ];
    const updateLocalUsage = vi.fn();
    const coordinator = createLocalUsageCoordinator({
      scanners,
      store: { updateLocalUsage },
    });
    const started = coordinator.start();
    expect(codexScan).toHaveBeenCalledTimes(1);
    expect(claudeScan).toHaveBeenCalledTimes(1);
    dirty();
    dirty();
    await vi.advanceTimersByTimeAsync(LOCAL_USAGE_DEBOUNCE_MS);
    codexFirst.resolve(usage());
    await started;
    expect(codexScan).toHaveBeenCalledTimes(2);
    await coordinator.stop();
    vi.useRealTimers();
  });

  it("reconciles without a watcher after the initial scan completes", async () => {
    vi.useFakeTimers();
    const scan = vi.fn().mockResolvedValue(usage());
    const coordinator = createLocalUsageCoordinator({
      scanners: [{ providerId: "codex", scan, watch: () => () => undefined }],
      store: { updateLocalUsage: vi.fn() },
    });
    await coordinator.start();
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LOCAL_USAGE_RECONCILE_MS);
    expect(scan).toHaveBeenCalledTimes(2);
    await coordinator.stop();
    vi.useRealTimers();
  });

  it("shares stop cleanup while aborting an active scan", async () => {
    const aborted = vi.fn();
    const scan = vi.fn(
      (signal: AbortSignal) =>
        new Promise<LocalTokenUsage>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted();
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const coordinator = createLocalUsageCoordinator({
      scanners: [{ providerId: "codex", scan, watch: () => () => undefined }],
      store: { updateLocalUsage: vi.fn() },
    });
    void coordinator.start();
    const firstStop = coordinator.stop();
    const secondStop = coordinator.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("isolates watch and scan failures from the other provider", async () => {
    const updateLocalUsage = vi.fn();
    const coordinator = createLocalUsageCoordinator({
      scanners: [
        {
          providerId: "codex",
          scan: vi.fn().mockRejectedValue(new Error("scan failed")),
          watch: () => {
            throw new Error("watch failed");
          },
        },
        {
          providerId: "claude",
          scan: vi.fn().mockResolvedValue(usage("claude")),
          watch: () => () => undefined,
        },
      ],
      store: { updateLocalUsage },
    });
    await coordinator.start();
    expect(updateLocalUsage).toHaveBeenCalledWith("claude", usage("claude"));
    await coordinator.stop();
  });
});
