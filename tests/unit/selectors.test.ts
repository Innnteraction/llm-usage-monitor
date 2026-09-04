import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../../src/shared/index";
import {
  formatLocalTokens,
  hasFableWindow,
  missingCoreLabels,
  selectAdditionalWindows,
  selectDisplayWindows,
  usageTone,
} from "../../src/renderer/selectors";

describe("renderer selectors", () => {
  it("determines usage tone correctly", () => {
    expect(usageTone(undefined)).toBe("low");
    expect(usageTone(50)).toBe("low");
    expect(usageTone(70)).toBe("medium");
    expect(usageTone(89)).toBe("medium");
    expect(usageTone(90)).toBe("high");
    expect(usageTone(100)).toBe("high");
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
