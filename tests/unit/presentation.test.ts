import { describe, expect, it } from "vitest";
import contract from "../fixtures/presentation-contract.json";
import {
  formatQuotaCountdown,
  formatCompactCountdown,
  formatCompactWindowLabel,
  formatPercent,
  formatResetAt,
  isResetPending,
  getResetElapsedPercent,
  getResetCountdownStyle,
  placeTooltip,
} from "../../src/renderer";

describe("quota presentation", () => {
  it("matches the shared Rust/Node presentation contract", () => {
    for (const row of contract.countdowns) {
      const reset = row.reset ?? undefined;
      const now = Date.parse(contract.now);
      // Electron components select pending text before calling the formatter;
      // GPUI's formatter includes that branch. Compare the displayed meaning.
      const pending = isResetPending(reset, now);
      expect(pending ? "reset pending" : formatQuotaCountdown(reset, now)).toBe(row.expanded);
      expect(pending ? "pending" : formatCompactCountdown(reset, now)).toBe(row.compact);
    }
    for (const row of contract.percentages) expect(formatPercent(row.value ?? undefined)).toBe(row.text);
  });
  it("calculates countdowns from an explicit clock", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    expect(formatQuotaCountdown("2026-09-02T01:30:00.000Z", now)).toBe(
      "1h 30m",
    );
    expect(formatQuotaCountdown("2026-09-04T03:00:00.000Z", now)).toBe(
      "2d 3h",
    );
  });

  it("formats compact countdowns with zero-padded hours and minutes", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    expect(formatCompactCountdown("2026-09-04T02:00:00.000Z", now)).toBe(
      "2d 02h",
    );
    expect(formatCompactCountdown("2026-09-02T01:05:00.000Z", now)).toBe(
      "1h 05m",
    );
    expect(formatCompactCountdown("2026-09-06T05:00:00.000Z", now)).toBe(
      "4d 05h",
    );
    expect(formatCompactCountdown("2026-09-02T00:25:00.000Z", now)).toBe(
      "25m",
    );
    expect(formatCompactCountdown(undefined, now)).toBe("--");
  });

  it("formats percentages with zero-padding and no decimals", () => {
    expect(formatPercent(undefined)).toBe("--");
    expect(formatPercent(NaN)).toBe("--");
    expect(formatPercent(0)).toBe("00%");
    expect(formatPercent(5)).toBe("05%");
    expect(formatPercent(9)).toBe("09%");
    expect(formatPercent(10)).toBe("10%");
    expect(formatPercent(75)).toBe("75%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(0.2)).toBe("00%");
    expect(formatPercent(0.8)).toBe("01%");
    expect(formatPercent(24.4)).toBe("24%");
    expect(formatPercent(24.7)).toBe("25%");
  });

  it("formats compact window labels for providers", () => {
    expect(
      formatCompactWindowLabel({
        kind: "weekly",
        label: "Weekly",
      }),
    ).toBe("7d");
    expect(
      formatCompactWindowLabel({
        id: "agy-gemini-5h",
        kind: "five_hour",
        label: "5h Limit",
      }),
    ).toBe("5h");
    expect(
      formatCompactWindowLabel({
        id: "agy-gemini-weekly",
        kind: "weekly",
        label: "Weekly Limit",
      }),
    ).toBe("7d");
    expect(
      formatCompactWindowLabel({
        kind: "model_weekly",
        label: "Claude 3.5 Fable Weekly",
      }),
    ).toBe("fable");
    expect(
      formatCompactWindowLabel({
        kind: "model_weekly",
        label: "Sonnet Weekly",
      }),
    ).toBe("sonnet");
  });

  it("keeps the displayed quota pending after its reset time", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    expect(isResetPending("2026-09-01T23:59:59.000Z", now)).toBe(true);
    expect(formatQuotaCountdown("2026-09-01T23:59:59.000Z", now)).toBe("0m");
    expect(isResetPending("2026-09-02T00:00:01.000Z", now)).toBe(false);
  });

  it("formats reset help with a local date and AM/PM time", () => {
    const value = "2026-09-02T13:05:00.000Z";
    const expected = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(value));

    expect(formatResetAt(value)).toBe(expected);
    expect(formatResetAt(value)).toMatch(/(AM|PM)/);
  });

  it("calculates reset elapsed percent based on window kind", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    // 5h window: 1h left out of 5h -> 4h elapsed (80%)
    const resets5h = new Date(now + 60 * 60 * 1000).toISOString();
    expect(getResetElapsedPercent(resets5h, now, "five_hour")).toBe(80);

    // 7d window: 1d left out of 7d -> 6d elapsed (85.71%)
    const resets7d = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    expect(getResetElapsedPercent(resets7d, now, "weekly")).toBeCloseTo(85.71, 1);

    // past reset time returns 100
    expect(getResetElapsedPercent("2026-09-01T23:00:00.000Z", now, "five_hour")).toBe(100);
    expect(getResetElapsedPercent(undefined, now, "five_hour")).toBeUndefined();
  });

  it("generates progressive 4-stage countdown styles", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    // Stage 1: calm (<75% elapsed, e.g. 4h 30m left out of 5h -> 10% elapsed)
    const calmReset = new Date(now + 4.5 * 60 * 60 * 1000).toISOString();
    const calmStyle = getResetCountdownStyle(calmReset, now, "five_hour");
    expect(calmStyle?.animation).toContain("smooth-shimmer-flow");
    expect(calmStyle?.backgroundImage).toContain("#7c7c7c");
    expect(calmStyle?.WebkitBackgroundClip).toBe("text");
    expect(calmStyle?.WebkitTextFillColor).toBe("transparent");

    // Stage 2: warning (75%~88% elapsed, e.g. 1h left out of 5h -> 80% elapsed)
    const warnReset = new Date(now + 1 * 60 * 60 * 1000).toISOString();
    const warnStyle = getResetCountdownStyle(warnReset, now, "five_hour");
    expect(warnStyle?.animation).toContain("smooth-shimmer-flow");
    expect(warnStyle?.backgroundImage).toContain("#ffe9b8");

    // Stage 3: urgent (88%~98% elapsed, e.g. 24m left out of 5h -> 92% elapsed)
    const urgentReset = new Date(now + 24 * 60 * 1000).toISOString();
    const urgentStyle = getResetCountdownStyle(urgentReset, now, "five_hour");
    expect(urgentStyle?.animation).toContain("pastel-rainbow-flow");
    expect(urgentStyle?.filter).toBeDefined();

    // Stage 4: finale (>=98% elapsed, e.g. 4m left out of 5h -> 98.67% elapsed)
    const finaleReset = new Date(now + 4 * 60 * 1000).toISOString();
    const finaleStyle = getResetCountdownStyle(finaleReset, now, "five_hour");
    expect(finaleStyle?.animation).toContain("pastel-rainbow-flow 1.1s");
    expect(finaleStyle?.backgroundImage).toContain("#ff1955");
    expect(finaleStyle?.filter).toContain("drop-shadow");

    // undefined for resetPending / past resets
    expect(getResetCountdownStyle("2026-09-01T23:00:00.000Z", now, "five_hour")).toBeUndefined();
    expect(getResetCountdownStyle(undefined, now, "five_hour")).toBeUndefined();
  });
});

