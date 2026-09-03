import { describe, expect, it } from "vitest";
import {
  formatQuotaCountdown,
  formatCompactCountdown,
  formatCompactWindowLabel,
  formatResetAt,
  isResetPending,
  placeTooltip,
} from "../../src/renderer";

describe("quota presentation", () => {
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
});
