import { describe, expect, it } from "vitest";
import {
  codexAccountReadParamsSchema,
  codexAccountResponseSchema,
  codexRateLimitsResponseSchema,
} from "../../src/providers/index";

describe("Codex App Server public protocol contract", () => {
  it("accepts the quota fields used by the monitor", () => {
    const response = codexRateLimitsResponseSchema.parse({
      rateLimits: {
        primary: {
          usedPercent: 27,
          resetsAt: 1_788_227_200,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 41,
          resetsAt: 1_788_832_000,
          windowDurationMins: 10_080,
        },
        planType: "example-plan",
        futureServerField: "ignored",
      },
      rateLimitsByLimitId: {
        "model-example": {
          limitId: "model-example",
          limitName: "Example model",
          primary: {
            usedPercent: 9,
            windowDurationMins: 10_080,
          },
        },
      },
      futureResponseField: true,
    });

    expect(response.rateLimits.primary?.windowDurationMins).toBe(300);
    expect(response.rateLimits.secondary?.windowDurationMins).toBe(10_080);
    expect(response.rateLimitsByLimitId?.["model-example"]?.limitId).toBe(
      "model-example",
    );
    expect("futureResponseField" in response).toBe(false);
  });

  it("structurally prevents proactive credential refresh", () => {
    expect(codexAccountReadParamsSchema.parse({})).toEqual({});
    expect(codexAccountReadParamsSchema.parse({ refreshToken: false })).toEqual({
      refreshToken: false,
    });
    expect(() =>
      codexAccountReadParamsSchema.parse({ refreshToken: true }),
    ).toThrow();
  });

  it("discards account identifiers from parsed responses", () => {
    const response = codexAccountResponseSchema.parse({
      account: {
        type: "chatgpt",
        email: "not-retained@example.invalid",
        planType: "example-plan",
      },
      requiresOpenaiAuth: false,
    });

    expect(response).toEqual({
      account: { type: "chatgpt", planType: "example-plan" },
      requiresOpenaiAuth: false,
    });
    expect(JSON.stringify(response)).not.toContain("not-retained");
  });

  it("rejects malformed quota percentages", () => {
    expect(() =>
      codexRateLimitsResponseSchema.parse({
        rateLimits: { primary: { usedPercent: 101 } },
      }),
    ).toThrow();
  });
});
