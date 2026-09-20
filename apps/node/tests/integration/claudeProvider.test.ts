import { describe, expect, it } from "vitest";
import { ClaudeQuotaProvider, createClaudeInitialSnapshot, type ClaudePtyProbeResult } from "../../src/providers/index";
import { createUsageStore } from "../../src/usage/index";

const clock = () => new Date("2026-09-01T03:00:00Z");

describe("Claude provider integration", () => {
  it("flows a sanitized PTY result through the usage store", async () => {
    const result: ClaudePtyProbeResult = {
      status: "supported", gracefulExit: true, sentUsageCommand: true, sentModelPrompt: false,
      hasFiveHourWindow: true, hasWeeklyWindow: true, hasQuotaDetails: true,
      requiresLogin: false, hasTrustPrompt: false,
      quotaWindows: [
        { kind: "five_hour", label: "5h", usedPercent: 18 },
        { kind: "weekly", label: "Weekly", usedPercent: 29 },
      ],
    };
    const store = createUsageStore({
      providers: [
        new ClaudeQuotaProvider({
          probe: async () => result,
          accountReader: async () => ({
            accountLabel: "claude.user@example.invalid",
            authKind: "subscription",
          }),
          clock,
        }),
      ],
      initialSnapshots: [createClaudeInitialSnapshot(clock())],
      clock,
    });

    await store.refresh("claude");

    expect(store.getState().providers[0]).toMatchObject({
      providerId: "claude",
      accountLabel: "claude.user@example.invalid",
      authKind: "subscription",
      status: "fresh",
      quotaWindows: [{ usedPercent: 18 }, { usedPercent: 29 }],
    });
  });

  it("sanitizes unexpected probe failures", async () => {
    const provider = new ClaudeQuotaProvider({
      probe: async () => {
        throw new Error("private raw output");
      },
      accountReader: async () => undefined,
      clock,
    });

    const snapshot = await provider.fetchQuota();

    expect(snapshot).toMatchObject({
      providerId: "claude",
      status: "unavailable",
      error: { code: "unexpected" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("private raw output");
  });
});
