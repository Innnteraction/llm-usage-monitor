import { describe, expect, it } from "vitest";
import { normalizeClaudeSnapshot, type ClaudePtyProbeResult } from "../../src/providers/index";

const base: ClaudePtyProbeResult = {
  status: "supported",
  gracefulExit: true,
  sentUsageCommand: true,
  sentModelPrompt: false,
  hasFiveHourWindow: true,
  hasWeeklyWindow: true,
  hasQuotaDetails: true,
  requiresLogin: false,
  hasTrustPrompt: false,
  quotaWindows: [
    { kind: "five_hour", label: "5h", usedPercent: 12 },
    { kind: "weekly", label: "Weekly", usedPercent: 34 },
  ],
};

describe("Claude quota normalization", () => {
  it("creates a fresh shared snapshot", () => {
    expect(normalizeClaudeSnapshot(base, new Date("2026-09-01T03:00:00Z"))).toMatchObject({
      providerId: "claude",
      status: "fresh",
      quotaWindows: [
        { id: "claude-five-hour", kind: "five_hour", usedPercent: 12 },
        { id: "claude-weekly", kind: "weekly", usedPercent: 34 },
      ],
    });
  });

  it("maps trust and parser failures without raw output", () => {
    const snapshot = normalizeClaudeSnapshot(
      { ...base, status: "blocked_prompt", quotaWindows: [] },
      new Date("2026-09-01T03:00:00Z"),
    );
    expect(snapshot).toMatchObject({ status: "unavailable", error: { code: "unavailable" } });
    expect(JSON.stringify(snapshot)).not.toContain("workspace output");
  });
});
