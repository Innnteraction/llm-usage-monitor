import { spawn, type SpawnOptions } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  resolveClaudeProbeDirectory,
} from "../providers/index";
import type { ClaudeSetupAction } from "../shared/index";
import {
  buildTerminalLaunch,
  type TerminalLaunch,
} from "./platform/index";

export type ClaudeSetupLaunch = TerminalLaunch;

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
  platform: NodeJS.Platform = process.platform,
): ClaudeSetupLaunch => {
  return buildTerminalLaunch(action, probeDirectory, platform);
};

export async function openClaudeSetup(
  action: ClaudeSetupAction,
  options: {
    platform?: NodeJS.Platform;
    probeDirectory?: string;
    spawnProcess?: SpawnDetached;
  } = {},
): Promise<{ opened: boolean }> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    return { opened: false };
  }

  const launch = buildClaudeSetupLaunch(
    action,
    options.probeDirectory ?? resolveClaudeProbeDirectory(),
    platform,
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
