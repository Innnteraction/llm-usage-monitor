import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { spawn, type IPty } from "node-pty";
import {
  parseClaudeUsageScreen,
  type ClaudeParsedQuotaWindow,
} from "./usageParser";

const APP_DIRECTORY_NAME = "LLM Usage Monitor";
const PROBE_DIRECTORY_NAME = "claude-probe";
const MAX_CAPTURE_CHARS = 512 * 1024;
const STARTUP_IDLE_MS = 5_000;
const RESPONSE_IDLE_MS = 1_500;
const PANEL_CLOSE_DELAY_MS = 150;
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
  quotaWindows: ClaudeParsedQuotaWindow[];
}

export interface ClaudePtyProbeOptions {
  command?: string;
  workingDirectory?: string;
  timeoutMs?: number;
  clock?: () => Date;
}

export function resolveClaudeProbeDirectory(
  localAppData = process.env.LOCALAPPDATA,
): string {
  const baseDirectory = localAppData?.trim() || tmpdir();
  return path.resolve(
    baseDirectory,
    APP_DIRECTORY_NAME,
    PROBE_DIRECTORY_NAME,
  );
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
  const workingDirectory = path.resolve(
    options.workingDirectory ?? resolveClaudeProbeDirectory(),
  );
  await mkdir(workingDirectory, { recursive: true });
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
  let exitCommandTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<ClaudePtyProbeResult>((resolve) => {
    const clearTimers = (): void => {
      for (const timer of [
        startupIdleTimer,
        responseIdleTimer,
        exitCommandTimer,
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
      const quotaWindows =
        phase === "startup"
          ? []
          : parseClaudeUsageScreen(usageScreen, options.clock?.() ?? new Date());
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
        quotaWindows,
      };
      resolve(result);
    };

    const beginExit = (status: ClaudePtyProbeStatus): void => {
      if (phase === "exiting") {
        return;
      }
      pendingStatus = status;
      phase = "exiting";
      try {
        terminal?.write("\x1b");
      } catch {
        finish(status, false);
        return;
      }
      exitCommandTimer = setTimeout(() => {
        try {
          terminal?.write("/exit\r");
        } catch {
          finish(status, false);
        }
      }, PANEL_CLOSE_DELAY_MS);
      exitTimer = setTimeout(
        () => finish(status, false),
        PANEL_CLOSE_DELAY_MS + EXIT_TIMEOUT_MS,
      );
    };

    const evaluateUsage = (): void => {
      const signals = classifyClaudeUsageScreen(usageScreen);
      const windows = parseClaudeUsageScreen(
        usageScreen,
        options.clock?.() ?? new Date(),
      );
      if (signals.requiresLogin) {
        finish("not_authenticated", false);
      } else if (signals.hasTrustPrompt) {
        finish("blocked_prompt", false);
      } else if (
        windows.some(({ kind }) => kind === "five_hour") &&
        windows.some(({ kind }) => kind === "weekly")
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
  }).catch(() => {
    return {
      ...emptySignals,
      status: "process_failed",
      gracefulExit: false,
      sentUsageCommand,
      sentModelPrompt: false,
      quotaWindows: [],
    };
  });
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= MAX_CAPTURE_CHARS
    ? combined
    : combined.slice(-MAX_CAPTURE_CHARS);
}
