import { spawn, type SpawnOptions } from "node:child_process";
import type { AntigravitySetupAction } from "../shared/index";
import {
  buildAntigravityTerminalLaunch,
  type TerminalLaunch,
} from "./platform/index";

export type AntigravitySetupLaunch = TerminalLaunch;

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

export const buildAntigravitySetupLaunch = (
  action: AntigravitySetupAction,
  platform: NodeJS.Platform = process.platform,
): AntigravitySetupLaunch => {
  return buildAntigravityTerminalLaunch(action, platform);
};

export async function openAntigravitySetup(
  action: AntigravitySetupAction,
  options: {
    platform?: NodeJS.Platform;
    spawnProcess?: SpawnDetached;
  } = {},
): Promise<{ opened: boolean }> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    return { opened: false };
  }

  const launch = buildAntigravitySetupLaunch(action, platform);

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
