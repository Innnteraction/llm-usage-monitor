import {
  providerSnapshotSchema,
  type ProviderError,
  type ProviderSnapshot,
  type QuotaWindow,
} from "../../shared/index";
import type { ClaudePtyProbeResult, ClaudePtyProbeStatus } from "./ptyProbe";
import type { ClaudeParsedQuotaWindow } from "./usageParser";

export function normalizeClaudeSnapshot(
  result: ClaudePtyProbeResult,
  fetchedAt: Date,
  accountLabel?: string,
): ProviderSnapshot {
  const timestamp = fetchedAt.toISOString();
  if (result.status !== "supported") {
    return providerSnapshotSchema.parse({
      providerId: "claude",
      status: "unavailable",
      fetchedAt: timestamp,
      quotaWindows: expectedUnavailableWindows(),
      error: mapClaudeError(result.status),
    });
  }
  const windows = result.quotaWindows.map(normalizeWindow);
  const fiveHour = windows.find(({ kind }) => kind === "five_hour");
  const weekly = windows.find(({ kind }) => kind === "weekly");
  if (!fiveHour || !weekly) {
    return providerSnapshotSchema.parse({
      providerId: "claude",
      status: "unavailable",
      fetchedAt: timestamp,
      quotaWindows: expectedUnavailableWindows(),
      error: mapClaudeError("unsupported_output"),
    });
  }
  return providerSnapshotSchema.parse({
    providerId: "claude",
    ...(accountLabel ? { accountLabel } : {}),
    status: "fresh",
    fetchedAt: timestamp,
    lastSuccessfulAt: timestamp,
    quotaWindows: [
      fiveHour,
      weekly,
      ...windows.filter(({ kind }) => kind === "model_weekly"),
    ],
  });
}

export function createClaudeInitialSnapshot(fetchedAt: Date): ProviderSnapshot {
  return providerSnapshotSchema.parse({
    providerId: "claude",
    status: "unavailable",
    fetchedAt: fetchedAt.toISOString(),
    quotaWindows: expectedUnavailableWindows(),
  });
}

export function createClaudeUnexpectedSnapshot(fetchedAt: Date): ProviderSnapshot {
  return providerSnapshotSchema.parse({
    providerId: "claude",
    status: "unavailable",
    fetchedAt: fetchedAt.toISOString(),
    quotaWindows: expectedUnavailableWindows(),
    error: {
      code: "unexpected",
      message: "Claude quota refresh failed unexpectedly.",
    },
  });
}

function normalizeWindow(window: ClaudeParsedQuotaWindow): QuotaWindow {
  const slug = window.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id:
      window.kind === "five_hour"
        ? "claude-five-hour"
        : window.kind === "weekly"
          ? "claude-weekly"
          : `claude-model-${slug || "unnamed"}`,
    kind: window.kind,
    label: window.label,
    usedPercent: window.usedPercent,
    ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
    source: "claude_cli",
    status: "fresh",
  };
}

function expectedUnavailableWindows(): QuotaWindow[] {
  return [
    { id: "claude-five-hour", kind: "five_hour", label: "5h", source: "claude_cli", status: "unavailable" },
    { id: "claude-weekly", kind: "weekly", label: "Weekly", source: "claude_cli", status: "unavailable" },
  ];
}

function mapClaudeError(status: ClaudePtyProbeStatus): ProviderError {
  const errors: Record<ClaudePtyProbeStatus, ProviderError> = {
    supported: { code: "unexpected", message: "Claude quota normalization failed unexpectedly." },
    not_installed: { code: "not_installed", message: "Install the Claude CLI to view quota." },
    not_authenticated: { code: "not_authenticated", message: "Sign in with the Claude CLI to view quota." },
    blocked_prompt: { code: "unavailable", message: "Approve the dedicated Claude probe folder to view quota." },
    unsupported_output: { code: "unsupported_output", message: "The installed Claude CLI returned an unsupported usage screen." },
    timeout: { code: "timeout", message: "Claude quota refresh timed out." },
    process_failed: { code: "process_failed", message: "Claude CLI stopped during quota refresh." },
  };
  return errors[status];
}
