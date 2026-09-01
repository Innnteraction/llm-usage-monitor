import { z } from "zod";

export const CODEX_ACCOUNT_READ_METHOD = "account/read" as const;
export const CODEX_RATE_LIMITS_READ_METHOD = "account/rateLimits/read" as const;

export const codexAccountReadParamsSchema = z
  .object({ refreshToken: z.literal(false).optional() })
  .strict();
export const codexRateLimitsReadParamsSchema = z.object({}).strict();

const rawCodexAccountSchema = z
  .object({
    type: z.string().min(1),
    planType: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const rawCodexAccountResponseSchema = z.object({
  account: rawCodexAccountSchema.nullable().optional(),
  requiresOpenaiAuth: z.boolean(),
});

export const codexAccountSummarySchema = z
  .object({
    type: z.string().min(1),
    planType: z.string().min(1).optional(),
  })
  .strict();

export const codexAccountResponseSchema = rawCodexAccountResponseSchema.transform(
  ({ account, requiresOpenaiAuth }) => ({
    account:
      account == null
        ? null
        : codexAccountSummarySchema.parse({
            type: account.type,
            ...(account.planType == null ? {} : { planType: account.planType }),
          }),
    requiresOpenaiAuth,
  }),
);

export const codexRateLimitWindowSchema = z.object({
  usedPercent: z.number().int().min(0).max(100),
  resetsAt: z.number().int().nonnegative().nullable().optional(),
  windowDurationMins: z.number().int().positive().nullable().optional(),
});

export const codexRateLimitSnapshotSchema = z.object({
  primary: codexRateLimitWindowSchema.nullable().optional(),
  secondary: codexRateLimitWindowSchema.nullable().optional(),
  limitId: z.string().min(1).nullable().optional(),
  limitName: z.string().min(1).nullable().optional(),
  planType: z.string().min(1).nullable().optional(),
});

export const codexRateLimitsResponseSchema = z.object({
  rateLimits: codexRateLimitSnapshotSchema,
  rateLimitsByLimitId: z
    .record(z.string(), codexRateLimitSnapshotSchema)
    .nullable()
    .optional(),
});

export type CodexAccountReadParams = z.infer<
  typeof codexAccountReadParamsSchema
>;
export type CodexRateLimitsReadParams = z.infer<
  typeof codexRateLimitsReadParamsSchema
>;
export type CodexAccountSummary = z.infer<typeof codexAccountSummarySchema>;
export type CodexAccountResponse = z.output<
  typeof codexAccountResponseSchema
>;
export type CodexRateLimitWindow = z.infer<
  typeof codexRateLimitWindowSchema
>;
export type CodexRateLimitSnapshot = z.infer<
  typeof codexRateLimitSnapshotSchema
>;
export type CodexRateLimitsResponse = z.infer<
  typeof codexRateLimitsResponseSchema
>;
