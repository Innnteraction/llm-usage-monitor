import { existsSync, statSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { CLAUDE_SAFE_SESSION_ARGS } from "../../providers/claude/ptyProbe";
import { resolveCliBinary, type ClaudeSetupAction } from "../../shared/index";

export { resolveCliBinary };

export function getExecutableCandidates(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") {
    if (name === "antigravity") {
      return ["agy.exe", "agy.cmd", "agy.bat", "agy"];
    }
    if (name === "codex") {
      return ["codex.exe", "codex.cmd", "codex.bat", "codex"];
    }
    if (name === "claude") {
      return ["claude.exe", "claude.cmd", "claude.bat", "claude"];
    }
    return [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name];
  }
  if (name === "antigravity") {
    return ["agy"];
  }
  return [name];
}

export function getPlatformFallbackDirectories(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "";
    const appData = env.APPDATA ?? "";
    const userProfile = env.USERPROFILE ?? "";
    const programFiles = env.ProgramFiles ?? "";

    return [
      path.join(localAppData, "Programs", "OpenAI", "Codex", "bin"),
      path.join(localAppData, "Programs", "Codex", "bin"),
      path.join(programFiles, "OpenAI", "Codex", "bin"),
      path.join(localAppData, "pnpm"),
      path.join(appData, "npm"),
      path.join(userProfile, ".local", "bin"),
      path.join(localAppData, "agy", "bin"),
      path.join(userProfile, ".gemini", "antigravity-cli", "bin"),
      path.join(userProfile, "scoop", "shims"),
    ].filter(Boolean);
  }

  if (platform === "darwin") {
    const home = env.HOME ?? "";
    return [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      path.posix.join(home, ".local", "bin"),
      path.posix.join(home, ".cargo", "bin"),
    ].filter(Boolean);
  }

  return [];
}

export interface FindCliBinaryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fsExists?: (path: string) => boolean;
}

export function findCliBinaryPath(
  name: string,
  options: FindCliBinaryOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const checkExists =
    options.fsExists ??
    ((filePath: string) => {
      try {
        return existsSync(filePath) && !statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    });

  const candidates = getExecutableCandidates(name, platform);
  const delimiter = platform === "win32" ? ";" : ":";
  const pathDirs = (env.PATH ?? "")
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);

  const fallbackDirs = getPlatformFallbackDirectories(platform, env);
  const searchDirs = [...pathDirs, ...fallbackDirs];

  for (const dir of searchDirs) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (checkExists(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

export function resolveCliBinaryPath(
  name: "claude" | "codex" | "antigravity" | string,
  options: FindCliBinaryOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  return findCliBinaryPath(name, options) ?? resolveCliBinary(name, platform);
}

export interface TerminalLaunch {
  command: string;
  args: string[];
  workingDirectory?: string;
}

export function getAlwaysOnTopLevel(
  platform: NodeJS.Platform = process.platform,
): "screen-saver" | "status" | "floating" {
  if (platform === "win32") return "screen-saver";
  if (platform === "darwin") return "status";
  return "floating";
}

export function getLaunchAtLoginLabel(
  platform: NodeJS.Platform = process.platform,
  locale: "en" | "ko" = "en",
): string {
  if (locale === "ko") {
    return platform === "win32" ? "Windows 로그인 시 시작" : "로그인 시 시작";
  }
  return platform === "win32" ? "Start on Windows login" : "Start at login";
}

export function setupPlatformDock(
  app: { dock?: { hide(): void } },
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "darwin" && typeof app.dock?.hide === "function") {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }
}

export function ensurePlatformPath(
  currentPath: string = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  home: string = process.env.HOME ?? "",
): string {
  if (platform !== "darwin") {
    return currentPath;
  }
  const standardMacPaths = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.posix.join(home, ".local", "bin"),
    path.posix.join(home, ".cargo", "bin"),
  ].filter(Boolean);

  const delimiter = path.posix.delimiter;
  const existing = new Set(currentPath.split(delimiter).filter(Boolean));
  const missing = standardMacPaths.filter((p) => !existing.has(p));
  if (missing.length === 0) {
    return currentPath;
  }
  return [...missing, currentPath].join(delimiter);
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellQuote(value: string): string {
  return SHELL_SAFE.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildTerminalAppArgs(shellCommand: string): string[] {
  return [
    "-e",
    `tell application "Terminal" to do script "${appleScriptQuote(shellCommand)}"`,
    "-e",
    'tell application "Terminal" to activate',
  ];
}

export function buildTerminalLaunch(
  action: ClaudeSetupAction,
  probeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): TerminalLaunch {
  if (platform === "win32") {
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
  }

  // macOS (Darwin): Terminal.app 새 창에서 고정 명령을 실행한다.
  const claude = resolveCliBinary("claude", platform);
  if (action === "login") {
    return {
      command: "osascript",
      args: buildTerminalAppArgs(
        [claude, "auth", "login", "--claudeai"].map(shellQuote).join(" "),
      ),
    };
  }
  const probeCommand = [claude, ...CLAUDE_SAFE_SESSION_ARGS]
    .map(shellQuote)
    .join(" ");
  return {
    command: "osascript",
    args: buildTerminalAppArgs(
      `cd ${shellQuote(probeDirectory)} && ${probeCommand}`,
    ),
    workingDirectory: probeDirectory,
  };
}

export interface KillProcessTreeOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  timeoutMs?: number;
}

export async function killProcessTree(
  pid: number,
  options: KillProcessTreeOptions = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  if (platform === "win32") {
    const spawnFn = options.spawn ?? nodeSpawn;
    const timeoutMs = options.timeoutMs ?? 5_000;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean): void => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      try {
        const taskkill = spawnFn("taskkill", ["/pid", String(pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });

        const timer = setTimeout(() => {
          try {
            taskkill.kill();
          } catch {
            // ignore
          }
          finish(false);
        }, timeoutMs);

        taskkill.once("error", () => {
          clearTimeout(timer);
          finish(false);
        });

        taskkill.once("close", (code) => {
          clearTimeout(timer);
          finish(code === 0);
        });
      } catch {
        finish(false);
      }
    });
  }

  // POSIX (macOS, Linux) process group termination
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  }
}
