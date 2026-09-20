import {
  spawn as nodeSpawn,
  type SpawnOptions,
} from "node:child_process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCliBinaryPath } from "../../infrastructure/index";

const VERSION_ARGS = ["--version"] as const;
const USAGE_ARGS = [
  "--print",
  "/usage",
  "--output-format",
  "json",
  "--print-timeout",
  "20s",
] as const;
const VERSION_TIMEOUT_MS = 5_000;
const USAGE_TIMEOUT_MS = 25_000;
const TASKKILL_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

export type AntigravityProcessFailure =
  | "not_installed"
  | "not_authenticated"
  | "rate_limited"
  | "network"
  | "timeout"
  | "unsupported"
  | "process_failed";

const ERROR_MESSAGES: Record<AntigravityProcessFailure, string> = {
  not_installed: "Antigravity CLI is not installed or is not available on PATH.",
  not_authenticated: "Sign in with the Antigravity CLI to view quota.",
  rate_limited: "Antigravity CLI rate limited the quota request.",
  network: "Antigravity CLI could not reach its service.",
  timeout: "Antigravity CLI did not respond before the timeout.",
  unsupported: "Antigravity CLI returned an unsupported response.",
  process_failed: "Antigravity CLI stopped during quota refresh.",
};

export class AntigravityProcessError extends Error {
  constructor(readonly reason: AntigravityProcessFailure) {
    super(ERROR_MESSAGES[reason]);
    this.name = "AntigravityProcessError";
  }
}

export interface AntigravityProcessRunner {
  readUsage(): Promise<string>;
  close(): Promise<void>;
}

interface OutputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

export interface AntigravityChildProcess {
  readonly pid?: number;
  readonly stdout?: OutputStream | null;
  readonly stderr?: OutputStream | null;
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  once(event: "close", listener: (code: number | null) => void): void;
  kill(): boolean;
}

export type AntigravitySpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => AntigravityChildProcess;

export interface AntigravityCliRunnerOptions {
  spawn?: AntigravitySpawn;
  command?: string;
  platform?: NodeJS.Platform;
  createTempDirectory?: () => Promise<string>;
  removeEmptyDirectory?: (directory: string) => Promise<void>;
  versionTimeoutMs?: number;
  usageTimeoutMs?: number;
  taskkillTimeoutMs?: number;
}

export class AntigravityCliRunner implements AntigravityProcessRunner {
  private readonly spawn: AntigravitySpawn;
  private readonly command: string;
  private readonly platform: NodeJS.Platform;
  private readonly createTempDirectory: () => Promise<string>;
  private readonly removeEmptyDirectory: (directory: string) => Promise<void>;
  private readonly versionTimeoutMs: number;
  private readonly usageTimeoutMs: number;
  private readonly taskkillTimeoutMs: number;
  private activeStop?: (reason: AntigravityProcessFailure) => Promise<void>;
  private readPromise?: Promise<string>;
  private closed = false;

  constructor(options: AntigravityCliRunnerOptions = {}) {
    this.spawn = options.spawn ?? createNodeSpawn;
    this.platform = options.platform ?? process.platform;
    this.command =
      options.command ??
      resolveCliBinaryPath("antigravity", { platform: this.platform });
    this.createTempDirectory =
      options.createTempDirectory ??
      (() => mkdtemp(path.join(tmpdir(), "llm-usage-monitor-agy-")));
    this.removeEmptyDirectory =
      options.removeEmptyDirectory ?? ((directory) => rmdir(directory));
    this.versionTimeoutMs = options.versionTimeoutMs ?? VERSION_TIMEOUT_MS;
    this.usageTimeoutMs = options.usageTimeoutMs ?? USAGE_TIMEOUT_MS;
    this.taskkillTimeoutMs = options.taskkillTimeoutMs ?? TASKKILL_TIMEOUT_MS;
  }

  readUsage(): Promise<string> {
    if (this.closed) {
      return Promise.reject(new AntigravityProcessError("process_failed"));
    }
    if (this.readPromise) {
      return this.readPromise;
    }
    const operation = this.readUsageInternal();
    this.readPromise = operation;
    void operation
      .finally(() => {
        if (this.readPromise === operation) {
          this.readPromise = undefined;
        }
      })
      .catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.activeStop?.("process_failed");
    await this.readPromise?.catch(() => undefined);
  }

