import type { ProviderSnapshot } from "../../shared/index";
import { CodexAppServerClient } from "./appServerClient";
import {
  createCodexErrorSnapshot,
  normalizeCodexSnapshot,
} from "./normalize";
import type {
  CodexAccountResponse,
  CodexRateLimitsResponse,
} from "./protocol";

export interface CodexQuotaClient {
  readAccount(): Promise<CodexAccountResponse>;
  readRateLimits(): Promise<CodexRateLimitsResponse>;
  close(): Promise<void>;
}

export interface CodexQuotaProviderOptions {
  clientFactory?: () => CodexQuotaClient;
  clock?: () => Date;
}

export class CodexQuotaProvider {
  readonly id = "codex" as const;
  private readonly clientFactory: () => CodexQuotaClient;
  private readonly clock: () => Date;

  constructor(options: CodexQuotaProviderOptions = {}) {
    this.clientFactory =
      options.clientFactory ?? (() => new CodexAppServerClient());
    this.clock = options.clock ?? (() => new Date());
  }

  async fetchQuota(): Promise<ProviderSnapshot> {
    let client: CodexQuotaClient | undefined;
    try {
      client = this.clientFactory();
      const account = await client.readAccount();
      const requiresLogin =
        account.requiresOpenaiAuth && account.account === null;
      const rateLimits = requiresLogin
        ? undefined
        : await client.readRateLimits();
      return normalizeCodexSnapshot({
        account,
        rateLimits,
        fetchedAt: this.clock(),
      });
    } catch (error) {
      return createCodexErrorSnapshot(error, this.clock());
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
}