describe("tooltip placement", () => {
  const viewport = { width: 420, height: 320 };
  const tooltip = { width: 160, height: 48 };

  it("places a tooltip below its anchor when it fits before the footer", () => {
    expect(placeTooltip({
      anchor: { left: 40, top: 80, right: 100, bottom: 100 }, tooltip, viewport, footerTop: 280,
    })).toMatchObject({ left: 40, top: 106, placement: "below" });
  });

  it("flips a lower tooltip above the protected footer", () => {
    expect(placeTooltip({
      anchor: { left: 40, top: 230, right: 100, bottom: 250 }, tooltip, viewport, footerTop: 280,
    })).toMatchObject({ top: 176, placement: "above" });
  });

  it("prefers above when another trigger would be covered and space fits", () => {
    expect(placeTooltip({
      anchor: { left: 40, top: 120, right: 100, bottom: 140 },
      tooltip,
      viewport,
      footerTop: 280,
      preferAbove: true,
    })).toMatchObject({ top: 66, placement: "above" });
  });

  it("keeps below when preferred above does not fit", () => {
    expect(placeTooltip({
      anchor: { left: 40, top: 30, right: 100, bottom: 50 },
      tooltip,
      viewport,
      footerTop: 280,
      preferAbove: true,
    })).toMatchObject({ top: 56, placement: "below" });
  });

  it("clamps multiline tooltip geometry inside viewport edges", () => {
    const result = placeTooltip({
      anchor: { left: 390, top: 30, right: 410, bottom: 50 },
      tooltip: { width: 300, height: 400 }, viewport, footerTop: 280,
    });
    expect(result.left).toBe(100);
    expect(result.top).toBe(20);
    expect(result.maxHeight).toBe(254);
  });

  it("places a tooltip to the right of anchor when placementPreference is right", () => {
    const result = placeTooltip({
      anchor: { left: 24, top: 50, right: 44, bottom: 70 },
      tooltip: { width: 120, height: 60 },
      viewport,
      footerTop: 280,
      placementPreference: "right",
    });
    expect(result.placement).toBe("right");
    expect(result.left).toBe(50); // 44 + gap(6)
    expect(result.top).toBe(50);
  });

  it("dislodges tooltip to the right when tight viewport causes vertical overlap with anchor", () => {
    // Tight viewport height where neither below nor above fits without overlapping anchor
    const tightViewport = { width: 420, height: 100 };
    const result = placeTooltip({
      anchor: { left: 24, top: 35, right: 44, bottom: 55 },
      tooltip: { width: 120, height: 50 },
      viewport: tightViewport,
      footerTop: 90,
    });
    // With auto mode, because top overlaps anchor (35..55), it should dislodge to the right
    expect(result.left).toBe(50); // 44 + gap(6)
  });
});
