import { describe, expect, it } from "vitest";
import {
  CodexAppServerError,
  CodexQuotaNormalizationError,
  createCodexErrorSnapshot,
  mapCodexProviderError,
  normalizeCodexSnapshot,
  type CodexAccountResponse,
} from "../../src/providers/index";

const fetchedAt = new Date("2026-09-01T03:00:00.000Z");
const authenticated: CodexAccountResponse = {
  account: { type: "chatgpt", planType: "example-plan" },
  requiresOpenaiAuth: false,
};

describe("Codex quota normalization", () => {
  it("maps confirmed base positions and durations to 5h and weekly", () => {
    const snapshot = normalizeCodexSnapshot({
      account: authenticated,
      fetchedAt,
      rateLimits: {
        rateLimits: {
          primary: {
            usedPercent: 22,
            windowDurationMins: 300,
            resetsAt: Date.parse("2026-09-01T08:00:00.000Z") / 1000,
          },
          secondary: {
            usedPercent: 47,
            windowDurationMins: 10_080,
            resetsAt: Date.parse("2026-09-08T08:00:00.000Z") / 1000,
          },
        },
      },
    });

    expect(snapshot).toMatchObject({
      providerId: "codex",
      accountLabel: "example-plan",
      status: "fresh",
      fetchedAt: "2026-09-01T03:00:00.000Z",
      lastSuccessfulAt: "2026-09-01T03:00:00.000Z",
    });
    expect(snapshot.quotaWindows).toEqual([
      {
        id: "codex-five-hour",
        kind: "five_hour",
        label: "5h",
        usedPercent: 22,
        resetsAt: "2026-09-01T08:00:00.000Z",
        source: "codex_app_server",
        status: "fresh",
      },
      {
        id: "codex-weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 47,
        resetsAt: "2026-09-08T08:00:00.000Z",
        source: "codex_app_server",
        status: "fresh",
      },
    ]);
  });

  it("marks a missing expected window unavailable without estimating zero", () => {
    const snapshot = normalizeCodexSnapshot({
      account: authenticated,
      fetchedAt,
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 22, windowDurationMins: 300 },
        },
      },
    });

    const weekly = snapshot.quotaWindows.find(
      ({ kind }) => kind === "weekly",
    );
    expect(weekly).toEqual({
      id: "codex-weekly",
      kind: "weekly",
      label: "Weekly",
      source: "codex_app_server",
      status: "unavailable",
    });
    expect(weekly).not.toHaveProperty("usedPercent");
  });

  it("preserves unconfirmed base windows as other", () => {
    const snapshot = normalizeCodexSnapshot({
      account: authenticated,
      fetchedAt,
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 60 },
          secondary: { usedPercent: 6, windowDurationMins: 300 },
        },
      },
    });

    expect(snapshot.quotaWindows.map(({ id, kind, status }) => ({
      id,
      kind,
      status,
    }))).toEqual([
      { id: "codex-five-hour", kind: "five_hour", status: "unavailable" },
      { id: "codex-weekly", kind: "weekly", status: "unavailable" },
      { id: "codex-base-primary", kind: "other", status: "fresh" },
      { id: "codex-base-secondary", kind: "other", status: "fresh" },
    ]);
  });

  it("preserves model-specific weekly and other windows with stable IDs", () => {
    const longIdentity = "model-" + "x".repeat(100);
    const input = {
      account: authenticated,
      fetchedAt,
      rateLimits: {
        rateLimits: {},
        rateLimitsByLimitId: {
          [longIdentity]: {
            limitId: longIdentity,
            limitName: "Example model " + "y".repeat(100),
            primary: { usedPercent: 11, windowDurationMins: 10_080 },
            secondary: { usedPercent: 12, windowDurationMins: 1_440 },
          },
        },
      },
    };

    const first = normalizeCodexSnapshot(input);
    const second = normalizeCodexSnapshot(input);
    const additional = first.quotaWindows.slice(2);

    expect(additional.map(({ kind }) => kind)).toEqual([
      "model_weekly",
      "other",
    ]);
    expect(additional.map(({ id }) => id)).toEqual(
      second.quotaWindows.slice(2).map(({ id }) => id),
    );
    expect(new Set(first.quotaWindows.map(({ id }) => id)).size).toBe(
      first.quotaWindows.length,
    );
    expect(additional.every(({ id, label }) => id.length <= 80 && label.length <= 80))
      .toBe(true);
  });

  it("reports authentication as unavailable without requesting recovery", () => {
    const snapshot = normalizeCodexSnapshot({
      account: { account: null, requiresOpenaiAuth: true },
      fetchedAt,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.error?.code).toBe("not_authenticated");
    expect(snapshot.quotaWindows.every(({ status }) => status === "unavailable"))
      .toBe(true);
  });

  it("rejects reset timestamps that cannot be represented safely", () => {
    expect(() =>
      normalizeCodexSnapshot({
        account: authenticated,
        fetchedAt,
        rateLimits: {
          rateLimits: {
            primary: {
              usedPercent: 1,
              windowDurationMins: 300,
              resetsAt: Number.MAX_SAFE_INTEGER,
            },
          },
        },
      }),
    ).toThrow(CodexQuotaNormalizationError);
  });
});

describe("Codex provider error mapping", () => {
  it.each([
    ["not_installed", "not_installed"],
    ["timeout", "timeout"],
    ["malformed_response", "unsupported_output"],
    ["spawn_failed", "process_failed"],
    ["process_exited", "process_failed"],
    ["rpc_error", "unavailable"],
    ["closed", "process_failed"],
  ] as const)("maps %s without raw process details", (reason, expectedCode) => {
    expect(mapCodexProviderError(new CodexAppServerError(reason)).code).toBe(
      expectedCode,
    );
  });

  it("creates a sanitized unavailable snapshot for unknown failures", () => {
    const snapshot = createCodexErrorSnapshot(
      new Error("private response and credential path"),
      fetchedAt,
    );

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.error).toEqual({
      code: "unexpected",
      message: "Codex quota refresh failed unexpectedly.",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private response");
  });
});
