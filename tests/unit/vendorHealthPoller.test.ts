import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderId, VendorServiceStatus } from "../../src/shared/index";
import {
  createVendorHealthPoller,
  HEALTH_POLL_INCIDENT_INTERVAL_MS,
  HEALTH_POLL_NORMAL_INTERVAL_MS,
} from "../../src/usage/vendorHealthPoller";

describe("VendorHealthPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls all providers on start and notifies updates", async () => {
    const updates: Array<{ providerId: ProviderId; status: VendorServiceStatus }> = [];
    const mockFetcher = vi.fn().mockImplementation(async (providerId: ProviderId) => ({
      indicator: "operational" as const,
      description: "All Systems Operational",
      statusPageUrl: `https://status.${providerId}.com`,
      checkedAt: "2026-09-17T10:00:00.000Z",
    }));

    const poller = createVendorHealthPoller({
      providerIds: ["codex", "claude"],
      onUpdate: (providerId, status) => {
        updates.push({ providerId, status });
      },
      fetcher: mockFetcher,
    });

    await poller.start();

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(2);
    expect(poller.getStatuses().get("codex")?.indicator).toBe("operational");
    expect(poller.getStatuses().get("claude")?.indicator).toBe("operational");

    await poller.stop();
  });

  it("schedules next poll with normal interval (15m) when all providers are operational", async () => {
    const mockFetcher = vi.fn().mockImplementation(async (providerId: ProviderId) => ({
      indicator: "operational" as const,
      description: "All Systems Operational",
      statusPageUrl: `https://status.${providerId}.com`,
      checkedAt: new Date().toISOString(),
    }));

    const poller = createVendorHealthPoller({
      providerIds: ["codex", "claude"],
      onUpdate: () => {},
      fetcher: mockFetcher,
      normalIntervalMs: HEALTH_POLL_NORMAL_INTERVAL_MS,
      incidentIntervalMs: HEALTH_POLL_INCIDENT_INTERVAL_MS,
    });

    await poller.start();
    expect(mockFetcher).toHaveBeenCalledTimes(2);

    // 14분 59초 경과 시 아직 폴링되지 않아야 함
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_NORMAL_INTERVAL_MS - 1000);
    expect(mockFetcher).toHaveBeenCalledTimes(2);

    // 15분 경과 시 2번째 주기 실행
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetcher).toHaveBeenCalledTimes(4);

    await poller.stop();
  });

  it("polls degraded providers after 5m without accelerating healthy providers", async () => {
    const mockFetcher = vi.fn().mockImplementation(async (providerId: ProviderId) => {
      return {
        indicator: providerId === "claude" ? ("minor" as const) : ("operational" as const),
        description: providerId === "claude" ? "Degraded performance" : "Operational",
        statusPageUrl: `https://status.${providerId}.com`,
        checkedAt: new Date().toISOString(),
      };
    });

    const poller = createVendorHealthPoller({
      providerIds: ["codex", "claude"],
      onUpdate: () => {},
      fetcher: mockFetcher,
      normalIntervalMs: HEALTH_POLL_NORMAL_INTERVAL_MS,
      incidentIntervalMs: HEALTH_POLL_INCIDENT_INTERVAL_MS,
    });

    await poller.start();
    expect(mockFetcher).toHaveBeenCalledTimes(2);

    // 장애 provider만 5분 후 다시 조회한다.
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INCIDENT_INTERVAL_MS);
    expect(mockFetcher).toHaveBeenCalledTimes(3);

    await poller.stop();
  });

  it("allows manual refresh", async () => {
    const mockFetcher = vi.fn().mockImplementation(async (providerId: ProviderId) => ({
      indicator: "operational" as const,
      description: "Operational",
      statusPageUrl: `https://status.${providerId}.com`,
      checkedAt: new Date().toISOString(),
    }));

    const poller = createVendorHealthPoller({
      providerIds: ["codex", "claude"],
      onUpdate: () => {},
      fetcher: mockFetcher,
    });

    await poller.start();
    expect(mockFetcher).toHaveBeenCalledTimes(2);

    await poller.refresh("claude");
    expect(mockFetcher).toHaveBeenCalledTimes(3);

    await poller.stop();
  });
});

it("coalesces repeated health refreshes and drains active work on stop", async () => {
  vi.useRealTimers();
  let finish!: (status: VendorServiceStatus) => void;
  const fetcher = vi.fn(() => new Promise<VendorServiceStatus>(resolve => { finish = resolve; }));
  const onUpdate = vi.fn();
  const poller = createVendorHealthPoller({providerIds:["codex"],fetcher,onUpdate});
  const first = poller.start();
  await Promise.resolve();
  const repeated = Array.from({length:10}, () => poller.refresh());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const status:VendorServiceStatus = {indicator:"operational",description:"Synthetic",statusPageUrl:"https://example.com",checkedAt:new Date().toISOString()};
  finish(status);
  await Promise.resolve(); await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const stopping = poller.stop();
  finish(status);
  await Promise.all([first,...repeated,stopping]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onUpdate).toHaveBeenCalledTimes(2);
});
