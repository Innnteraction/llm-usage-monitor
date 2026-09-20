import { describe, expect, it } from "vitest";
import { CodexQuotaProvider } from "../../src/providers/index";

describe("Codex read-only smoke", () => {
  it(
    "reads the current CLI account quota without logging values",
    async () => {
      const snapshot = await new CodexQuotaProvider().fetchQuota();
      if (snapshot.status !== "fresh") {
        throw new Error(
          `Codex smoke failed with sanitized code: ${snapshot.error?.code ?? "unavailable"}`,
        );
      }

      const kinds = snapshot.quotaWindows.map(({ kind }) => kind);
      expect(kinds).toContain("five_hour");
      expect(kinds).toContain("weekly");
      console.info(
        `Codex read-only smoke passed for window kinds: ${[
          ...new Set(kinds),
        ].join(", ")}`,
      );
    },
    30_000,
  );
});
