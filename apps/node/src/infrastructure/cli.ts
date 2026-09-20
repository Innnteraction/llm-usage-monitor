import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { resolveCliBinary } from "../shared/index";

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
