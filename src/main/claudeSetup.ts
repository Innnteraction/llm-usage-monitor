import { spawn, type SpawnOptions } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  CLAUDE_SAFE_SESSION_ARGS,
  resolveClaudeProbeDirectory,
} from "../providers/index";
import type { ClaudeSetupAction } from "../shared/index";

export interface ClaudeSetupLaunch {
  command: "wt.exe";
  args: string[];
  workingDirectory?: string;
}

interface DetachedProcess {
  once(event: "spawn", listener: () => void): this;
  once(event: "error", listener: () => void): this;
  unref(): void;
}

type SpawnDetached = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => DetachedProcess;

export const buildClaudeSetupLaunch = (
  action: ClaudeSetupAction,
  probeDirectory = resolveClaudeProbeDirectory(),
): ClaudeSetupLaunch => {
  if (action === "login") {
    return {
      command: "wt.exe",
      args: [
        "new-tab",
        "--title",
        "Claude Code Sign In",
        "claude.exe",
        "auth",
        "login",
        "--claudeai",
      ],
    };
  }

  return {
    command: "wt.exe",
    args: [
      "new-tab",
      "--title",
      "Claude Code Probe Setup",
      "--startingDirectory",
      probeDirectory,
      "claude.exe",
      ...CLAUDE_SAFE_SESSION_ARGS,
    ],
    workingDirectory: probeDirectory,
  };
};

export async function openClaudeSetup(
  action: ClaudeSetupAction,
  options: {
    platform?: NodeJS.Platform;
    probeDirectory?: string;
    spawnProcess?: SpawnDetached;
  } = {},
): Promise<{ opened: boolean }> {
  if ((options.platform ?? process.platform) !== "win32") {
    return { opened: false };
  }

  const launch = buildClaudeSetupLaunch(
    action,
    options.probeDirectory ?? resolveClaudeProbeDirectory(),
  );
  if (launch.workingDirectory) {
    await mkdir(launch.workingDirectory, { recursive: true });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened: boolean): void => {
      if (!settled) {
        settled = true;
        resolve({ opened });
      }
    };
    try {
      const child = (options.spawnProcess ?? spawn)(
        launch.command,
        launch.args,
        {
          cwd: launch.workingDirectory,
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        },
      );
      child.once("spawn", () => {
        child.unref();
        finish(true);
      });
      child.once("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}
