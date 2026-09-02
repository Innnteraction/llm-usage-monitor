import type {
  LocalUsageProviderId,
  LocalUsageScanner,
} from "../shared/index";

export type { LocalUsageProviderId, LocalUsageScanner };

export interface TokenContribution {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LocalUsageFileCheckpoint {
  fileKey: string;
  identity: string;
  size: number;
  mtimeMs: number;
  offset: number;
  boundaryHash: string;
  errorCount?: number;
  observedFrom?: string;
  contribution: TokenContribution;
  lastCumulative?: TokenContribution;
  messages?: Record<string, TokenContribution>;
}

export interface ProviderCheckpointSection {
  files: Record<string, LocalUsageFileCheckpoint>;
}

export interface LocalUsageCheckpointState {
  schemaVersion: 1;
  providers: Record<LocalUsageProviderId, ProviderCheckpointSection>;
}
