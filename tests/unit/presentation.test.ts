import { describe, expect, it } from "vitest";
import {
  formatQuotaCountdown,
  formatResetAt,
  isResetPending,
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
