import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { spawn, type IPty } from "node-pty";

const TEMP_PREFIX = "llm-usage-monitor-claude-";
const MAX_CAPTURE_CHARS = 512 * 1024;
const STARTUP_IDLE_MS = 5_000;
const RESPONSE_IDLE_MS = 1_500;
const EXIT_TIMEOUT_MS = 2_000;
const PROBE_TIMEOUT_MS = 20_000;

export type ClaudePtyProbeStatus =
  | "supported"
  | "not_installed"
  | "not_authenticated"
  | "blocked_prompt"
  | "unsupported_output"
  | "timeout"
  | "process_failed";

export interface ClaudeUsageScreenSignals {
  hasFiveHourWindow: boolean;
  hasWeeklyWindow: boolean;
  hasQuotaDetails: boolean;
  requiresLogin: boolean;
  hasTrustPrompt: boolean;
}

export interface ClaudePtyProbeResult extends ClaudeUsageScreenSignals {
  status: ClaudePtyProbeStatus;
  gracefulExit: boolean;
  sentUsageCommand: boolean;
  sentModelPrompt: false;
}

export interface ClaudePtyProbeOptions {
  command?: string;
  timeoutMs?: number;
}

export function classifyClaudeUsageScreen(
  screen: string,
): ClaudeUsageScreenSignals {
  const text = stripVTControlCharacters(screen).replaceAll("\r", "\n");
  return {
    hasFiveHourWindow:
      /\b(?:current\s+session|session\s+limit|5[\s-]*(?:h|hour)|five[\s-]*hour)\b/i.test(
        text,
      ),
    hasWeeklyWindow:
      /\b(?:current\s+week|weekly|week(?:ly)?\s+limit)\b/i.test(text),
    hasQuotaDetails: /%|resets?|remaining|used/i.test(text),
    requiresLogin:
      /not logged in|not authenticated|please log in|run \/login|authentication required/i.test(
        text,
      ),
    hasTrustPrompt:
      /trust this (?:folder|directory)|do you trust|workspace trust/i.test(text),
  };
}

