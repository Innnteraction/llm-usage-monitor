import { execFile } from "node:child_process";
import { z } from "zod";
import type { ProviderSnapshot } from "../../shared/index";
import {
  createClaudeUnexpectedSnapshot,
  normalizeClaudeSnapshot,
} from "./normalize";
import { runClaudeUsageProbe, type ClaudePtyProbeResult } from "./ptyProbe";

export interface ClaudeQuotaProviderOptions {
  probe?: () => Promise<ClaudePtyProbeResult>;
  accountLabelReader?: () => Promise<string | undefined>;
  clock?: () => Date;
}

const claudeAuthStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    email: z.string().email().max(80).nullable().optional(),
  })
  .passthrough();

export function parseClaudeAuthStatusAccountLabel(
  raw: string,
): string | undefined {
  try {
    const status = claudeAuthStatusSchema.parse(JSON.parse(raw));
    return status.loggedIn ? (status.email ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

export function readClaudeAccountLabel(
  command = process.platform === "win32" ? "claude.exe" : "claude",
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["auth", "status", "--json"],
      { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        resolve(
          error ? undefined : parseClaudeAuthStatusAccountLabel(stdout),
        );
      },
    );
  });
}

export class ClaudeQuotaProvider {
  readonly id = "claude" as const;
  private readonly probe: () => Promise<ClaudePtyProbeResult>;
  private readonly accountLabelReader: () => Promise<string | undefined>;
  private readonly clock: () => Date;

  constructor(options: ClaudeQuotaProviderOptions = {}) {
    this.probe = options.probe ?? (() => runClaudeUsageProbe());
    this.accountLabelReader =
      options.accountLabelReader ?? (() => readClaudeAccountLabel());
    this.clock = options.clock ?? (() => new Date());
  }

  async fetchQuota(): Promise<ProviderSnapshot> {
    try {
      const [result, accountLabel] = await Promise.all([
        this.probe(),
        this.accountLabelReader().catch(() => undefined),
      ]);
      return normalizeClaudeSnapshot(result, this.clock(), accountLabel);
    } catch {
      return createClaudeUnexpectedSnapshot(this.clock());
    }
  }
}
