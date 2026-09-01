import type { ProviderSnapshot } from "../../shared/index";
import {
  createClaudeUnexpectedSnapshot,
  normalizeClaudeSnapshot,
} from "./normalize";
import { runClaudeUsageProbe, type ClaudePtyProbeResult } from "./ptyProbe";

export interface ClaudeQuotaProviderOptions {
  probe?: () => Promise<ClaudePtyProbeResult>;
  clock?: () => Date;
}

export class ClaudeQuotaProvider {
  readonly id = "claude" as const;
  private readonly probe: () => Promise<ClaudePtyProbeResult>;
  private readonly clock: () => Date;

  constructor(options: ClaudeQuotaProviderOptions = {}) {
    this.probe = options.probe ?? (() => runClaudeUsageProbe());
    this.clock = options.clock ?? (() => new Date());
  }

  async fetchQuota(): Promise<ProviderSnapshot> {
    try {
      return normalizeClaudeSnapshot(await this.probe(), this.clock());
    } catch {
      return createClaudeUnexpectedSnapshot(this.clock());
    }
  }
}