export async function runClaudeUsageProbe(
  options: ClaudePtyProbeOptions = {},
): Promise<ClaudePtyProbeResult> {
  const tempBase = path.resolve(tmpdir());
  const workingDirectory = await mkdtemp(path.join(tempBase, TEMP_PREFIX));
  const emptySignals = classifyClaudeUsageScreen("");
  let terminal: IPty | undefined;
  let startupScreen = "";
  let usageScreen = "";
  let phase: "startup" | "usage" | "exiting" = "startup";
  let sentUsageCommand = false;
  let pendingStatus: ClaudePtyProbeStatus | undefined;
  let settled = false;
  let startupIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let responseIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<ClaudePtyProbeResult>((resolve) => {
    const clearTimers = (): void => {
      for (const timer of [
        startupIdleTimer,
        responseIdleTimer,
        exitTimer,
        probeTimer,
      ]) {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    const finish = (
      status: ClaudePtyProbeStatus,
      gracefulExit: boolean,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      const signals = classifyClaudeUsageScreen(
        phase === "startup" ? startupScreen : usageScreen,
      );
      startupScreen = "";
      usageScreen = "";
      try {
        terminal?.kill();
      } catch {
        // The process already exited.
      }
      const result: ClaudePtyProbeResult = {
        ...signals,
        status,
        gracefulExit,
        sentUsageCommand,
        sentModelPrompt: false,
      };
      void removeProbeDirectory(tempBase, workingDirectory)
        .then(() => {
          resolve(result);
        })
        .catch(() => {
          resolve(result);
        });
    };

    const beginExit = (status: ClaudePtyProbeStatus): void => {
      if (phase === "exiting") {
        return;
      }
      pendingStatus = status;
      phase = "exiting";
      try {
        terminal?.write("/exit\r");
      } catch {
        finish(status, false);
        return;
      }
      exitTimer = setTimeout(() => finish(status, false), EXIT_TIMEOUT_MS);
    };

    const evaluateUsage = (): void => {
      const signals = classifyClaudeUsageScreen(usageScreen);
      if (signals.requiresLogin) {
        finish("not_authenticated", false);
      } else if (signals.hasTrustPrompt) {
        finish("blocked_prompt", false);
      } else if (
        signals.hasFiveHourWindow &&
        signals.hasWeeklyWindow &&
        signals.hasQuotaDetails
      ) {
        beginExit("supported");
      } else {
        beginExit("unsupported_output");
      }
    };

    const sendUsage = (): void => {
      if (phase !== "startup") {
        return;
      }
      const startupSignals = classifyClaudeUsageScreen(startupScreen);
      if (startupSignals.requiresLogin) {
        finish("not_authenticated", false);
        return;
      }
      if (startupSignals.hasTrustPrompt) {
        finish("blocked_prompt", false);
        return;
      }
      startupScreen = "";
      phase = "usage";
      sentUsageCommand = true;
      try {
        terminal?.write("/usage\r");
      } catch {
        finish("process_failed", false);
      }
    };

    try {
      terminal = spawn(
        options.command ?? (process.platform === "win32" ? "claude.exe" : "claude"),
        [
          "--safe-mode",
          "--ax-screen-reader",
          "--restricted",
          "--strict-mcp-config",
          "--tools",
          "",
        ],
        {
          cols: 120,
          rows: 40,
          cwd: workingDirectory,
          env: {
            ...process.env,
            CLAUDE_CODE_SAFE_MODE: "1",
            NO_COLOR: "1",
            TERM: "xterm-256color",
          },
        },
      );
    } catch {
      finish("not_installed", false);
      return;
    }

    terminal.onData((raw) => {
      const text = stripVTControlCharacters(raw);
      if (phase === "startup") {
        startupScreen = appendBounded(startupScreen, text);
        const signals = classifyClaudeUsageScreen(startupScreen);
        if (signals.requiresLogin) {
          finish("not_authenticated", false);
          return;
        }
        if (signals.hasTrustPrompt) {
          finish("blocked_prompt", false);
          return;
        }
        if (startupIdleTimer) {
          clearTimeout(startupIdleTimer);
        }
        startupIdleTimer = setTimeout(sendUsage, STARTUP_IDLE_MS);
      } else if (phase === "usage") {
        usageScreen = appendBounded(usageScreen, text);
        const signals = classifyClaudeUsageScreen(usageScreen);
        if (signals.requiresLogin) {
          finish("not_authenticated", false);
          return;
        }
        if (signals.hasTrustPrompt) {
          finish("blocked_prompt", false);
          return;
        }
        if (responseIdleTimer) {
          clearTimeout(responseIdleTimer);
        }
        responseIdleTimer = setTimeout(evaluateUsage, RESPONSE_IDLE_MS);
      }
    });

    terminal.onExit(() => {
      if (pendingStatus) {
        finish(pendingStatus, true);
      } else {
        const signals = classifyClaudeUsageScreen(
          phase === "startup" ? startupScreen : usageScreen,
        );
        finish(
          signals.requiresLogin
            ? "not_authenticated"
            : signals.hasTrustPrompt
              ? "blocked_prompt"
            : "process_failed",
          true,
        );
      }
    });

    probeTimer = setTimeout(
      () => finish("timeout", false),
      options.timeoutMs ?? PROBE_TIMEOUT_MS,
    );

    if (!startupIdleTimer) {
      startupIdleTimer = setTimeout(sendUsage, STARTUP_IDLE_MS);
    }
  }).catch(async () => {
    await removeProbeDirectory(tempBase, workingDirectory);
    return {
      ...emptySignals,
      status: "process_failed",
      gracefulExit: false,
      sentUsageCommand,
      sentModelPrompt: false,
    };
  });
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= MAX_CAPTURE_CHARS
    ? combined
    : combined.slice(-MAX_CAPTURE_CHARS);
}

async function removeProbeDirectory(
  tempBase: string,
  workingDirectory: string,
): Promise<void> {
  const resolvedBase = path.resolve(tempBase);
  const resolvedDirectory = path.resolve(workingDirectory);
  const sameParent =
    path.dirname(resolvedDirectory).toLowerCase() ===
    resolvedBase.toLowerCase();
  if (
    !sameParent ||
    !path.basename(resolvedDirectory).startsWith(TEMP_PREFIX)
  ) {
    throw new Error("Refusing to remove an unexpected probe directory.");
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(resolvedDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
