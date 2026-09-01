import { describe, expect, it } from "vitest";
import { runClaudeUsageProbe } from "../../src/providers/index";

describe("Claude read-only PTY feasibility", () => {
  it(
    "renders usage windows without sending a model prompt",
    async () => {
      const result = await runClaudeUsageProbe();
      const diagnostic = JSON.stringify(result);

      expect(result.sentModelPrompt, diagnostic).toBe(false);
      expect(result.sentUsageCommand, diagnostic).toBe(true);
      expect(result.status, diagnostic).toBe("supported");
      expect(result.hasFiveHourWindow).toBe(true);
      expect(result.hasWeeklyWindow).toBe(true);
      expect(result.hasQuotaDetails).toBe(true);
      expect(result.gracefulExit).toBe(true);
    },
    30_000,
  );
});
