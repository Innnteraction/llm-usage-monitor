import { describe, expect, it } from "vitest";
import { parseClaudeUsageScreen } from "../../src/providers/index";

const now = new Date("2026-09-01T03:00:00.000Z");

describe("Claude usage parser", () => {
  it("parses required and model-scoped windows", () => {
    const windows = parseClaudeUsageScreen(
      [
        "Current session",
        "23% used",
        "Resets in 2 hr 30 min",
        "Current week (all models)",
        "41% used",
        "Resets in 3 days",
        "Current week (Example model)",
        "60% remaining",
        "Resets in 4 days",
      ].join("\n"),
      now,
    );

    expect(windows).toEqual([
      { kind: "five_hour", label: "5h", usedPercent: 23, resetsAt: "2026-09-01T05:30:00.000Z" },
      { kind: "weekly", label: "Weekly", usedPercent: 41, resetsAt: "2026-09-04T03:00:00.000Z" },
      { kind: "model_weekly", label: "Example model Weekly", usedPercent: 40, resetsAt: "2026-09-05T03:00:00.000Z" },
    ]);
  });

  it("does not invent a window without a percentage", () => {
    expect(parseClaudeUsageScreen("Current session\nNot available", now)).toEqual([]);
  });

  it("parses the CLI time-only reset form without retaining its timezone label", () => {
    const windows = parseClaudeUsageScreen(
      "Current session\n23% used\nResets 11:40pm (Asia/Seoul)",
      now,
    );

    expect(windows[0]?.resetsAt).toBeDefined();
    expect(JSON.stringify(windows)).not.toContain("Asia/Seoul");
  });

  it("parses a dated reset whose AM/PM time omits minutes", () => {
    const windows = parseClaudeUsageScreen(
      "Current week (all models)\n41% used\nResets Sep 5, 5pm (Asia/Seoul)",
      now,
    );

    const reset = new Date(windows[0]?.resetsAt ?? Number.NaN);
    expect(reset.getFullYear()).toBe(2026);
    expect(reset.getMonth()).toBe(8);
    expect(reset.getDate()).toBe(5);
    expect(reset.getHours()).toBe(17);
  });

  it("rolls a yearless dated reset into the next year only after it has passed", () => {
    const yearEnd = new Date(2026, 11, 31, 12);
    const windows = parseClaudeUsageScreen(
      "Current week (all models)\n41% used\nResets Jan 2, 5pm (Asia/Seoul)",
      yearEnd,
    );

    const reset = new Date(windows[0]?.resetsAt ?? Number.NaN);
    expect(reset.getFullYear()).toBe(2027);
    expect(reset.getMonth()).toBe(0);
    expect(reset.getDate()).toBe(2);
    expect(reset.getHours()).toBe(17);
  });

  it("collapses redraw frames and keeps the frame with reset metadata", () => {
    const windows = parseClaudeUsageScreen(
      [
        "Current session",
        "23% used",
        "Current session",
        "23% used",
        "Resets in 2 hr",
      ].join("\n"),
      now,
    );

    expect(windows).toEqual([
      { kind: "five_hour", label: "5h", usedPercent: 23, resetsAt: "2026-09-01T05:00:00.000Z" },
    ]);
  });
});
