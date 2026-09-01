import {
  providerErrorSchema,
  providerSnapshotSchema,
  type ProviderError,
  type ProviderSnapshot,
  type QuotaKind,
  type QuotaWindow,
} from "../../shared/index";
import { CodexAppServerError } from "./appServerClient";
import type {
  CodexAccountResponse,
  CodexRateLimitSnapshot,
  CodexRateLimitWindow,
  CodexRateLimitsResponse,
} from "./protocol";

const FIVE_HOUR_MINUTES = 5 * 60;
const WEEKLY_MINUTES = 7 * 24 * 60;
const MAX_LABEL_LENGTH = 80;

export interface NormalizeCodexSnapshotInput {
  account: CodexAccountResponse;
  rateLimits?: CodexRateLimitsResponse;
  fetchedAt: Date;
}

export class CodexQuotaNormalizationError extends Error {
  constructor() {
    super("Codex quota response could not be normalized.");
    this.name = "CodexQuotaNormalizationError";
  }
}

export function normalizeCodexSnapshot({
  account,
  rateLimits,
  fetchedAt,
}: NormalizeCodexSnapshotInput): ProviderSnapshot {
  const timestamp = fetchedAt.toISOString();
  if (account.requiresOpenaiAuth) {
    return providerSnapshotSchema.parse({
      providerId: "codex",
      status: "unavailable",
      fetchedAt: timestamp,
      quotaWindows: expectedUnavailableWindows(),
      error: {
        code: "not_authenticated",
        message: "Sign in with the Codex CLI to view quota.",
      },
    });
  }
  if (!rateLimits) {
    throw new CodexQuotaNormalizationError();
  }

  const quotaWindows = normalizeRateLimits(rateLimits);
  return providerSnapshotSchema.parse({
    providerId: "codex",
    ...(account.account?.planType
      ? { accountLabel: truncate(account.account.planType) }
      : {}),
    status: "fresh",
    fetchedAt: timestamp,
    lastSuccessfulAt: timestamp,
    quotaWindows,
  });
}

export function createCodexErrorSnapshot(
  error: unknown,
  fetchedAt: Date,
): ProviderSnapshot {
  return providerSnapshotSchema.parse({
    providerId: "codex",
    status: "unavailable",
    fetchedAt: fetchedAt.toISOString(),
    quotaWindows: expectedUnavailableWindows(),
    error: mapCodexProviderError(error),
  });
}

export function mapCodexProviderError(error: unknown): ProviderError {
  if (error instanceof CodexQuotaNormalizationError) {
    return providerErrorSchema.parse({
      code: "unsupported_output",
      message: "Codex returned an unsupported quota response.",
    });
  }
  if (error instanceof CodexAppServerError) {
    const mapped: Record<
      CodexAppServerError["reason"],
      Pick<ProviderError, "code" | "message">
    > = {
      not_installed: {
        code: "not_installed",
        message: "Install the Codex CLI to view quota.",
      },
      timeout: {
        code: "timeout",
        message: "Codex quota refresh timed out.",
      },
      malformed_response: {
        code: "unsupported_output",
        message: "The installed Codex CLI returned an unsupported response.",
      },
      spawn_failed: {
        code: "process_failed",
        message: "Codex App Server could not be started.",
      },
      process_exited: {
        code: "process_failed",
        message: "Codex App Server stopped during quota refresh.",
      },
      rpc_error: {
        code: "unavailable",
        message: "Codex App Server could not provide quota.",
      },
      closed: {
        code: "process_failed",
        message: "Codex App Server was closed.",
      },
    };
    return providerErrorSchema.parse(mapped[error.reason]);
  }
  return providerErrorSchema.parse({
    code: "unexpected",
    message: "Codex quota refresh failed unexpectedly.",
  });
}

