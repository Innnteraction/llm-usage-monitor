import { describe, expect, it } from "vitest";
import {
  AntigravityUsageParseError,
  extractAccountFromLog,
  parseAntigravityUsage,
  parseAntigravityUsageReport,
} from "../../src/providers/antigravity/index";

const usage = (
  groups: unknown[] = [],
  extra: { commandData?: Record<string, unknown>; root?: Record<string, unknown> } = {},
) =>
  JSON.stringify({
    status: " SUCCESS ",
    num_turns: 0,
    command: { name: " /USAGE ", data: { groups, ...(extra.commandData ?? {}) } },
    ignored_private_field: "ignored",
    ...(extra.root ?? {}),
  });

const group = (name: string, buckets: unknown[]) => ({ name, buckets });
const bucket = (window: string, remaining_fraction?: number | null, reset_time?: string | null) => ({ window, ...(remaining_fraction === undefined ? {} : { remaining_fraction }), ...(reset_time === undefined ? {} : { reset_time }), ignored: "private" });

describe("Antigravity usage parser", () => {
  it("maps the four supported windows without copying vendor-only fields", () => {
    const windows = parseAntigravityUsage(usage([
      group(" Gemini Models ", [bucket("weekly", 0.75, "2026-09-02T00:00:00Z"), bucket("5h", 0.2)]),
      group("Claude and GPT Models", [bucket("weekly", 0), bucket("5h", 1)]),
    ]));
    expect(windows).toEqual([
      { id: "agy-gemini-weekly", kind: "model_weekly", label: "Gemini Weekly", usedPercent: 25, resetsAt: "2026-09-02T00:00:00Z", source: "antigravity_cli", status: "fresh" },
      { id: "agy-gemini-5h", kind: "five_hour", label: "Gemini 5h", usedPercent: 80, source: "antigravity_cli", status: "fresh" },
      { id: "agy-claude-gpt-weekly", kind: "model_weekly", label: "Claude/GPT Weekly", usedPercent: 100, source: "antigravity_cli", status: "fresh" },
      { id: "agy-claude-gpt-5h", kind: "five_hour", label: "Claude/GPT 5h", usedPercent: 0, source: "antigravity_cli", status: "fresh" },
    ]);
    expect(JSON.stringify(windows)).not.toContain("private");
  });

  it("extracts accountLabel from command.data.email, user, or root fields", () => {
    const fromCommandEmail = parseAntigravityUsageReport(
      usage([], { commandData: { email: "developer@example.com" } }),
    );
    expect(fromCommandEmail.accountLabel).toBe("developer@example.com");

    const fromCommandUserObj = parseAntigravityUsageReport(
      usage([], { commandData: { user: { email: "user@example.com" } } }),
    );
    expect(fromCommandUserObj.accountLabel).toBe("user@example.com");

    const fromRootEmail = parseAntigravityUsageReport(
      usage([], { root: { email: "root@example.com" } }),
    );
    expect(fromRootEmail.accountLabel).toBe("root@example.com");

    const longEmail = "a".repeat(100) + "@example.com";
    const truncated = parseAntigravityUsageReport(
      usage([], { commandData: { email: longEmail } }),
    );
    expect(truncated.accountLabel).toHaveLength(80);

    const noAccount = parseAntigravityUsageReport(usage([]));
    expect(noAccount.accountLabel).toBeUndefined();
  });

  it("extracts account email from CLI log content", () => {
    const log1 = "server_oauth.go:192] applyAuthResult: email=engineer@example.com, authMethod=consumer";
    expect(extractAccountFromLog(log1)).toBe("engineer@example.com");

    const log2 = "server_oauth.go:197] OAuth: authenticated successfully as dev-team@company.org";
    expect(extractAccountFromLog(log2)).toBe("dev-team@company.org");

    const logMulti = `${log1}\nsome intermediate log\nserver_oauth.go:192] applyAuthResult: email=latest@example.com, authMethod=consumer`;
    expect(extractAccountFromLog(logMulti)).toBe("latest@example.com");

    expect(extractAccountFromLog("plain log without auth")).toBeUndefined();
  });

  it("keeps empty groups valid and marks missing vendor quota unavailable", () => {
    expect(parseAntigravityUsage(usage())).toEqual([]);
    expect(parseAntigravityUsage(usage([group("Gemini Models", [bucket("weekly", null, null)])]))[0]).toMatchObject({ status: "unavailable" });
  });

  it.each([
    usage([group("Unknown", [])]),
    usage([group("Gemini Models", [bucket("monthly", 0.5)])]),
    usage([group("Gemini Models", [bucket("weekly", 1.1)])]),
    usage([group("Gemini Models", [bucket("weekly", 0.5, "not-a-date")])]),
    usage([group("Gemini Models", [bucket("weekly", 0.5), bucket("weekly", 0.5)])]),
    JSON.stringify({ status: "success", num_turns: 1, command: { name: "usage", data: { groups: [] } } }),
  ])("rejects unsupported contracts", (raw) => {
    expect(() => parseAntigravityUsage(raw)).toThrow(AntigravityUsageParseError);
  });
});
