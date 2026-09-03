import { describe, expect, it } from "vitest";
import { AntigravityQuotaProvider } from "../../src/providers/antigravity/index";

describe("Antigravity CLI smoke", () => {
  it("reads a supported quota response when explicitly run", async () => {
    const provider = new AntigravityQuotaProvider();
    try {
      const snapshot = await provider.fetchQuota();
      expect(snapshot.status === "fresh", "Antigravity quota smoke failed").toBe(true);
      expect(snapshot.quotaWindows.length > 0, "Antigravity quota smoke returned no quota windows").toBe(true);
      expect(snapshot.quotaWindows.every((window) =>
        typeof window.usedPercent === "number" &&
        Number.isFinite(window.usedPercent) &&
        window.usedPercent >= 0 &&
        window.usedPercent <= 100 &&
        window.source === "antigravity_cli" &&
        typeof window.resetsAt === "string" &&
        Number.isFinite(Date.parse(window.resetsAt)),
      ), "Antigravity quota smoke returned invalid windows").toBe(true);
      expect(snapshot.quotaWindows.some(({ kind }) => kind === "five_hour"), "Antigravity quota smoke omitted 5h quota").toBe(true);
      expect(snapshot.quotaWindows.some(({ kind }) => kind === "model_weekly"), "Antigravity quota smoke omitted weekly quota").toBe(true);
    } finally {
      await provider.close();
    }
  }, 35_000);
});