function normalizeRateLimits(
  response: CodexRateLimitsResponse,
): QuotaWindow[] {
  const baseWindows = normalizeBaseWindows(response.rateLimits);
  const fiveHour =
    baseWindows.find(({ kind }) => kind === "five_hour") ??
    unavailableWindow("five_hour");
  const weekly =
    baseWindows.find(({ kind }) => kind === "weekly") ??
    unavailableWindow("weekly");
  const otherBase = baseWindows.filter(
    ({ kind }) => kind !== "five_hour" && kind !== "weekly",
  );
  const additional = Object.entries(response.rateLimitsByLimitId ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([recordKey, snapshot]) =>
      normalizeAdditionalWindows(recordKey, snapshot),
    );

  return [fiveHour, weekly, ...otherBase, ...additional];
}

function normalizeBaseWindows(snapshot: CodexRateLimitSnapshot): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  if (snapshot.primary) {
    windows.push(
      normalizeWindow(
        snapshot.primary,
        snapshot.primary.windowDurationMins === FIVE_HOUR_MINUTES
          ? "five_hour"
          : "other",
        snapshot.primary.windowDurationMins === FIVE_HOUR_MINUTES
          ? "codex-five-hour"
          : "codex-base-primary",
        snapshot.primary.windowDurationMins === FIVE_HOUR_MINUTES
          ? "5h"
          : "Primary quota",
      ),
    );
  }
  if (snapshot.secondary) {
    windows.push(
      normalizeWindow(
        snapshot.secondary,
        snapshot.secondary.windowDurationMins === WEEKLY_MINUTES
          ? "weekly"
          : "other",
        snapshot.secondary.windowDurationMins === WEEKLY_MINUTES
          ? "codex-weekly"
          : "codex-base-secondary",
        snapshot.secondary.windowDurationMins === WEEKLY_MINUTES
          ? "Weekly"
          : "Secondary quota",
      ),
    );
  }
  return windows;
}

function normalizeAdditionalWindows(
  recordKey: string,
  snapshot: CodexRateLimitSnapshot,
): QuotaWindow[] {
  const identity = snapshot.limitId ?? recordKey;
  const label = snapshot.limitName ?? snapshot.limitId ?? recordKey;
  return (["primary", "secondary"] as const).flatMap((slot) => {
    const window = snapshot[slot];
    if (!window) {
      return [];
    }
    const kind: QuotaKind =
      window.windowDurationMins === WEEKLY_MINUTES ? "model_weekly" : "other";
    const suffix = kind === "model_weekly" ? "Weekly" : titleCase(slot);
    return [
      normalizeWindow(
        window,
        kind,
        stableAdditionalId(recordKey, identity, slot),
        truncate(`${label} ${suffix}`),
      ),
    ];
  });
}

function normalizeWindow(
  window: CodexRateLimitWindow,
  kind: QuotaKind,
  id: string,
  label: string,
): QuotaWindow {
  return {
    id,
    kind,
    label,
    usedPercent: window.usedPercent,
    ...(window.resetsAt == null
      ? {}
      : { resetsAt: unixSecondsToIso(window.resetsAt) }),
    source: "codex_app_server",
    status: "fresh",
  };
}

function expectedUnavailableWindows(): QuotaWindow[] {
  return [unavailableWindow("five_hour"), unavailableWindow("weekly")];
}

function unavailableWindow(kind: "five_hour" | "weekly"): QuotaWindow {
  return {
    id: kind === "five_hour" ? "codex-five-hour" : "codex-weekly",
    kind,
    label: kind === "five_hour" ? "5h" : "Weekly",
    source: "codex_app_server",
    status: "unavailable",
  };
}

function unixSecondsToIso(seconds: number): string {
  if (!Number.isSafeInteger(seconds)) {
    throw new CodexQuotaNormalizationError();
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new CodexQuotaNormalizationError();
  }
  return date.toISOString();
}

function stableAdditionalId(
  recordKey: string,
  identity: string,
  slot: string,
): string {
  const safe = `${recordKey}-${identity}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44);
  return `codex-limit-${safe || "unnamed"}-${slot}-${smallHash(
    `${recordKey}\0${identity}`,
  )}`;
}

function smallHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function truncate(value: string): string {
  return value.length <= MAX_LABEL_LENGTH
    ? value
    : value.slice(0, MAX_LABEL_LENGTH);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
