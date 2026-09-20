import { describe, expect, it } from "vitest";
import { runClaudeUsageProbe } from "../../src/providers/index";

describe("Claude read-only PTY feasibility", () => {
  it(
    "renders usage windows without sending a model prompt",
    async () => {
      const result = await runClaudeUsageProbe();
      const diagnostic = JSON.stringify({
        status: result.status,
        gracefulExit: result.gracefulExit,
        sentUsageCommand: result.sentUsageCommand,
        sentModelPrompt: result.sentModelPrompt,
        hasFiveHourWindow: result.hasFiveHourWindow,
        hasWeeklyWindow: result.hasWeeklyWindow,
        parsedKinds: result.quotaWindows.map(({ kind }) => kind),
      });

      expect(result.sentModelPrompt, diagnostic).toBe(false);
      expect(result.sentUsageCommand, diagnostic).toBe(true);
      expect(result.status, diagnostic).toBe("supported");
      expect(result.hasFiveHourWindow).toBe(true);
      expect(result.hasWeeklyWindow).toBe(true);
      expect(result.hasQuotaDetails).toBe(true);
      expect(result.gracefulExit).toBe(true);
      expect(result.quotaWindows.some(({ kind }) => kind === "five_hour")).toBe(true);
      expect(result.quotaWindows.some(({ kind }) => kind === "weekly")).toBe(true);
      expect(result.quotaWindows.every(({ usedPercent }) => usedPercent >= 0 && usedPercent <= 100)).toBe(true);
      expect(
        result.quotaWindows
          .filter(({ kind }) => kind === "five_hour" || kind === "weekly")
          .every(({ resetsAt }) => resetsAt !== undefined),
      ).toBe(true);
    },
    30_000,
  );
});
