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

  it("schedules next poll with incident interval (5m) when any provider has degraded status", async () => {
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

    // 이상 징후 발생 시 5분 간격이어야 하므로, 5분 경과 시 다시 실행되어야 함
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_INCIDENT_INTERVAL_MS);
    expect(mockFetcher).toHaveBeenCalledTimes(4);

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
