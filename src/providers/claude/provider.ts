import { execFile } from "node:child_process";
import { z } from "zod";
import {
  resolveCliBinary,
  type ProviderAuthKind,
  type ProviderSnapshot,
} from "../../shared/index";
import {
  createClaudeUnexpectedSnapshot,
  normalizeClaudeSnapshot,
  type ClaudeAccountContext,
} from "./normalize";
import { runClaudeUsageProbe, type ClaudePtyProbeResult } from "./ptyProbe";

export interface ClaudeQuotaProviderOptions {
  probe?: () => Promise<ClaudePtyProbeResult>;
  accountReader?: () => Promise<ClaudeAccountContext | undefined>;
  clock?: () => Date;
}

const claudeAuthStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    email: z.string().email().max(80).nullable().optional(),
    authMethod: z.string().max(80).nullable().optional(),
    apiProvider: z.string().max(80).nullable().optional(),
    subscriptionType: z.string().max(80).nullable().optional(),
  })
  .passthrough();

export function parseClaudeAuthStatus(
  raw: string,
): ClaudeAccountContext | undefined {
  try {
    const status = claudeAuthStatusSchema.parse(JSON.parse(raw));
    if (!status.loggedIn) {
      return undefined;
    }
    return {
      ...(status.email ? { accountLabel: status.email } : {}),
      authKind: classifyClaudeAuthKind(status),
    };
  } catch {
    return undefined;
  }
}

const classifyClaudeAuthKind = (
  status: z.infer<typeof claudeAuthStatusSchema>,
): ProviderAuthKind => {
  const signal = [
    status.authMethod,
    status.apiProvider,
    status.subscriptionType,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  if (/bedrock|vertex|foundry|enterprise|sso/.test(signal)) {
    return "enterprise";
  }
  if (/api.?key|console|payg/.test(signal)) {
    return "api_key";
  }
  if (/oauth|claude.?ai|subscription|pro|max|team/.test(signal)) {
    return "subscription";
  }
  return "unknown";
};

export function readClaudeAccountContext(
  command = resolveCliBinary("claude"),
): Promise<ClaudeAccountContext | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["auth", "status", "--json"],
      { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        resolve(
          error ? undefined : parseClaudeAuthStatus(stdout),
        );
      },
    );
  });
}

export class ClaudeQuotaProvider {
  readonly id = "claude" as const;
  private readonly probe: () => Promise<ClaudePtyProbeResult>;
  private readonly accountReader: () => Promise<
    ClaudeAccountContext | undefined
  >;
  private readonly clock: () => Date;

  constructor(options: ClaudeQuotaProviderOptions = {}) {
    this.probe = options.probe ?? (() => runClaudeUsageProbe());
    this.accountReader =
      options.accountReader ?? (() => readClaudeAccountContext());
    this.clock = options.clock ?? (() => new Date());
  }

  async fetchQuota(): Promise<ProviderSnapshot> {
    try {
      const [result, account] = await Promise.all([
        this.probe(),
        this.accountReader().catch(() => undefined),
      ]);
      return normalizeClaudeSnapshot(result, this.clock(), account);
    } catch {
      return createClaudeUnexpectedSnapshot(this.clock());
    }
  }
}
