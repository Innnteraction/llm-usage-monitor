import { describe, expect, it } from "vitest";
import {
  appSnapshotSchema,
  localTokenUsageSchema,
  quotaWindowSchema,
} from "../../src/shared/index";

describe("public snapshot contracts", () => {
  it("accepts a sanitized quota snapshot", () => {
    expect(
      appSnapshotSchema.parse({
        schemaVersion: 1,
        providers: [
          {
            providerId: "codex",
            status: "fresh",
            fetchedAt: "2026-09-01T00:00:00.000Z",
            lastSuccessfulAt: "2026-09-01T00:00:00.000Z",
            quotaWindows: [
              {
                id: "five-hour",
                kind: "five_hour",
                label: "5h",
                usedPercent: 42,
                resetsAt: "2026-09-01T05:00:00.000Z",
                source: "local_fixture",
                status: "fresh",
              },
            ],
          },
        ],
        refreshing: [],
        updatedAt: "2026-09-01T00:00:00.000Z",
      }).providers[0]?.quotaWindows[0]?.usedPercent,
    ).toBe(42);
  });

  it("rejects quota percentages outside 0 through 100", () => {
    expect(() =>
      quotaWindowSchema.parse({
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 101,
        source: "local_fixture",
        status: "fresh",
      }),
    ).toThrow();
  });

  it("rejects local filesystem paths from the public token payload", () => {
    expect(() =>
      localTokenUsageSchema.parse({
        scope: "local_device",
        scannedFileCount: 2,
        failedFileCount: 0,
        scannedPaths: ["private-path"],
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        partial: false,
        calculatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects non-safe local token counts", () => {
    expect(() =>
      localTokenUsageSchema.parse({
        scope: "local_device",
        scannedFileCount: 1,
        failedFileCount: 0,
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
        outputTokens: 0,
        totalTokens: 0,
        partial: false,
        calculatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
