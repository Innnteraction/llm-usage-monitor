import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  providerSnapshotSchema,
  type ProviderSnapshot,
} from "../../shared/index";
import {
  AntigravityCliRunner,
  AntigravityProcessError,
  type AntigravityProcessRunner,
} from "./processRunner";
import {
  AntigravityUsageParseError,
  parseAntigravityUsageReport,
} from "./usageParser";

const ERROR_MESSAGES: Record<
  "not_installed" | "not_authenticated" | "unsupported_output" | "rate_limited" | "network" | "timeout" | "process_failed",
  string
> = {
  not_installed: "Install the Antigravity CLI to view quota.",
  not_authenticated: "Sign in with the Antigravity CLI to view quota.",
  unsupported_output: "Antigravity CLI returned an unsupported quota response.",
  rate_limited: "Antigravity CLI rate limited the quota request.",
  network: "Antigravity CLI could not reach its service.",
  timeout: "Antigravity CLI did not respond before the timeout.",
  process_failed: "Antigravity CLI stopped during quota refresh.",
};

const MAX_LOG_TAIL_BYTES = 20_480;

export function extractAccountFromLog(text: string): string | undefined {
  const matches = [
    ...text.matchAll(/applyAuthResult:\s*email=([^\s,]+)/g),
    ...text.matchAll(/OAuth:\s*authenticated successfully as ([^\s,]+)/g),
  ];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    if (last && last[1]) {
      const email = last[1].trim();
      if (email.includes("@") && email.length <= 80) {
        return email;
      }
    }
  }
  return undefined;
}

export async function readDefaultAntigravityAccountLabel(): Promise<string | undefined> {
  try {
    const logPath = path.join(homedir(), ".gemini", "antigravity-cli", "cli.log");
    const fileStat = await stat(logPath);
    if (fileStat.size === 0) {
      return undefined;
    }
    const readLength = Math.min(fileStat.size, MAX_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(readLength);
    const fd = await open(logPath, "r");
    try {
      await fd.read(buffer, 0, readLength, fileStat.size - readLength);
    } finally {
      await fd.close();
    }
    return extractAccountFromLog(buffer.toString("utf8"));
  } catch {
    return undefined;
  }
}

export interface AntigravityQuotaProviderOptions {
  runnerFactory?: () => AntigravityProcessRunner;
  accountReader?: () => Promise<string | undefined>;
  clock?: () => Date;
}

export class AntigravityQuotaProvider {
  readonly id = "antigravity" as const;
  private readonly runnerFactory: () => AntigravityProcessRunner;
  private readonly accountReader: () => Promise<string | undefined>;
  private readonly clock: () => Date;
  private readonly activeRunners = new Set<AntigravityProcessRunner>();
  private closed = false;

  constructor(options: AntigravityQuotaProviderOptions = {}) {
    this.runnerFactory = options.runnerFactory ?? (() => new AntigravityCliRunner());
    this.accountReader = options.accountReader ?? readDefaultAntigravityAccountLabel;
    this.clock = options.clock ?? (() => new Date());
  }

  async fetchQuota(): Promise<ProviderSnapshot> {
    if (this.closed) {
      return this.failureSnapshot(this.clock().toISOString(), "process_failed");
    }

    let runner: AntigravityProcessRunner | undefined;
    try {
      runner = this.runnerFactory();
      if (this.closed) {
        return this.failureSnapshot(this.clock().toISOString(), "process_failed");
      }
      this.activeRunners.add(runner);
      const report = parseAntigravityUsageReport(await runner.readUsage());
      const accountLabel = report.accountLabel ?? (await this.accountReader());
      const fetchedAt = this.clock().toISOString();
      return providerSnapshotSchema.parse({
        providerId: this.id,
        status: "fresh",
        fetchedAt,
        lastSuccessfulAt: fetchedAt,
        quotaWindows: report.quotaWindows,
        ...(accountLabel ? { accountLabel } : {}),
      });
    } catch (error) {
      return this.failureSnapshot(this.clock().toISOString(), errorCode(error));
    } finally {
      if (runner) {
        try {
          await runner.close();
        } catch {
          // The runner's process error has already been mapped to a snapshot.
        } finally {
          this.activeRunners.delete(runner);
        }
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.activeRunners].map((runner) => runner.close()));
  }

  private failureSnapshot(
    fetchedAt: string,
    code: keyof typeof ERROR_MESSAGES,
  ): ProviderSnapshot {
    return providerSnapshotSchema.parse({
      providerId: this.id,
      status: "unavailable",
      fetchedAt,
      quotaWindows: [],
      error: { code, message: ERROR_MESSAGES[code] },
    });
  }
}

export function createAntigravityInitialSnapshot(
  fetchedAt: Date,
): ProviderSnapshot {
  return providerSnapshotSchema.parse({
    providerId: "antigravity",
    status: "unavailable",
    fetchedAt: fetchedAt.toISOString(),
    quotaWindows: [],
  });
}

function errorCode(error: unknown): keyof typeof ERROR_MESSAGES {
  if (error instanceof AntigravityUsageParseError) {
    return "unsupported_output";
  }
  if (error instanceof AntigravityProcessError) {
    return error.reason === "unsupported" ? "unsupported_output" : error.reason;
  }
  return "process_failed";
}
