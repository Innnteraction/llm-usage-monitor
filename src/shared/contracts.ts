import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const tokenCountSchema = z.number().int().nonnegative().safe();

export const providerIdSchema = z.enum(["codex", "claude", "antigravity"]);
export type ProviderId = z.infer<typeof providerIdSchema>;
export type LocalUsageProviderId = Extract<ProviderId, "codex" | "claude">;

export const quotaKindSchema = z.enum([
  "five_hour",
  "weekly",
  "model_weekly",
  "other",
]);
export type QuotaKind = z.infer<typeof quotaKindSchema>;

export const snapshotStatusSchema = z.enum([
  "fresh",
  "stale",
  "unavailable",
]);
export type SnapshotStatus = z.infer<typeof snapshotStatusSchema>;

export const providerAuthKindSchema = z.enum([
  "subscription",
  "api_key",
  "enterprise",
  "unknown",
]);
export type ProviderAuthKind = z.infer<typeof providerAuthKindSchema>;

export const providerSourceSchema = z.enum([
  "codex_app_server",
  "claude_cli",
  "antigravity_cli",
  "local_fixture",
]);
export type ProviderSource = z.infer<typeof providerSourceSchema>;

export const providerErrorSchema = z
  .object({
    code: z.enum([
      "not_installed",
      "not_authenticated",
      "workspace_trust_required",
      "unsupported_output",
      "rate_limited",
      "network",
      "timeout",
      "process_failed",
      "unavailable",
      "unexpected",
    ]),
    message: z.string().min(1).max(240),
    retryAt: timestampSchema.optional(),
  })
  .strict();
export type ProviderError = z.infer<typeof providerErrorSchema>;

export const quotaWindowSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: quotaKindSchema,
    label: z.string().min(1).max(80),
    usedPercent: z.number().min(0).max(100).optional(),
    resetsAt: timestampSchema.optional(),
    source: providerSourceSchema,
    status: snapshotStatusSchema,
  })
  .strict();
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;

export const localTokenUsageSchema = z
  .object({
    scope: z.literal("local_device"),
    scannedFileCount: z.number().int().nonnegative(),
    failedFileCount: z.number().int().nonnegative(),
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    cacheReadTokens: tokenCountSchema.optional(),
    cacheWriteTokens: tokenCountSchema.optional(),
    totalTokens: tokenCountSchema,
    partial: z.boolean(),
    calculatedAt: timestampSchema,
    observedFrom: timestampSchema.optional(),
  })
  .strict();
export type LocalTokenUsage = z.infer<typeof localTokenUsageSchema>;

export interface LocalUsageScanner {
  readonly providerId: LocalUsageProviderId;
  scan(signal: AbortSignal): Promise<LocalTokenUsage>;
  watch(onDirty: () => void): () => void;
}

export const providerSnapshotSchema = z
  .object({
    providerId: providerIdSchema,
    accountLabel: z.string().min(1).max(80).optional(),
    authKind: providerAuthKindSchema.optional(),
    status: snapshotStatusSchema,
    fetchedAt: timestampSchema,
    lastSuccessfulAt: timestampSchema.optional(),
    quotaWindows: z.array(quotaWindowSchema),
    localUsage: localTokenUsageSchema.optional(),
    error: providerErrorSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = snapshot.quotaWindows.map((window) => window.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Quota window IDs must be unique within a provider",
        path: ["quotaWindows"],
      });
    }
  });
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;

export const appSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    providers: z.array(providerSnapshotSchema),
    refreshing: z.array(providerIdSchema),
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const providerIds = snapshot.providers.map((provider) => provider.providerId);
    if (new Set(providerIds).size !== providerIds.length) {
      context.addIssue({
        code: "custom",
        message: "Provider IDs must be unique",
        path: ["providers"],
      });
    }
  });
export type AppSnapshot = z.infer<typeof appSnapshotSchema>;

export const userPreferencesSchema = z
  .object({
    launchAtLogin: z.boolean(),
    alwaysOnTop: z.boolean().optional(),
  })
  .strict();
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