  private async readUsageInternal(): Promise<string> {
    let directory: string | undefined;
    try {
      directory = await this.createTempDirectory();
      this.throwIfClosed();

      const version = await this.runCommand(
        VERSION_ARGS,
        directory,
        this.versionTimeoutMs,
      );
      if (!isSupportedVersion(version.stdout)) {
        throw new AntigravityProcessError("unsupported");
      }
      this.throwIfClosed();

      const usage = await this.runCommand(
        USAGE_ARGS,
        directory,
        this.usageTimeoutMs,
      );
      if (!isUsageJson(usage.stdout)) {
        throw new AntigravityProcessError("unsupported");
      }
      return usage.stdout;
    } catch (error) {
      if (error instanceof AntigravityProcessError) {
        throw error;
      }
      throw new AntigravityProcessError("process_failed");
    } finally {
      if (directory) {
        try {
          await this.removeEmptyDirectory(directory);
        } catch {
          // Preserve non-empty or otherwise unknown CLI-created contents.
        }
      }
    }
  }

  private throwIfClosed(): void {
    if (this.closed) {
      throw new AntigravityProcessError("process_failed");
    }
  }

  private runCommand(
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let stopping: Promise<void> | undefined;
      let child: AntigravityChildProcess;

      const finish = (error?: AntigravityProcessError): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.activeStop = undefined;
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: Buffer.concat(stdout).toString("utf8") });
        }
      };

      const stop = (reason: AntigravityProcessFailure): Promise<void> => {
        if (settled || stopping) {
          return stopping ?? Promise.resolve();
        }
        stopping = (async () => {
          const treeTerminated = await (child.pid === undefined
            ? Promise.resolve(true)
            : this.terminateOwnedTree(child.pid));
          try {
            controller.abort();
          } catch {
            // The child may already be gone after taskkill.
          }
          try {
            child.kill();
          } catch {
            // The child may already be gone after taskkill.
          }
          finish(
            new AntigravityProcessError(
              treeTerminated ? reason : "process_failed",
            ),
          );
        })();
        return stopping;
      };
      const timer = setTimeout(() => {
        void stop("timeout");
      }, timeoutMs);

      try {
        child = this.spawn(this.command, args, {
          cwd,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          signal: controller.signal,
        });
      } catch (error) {
        finish(
          new AntigravityProcessError(
            isMissingExecutable(error) ? "not_installed" : "process_failed",
          ),
        );
        return;
      }

      this.activeStop = stop;
      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (settled || stopping) {
          return;
        }
        const bytes = asBuffer(chunk);
        stdoutBytes += bytes.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          void stop("unsupported");
          return;
        }
        stdout.push(bytes);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (settled || stopping) {
          return;
        }
        const bytes = asBuffer(chunk);
        stderrBytes += bytes.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          void stop("unsupported");
          return;
        }
        stderr.push(bytes);
      });
      child.once("error", (error) => {
        if (!settled) {
          void stop(
            isMissingExecutable(error)
              ? "not_installed"
              : classifyOutput(Buffer.concat(stderr).toString("utf8")),
          );
        }
      });
      child.once("close", (code) => {
        if (settled || stopping) {
          return;
        }
        if (code === 0) {
          finish();
          return;
        }
        finish(
          new AntigravityProcessError(
            classifyOutput(
              `${Buffer.concat(stdout).toString("utf8")}\n${Buffer.concat(stderr).toString("utf8")}`,
            ),
          ),
        );
      });
    });
  }

  private terminateOwnedTree(pid: number | undefined): Promise<boolean> {
    if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
      return Promise.resolve(false);
    }
    if (this.platform !== "win32") {
      try {
        process.kill(-pid, "SIGKILL");
        return Promise.resolve(true);
      } catch {
        try {
          process.kill(pid, "SIGKILL");
          return Promise.resolve(true);
        } catch {
          return Promise.resolve(false);
        }
      }
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (success: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(success);
      };

      let taskkill: AntigravityChildProcess;
      const timeout = setTimeout(() => {
        try {
          taskkill.kill();
        } catch {
          // The bounded taskkill helper already exited.
        }
        finish(false);
      }, this.taskkillTimeoutMs);
      try {
        taskkill = this.spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        finish(false);
        return;
      }
      taskkill.once("error", () => finish(false));
      taskkill.once("close", (code) => finish(code === 0));
    });
  }
}

function createNodeSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): AntigravityChildProcess {
  return nodeSpawn(command, args, options);
}

function asBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function isSupportedVersion(value: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major > 1) {
    return true;
  }
  if (major === 1) {
    if (minor > 1) {
      return true;
    }
    if (minor === 1) {
      return patch >= 11;
    }
  }
  return false;
}

function isUsageJson(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function classifyOutput(
  value: string,
): Exclude<AntigravityProcessFailure, "not_installed" | "timeout" | "unsupported"> {
  if (/\b(?:authentication required|auth required|sign in required|signin required|log in required|login required|not authenticated)\b/i.test(value)) {
    return "not_authenticated";
  }
  if (/\b(?:429|rate limit(?:ed)?)\b/i.test(value)) {
    return "rate_limited";
  }
  if (/\b(?:network|connection|offline|dns|unreachable|econn(?:refused|reset)|enotfound)\b/i.test(value)) {
    return "network";
  }
  return "process_failed";
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
