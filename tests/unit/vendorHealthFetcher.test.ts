import { describe, expect, it, vi } from "vitest";
import {
  fetchAntigravityStatus,
  fetchClaudeStatus,
  fetchCodexStatus,
  fetchVendorServiceStatus,
} from "../../src/usage/vendorHealthFetcher";

describe("vendorHealthFetcher", () => {
  const mockClock = () => new Date("2026-09-17T10:00:00.000Z");

  describe("fetchClaudeStatus", () => {
    it("parses operational status correctly when all systems and components are normal", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { indicator: "none", description: "All Systems Operational" },
          components: [
            { name: "Claude API (api.anthropic.com)", status: "operational" },
            { name: "Claude Code", status: "operational" },
          ],
          incidents: [],
        }),
      });

      const result = await fetchClaudeStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result).toEqual({
        indicator: "operational",
        description: "All Systems Operational",
        statusPageUrl: "https://status.claude.com",
        incidentTitle: undefined,
        checkedAt: "2026-09-17T10:00:00.000Z",
      });
    });

    it("detects component degradation even if overall status is none", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { indicator: "none", description: "All Systems Operational" },
          components: [
            { name: "Claude Code", status: "degraded_performance" },
          ],
          incidents: [{ name: "Elevated error rates on Claude Code", status: "investigating" }],
        }),
      });

      const result = await fetchClaudeStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("minor");
      expect(result.incidentTitle).toBe("Elevated error rates on Claude Code");
    });

    it("falls back to unknown when network fails", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection failed"));

      const result = await fetchClaudeStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("unknown");
      expect(result.statusPageUrl).toBe("https://status.claude.com");
    });
  });

  describe("fetchCodexStatus", () => {
    it("parses operational status correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { indicator: "none", description: "All Systems Operational" },
          components: [{ name: "Codex API", status: "operational" }],
          incidents: [],
        }),
      });

      const result = await fetchCodexStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result).toEqual({
        indicator: "operational",
        description: "All Systems Operational",
        statusPageUrl: "https://status.openai.com",
        incidentTitle: undefined,
        checkedAt: "2026-09-17T10:00:00.000Z",
      });
    });

    it("detects major outage in Codex components", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { indicator: "minor", description: "Minor Service Outage" },
          components: [{ name: "Codex API", status: "major_outage" }],
          incidents: [{ name: "Codex API Outage", status: "identified" }],
        }),
      });

      const result = await fetchCodexStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("critical");
      expect(result.incidentTitle).toBe("Codex API Outage");
    });

    it("handles non-200 responses safely", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await fetchCodexStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("unknown");
    });
  });

  describe("fetchAntigravityStatus", () => {
    it("returns operational when no active Google Cloud AI incidents exist", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { service_name: "Google Compute Engine", external_desc: "Network issue", end: "2026-09-16T12:00:00Z" },
        ],
      });

      const result = await fetchAntigravityStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("operational");
      expect(result.statusPageUrl).toBe("https://status.cloud.google.com");
    });

    it("detects active Gemini/Vertex incident", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { service_name: "Vertex AI", external_desc: "Gemini API latency elevation", severity: "medium" },
        ],
      });

      const result = await fetchAntigravityStatus(undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.indicator).toBe("minor");
      expect(result.incidentTitle).toBe("Gemini API latency elevation");
    });
  });

  describe("fetchVendorServiceStatus dispatcher", () => {
    it("routes providerId correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { indicator: "none", description: "All Systems Operational" },
          components: [],
          incidents: [],
        }),
      });

      const result = await fetchVendorServiceStatus("claude", undefined, {
        fetchFn: mockFetch as unknown as typeof fetch,
        clock: mockClock,
      });

      expect(result.statusPageUrl).toBe("https://status.claude.com");
    });
  });

  describe("incident simulation mode", () => {
    it("returns simulated incident for target provider", async () => {
      const originalEnv = process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT;
      try {
        process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT = "claude";

        const claudeResult = await fetchClaudeStatus(undefined, { clock: mockClock });
        expect(claudeResult.indicator).toBe("minor");
        expect(claudeResult.incidentTitle).toContain("Simulated");

        const codexResult = await fetchCodexStatus(undefined, {
          fetchFn: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: { indicator: "none" }, components: [], incidents: [] }),
          }) as unknown as typeof fetch,
          clock: mockClock,
        });
        expect(codexResult.indicator).toBe("operational");
      } finally {
        process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT = originalEnv;
      }
    });

    it("simulates all providers when incident is all", async () => {
      const originalEnv = process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT;
      try {
        process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT = "all";

        const codexResult = await fetchCodexStatus(undefined, { clock: mockClock });
        expect(codexResult.indicator).toBe("major");

        const antigravityResult = await fetchAntigravityStatus(undefined, { clock: mockClock });
        expect(antigravityResult.indicator).toBe("critical");
      } finally {
        process.env.LLM_USAGE_MONITOR_MOCK_INCIDENT = originalEnv;
      }
    });
  });
});
