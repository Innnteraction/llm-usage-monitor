import { describe, expect, it } from "vitest";
import {
  AntigravityUsageParseError,
  parseAntigravityUsage,
} from "../../src/providers/antigravity/index";

const usage = (groups: unknown[] = []) =>
  JSON.stringify({
    status: " SUCCESS ",
    num_turns: 0,
    command: { name: " /USAGE ", data: { groups } },
    ignored_private_field: "ignored",
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
