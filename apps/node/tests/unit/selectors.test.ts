import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../../src/shared/index";
import {
  formatLocalTokens,
  hasFableWindow,
  missingCoreLabels,
  providerStatusTone,
  selectAdditionalWindows,
  selectDisplayWindows,
  sourceNames,
  usageTone,
} from "../../src/renderer/index";

describe("renderer selectors", () => {
  it("provides user-friendly source names including Antigravity CLI, IDE", () => {
    expect(sourceNames.antigravity_cli).toBe("Antigravity CLI, IDE");
    expect(sourceNames.claude_cli).toBe("Claude CLI");
    expect(sourceNames.codex_app_server).toBe("Codex App Server");
  });

  it("determines usage tone correctly", () => {
    expect(usageTone(undefined)).toBe("low");
    expect(usageTone(50)).toBe("low");
    expect(usageTone(70)).toBe("medium");
    expect(usageTone(89)).toBe("medium");
    expect(usageTone(90)).toBe("high");
    expect(usageTone(100)).toBe("high");
    expect(usageTone(50, "fresh")).toBe("low");
    expect(usageTone(95, "stale")).toBe("stale");
    expect(usageTone(undefined, "stale")).toBe("stale");
  });

  it("determines provider status tone accurately", () => {
    const baseProvider: ProviderSnapshot = {
      providerId: "antigravity",
      status: "fresh",
      fetchedAt: new Date(1_000_000).toISOString(),
      quotaWindows: [],
    };

    expect(providerStatusTone(baseProvider)).toBe("fresh");
    expect(providerStatusTone({ ...baseProvider, status: "unavailable" })).toBe(
      "unavailable",
    );

    const staleRecent: ProviderSnapshot = {
      ...baseProvider,
      status: "stale",
      fetchedAt: new Date(1_000_000).toISOString(),
      lastSuccessfulAt: new Date(1_000_000).toISOString(),
    };
    // Within 30 minutes (10 minutes elapsed)
    expect(
      providerStatusTone(staleRecent, 1_000_000 + 10 * 60 * 1000),
    ).toBe("stale");
    // Exactly at 30 minutes (not exceeded)
    expect(
      providerStatusTone(staleRecent, 1_000_000 + 30 * 60 * 1000),
    ).toBe("stale");
    // Exceeded 30 minutes (31 minutes elapsed) -> unavailable (red)
    expect(
      providerStatusTone(staleRecent, 1_000_000 + 31 * 60 * 1000),
    ).toBe("unavailable");

    // Falls back to fetchedAt if lastSuccessfulAt is not provided
    const staleWithoutLastSuccess: ProviderSnapshot = {
      ...baseProvider,
      status: "stale",
      fetchedAt: new Date(1_000_000).toISOString(),
    };
    expect(
      providerStatusTone(staleWithoutLastSuccess, 1_000_000 + 15 * 60 * 1000),
    ).toBe("stale");
    expect(
      providerStatusTone(staleWithoutLastSuccess, 1_000_000 + 35 * 60 * 1000),
    ).toBe("unavailable");
  });

  it("formats token abbreviations accurately", () => {
    expect(formatLocalTokens(500)).toBe("500");
    expect(formatLocalTokens(1_200)).toBe("1K");
    expect(formatLocalTokens(15_400)).toBe("15K");
    expect(formatLocalTokens(1_500_000)).toBe("1.5M");
    expect(formatLocalTokens(2_300_000_000)).toBe("2.3B");
  });

  it("selects display windows for Codex", () => {
    const codexProvider: ProviderSnapshot = {
      providerId: "codex",
      status: "fresh",
      fetchedAt: new Date().toISOString(),
      quotaWindows: [
        {
          id: "codex-weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 20,
          source: "codex_app_server",
          status: "fresh",
        },
        {
          id: "codex-spark-5h",
          kind: "five_hour",
          label: "Spark 5h",
          usedPercent: 10,
          source: "codex_app_server",
          status: "fresh",
        },
      ],
    };

    const windows = selectDisplayWindows(codexProvider);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.kind).toBe("weekly");

    const additional = selectAdditionalWindows(codexProvider, windows);
    expect(additional).toHaveLength(0); // 5h not a model_weekly or codex-limit
  });

  it("detects Fable window for Claude", () => {
    const claudeWithFable: ProviderSnapshot = {
      providerId: "claude",
      status: "fresh",
      fetchedAt: new Date().toISOString(),
      quotaWindows: [
        {
          id: "claude-5h",
          kind: "five_hour",
          label: "5h Limit",
          usedPercent: 40,
          source: "claude_cli",
          status: "fresh",
        },
        {
          id: "claude-fable",
          kind: "model_weekly",
          label: "Fable Weekly",
          usedPercent: 60,
          source: "claude_cli",
          status: "fresh",
        },
      ],
    };

    expect(hasFableWindow(claudeWithFable)).toBe(true);
    const missing = missingCoreLabels(claudeWithFable);
    expect(missing).toContain("7d");
  });
});
