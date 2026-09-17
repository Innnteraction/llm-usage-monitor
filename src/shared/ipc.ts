import { z } from "zod";
import {
  appSnapshotSchema,
  providerIdSchema,
  userPreferencesSchema,
  type AppSnapshot,
  type ProviderId,
  type UserPreferences,
} from "./contracts";

export const claudeSetupActionSchema = z.enum(["login", "trust_probe"]);
export type ClaudeSetupAction = z.infer<typeof claudeSetupActionSchema>;

export const antigravitySetupActionSchema = z.enum(["login", "switch_account"]);
export type AntigravitySetupAction = z.infer<typeof antigravitySetupActionSchema>;

export const IPC_CHANNELS = {
  getState: "usage-monitor:get-state",
  refresh: "usage-monitor:refresh",
  stateChanged: "usage-monitor:state-changed",
  getPreferences: "usage-monitor:get-preferences",
  setLaunchAtLogin: "usage-monitor:set-launch-at-login",
  setTokensVisible: "usage-monitor:set-tokens-visible",
  openClaudeSetup: "usage-monitor:open-claude-setup",
  openAntigravitySetup: "usage-monitor:open-antigravity-setup",
  getAlwaysOnTop: "usage-monitor:get-always-on-top",
  setAlwaysOnTop: "usage-monitor:set-always-on-top",
  openExternalUrl: "usage-monitor:open-external-url",
} as const;

export const noPayloadSchema = z.tuple([]);
export const refreshPayloadSchema = z
  .object({
    providerId: providerIdSchema.optional(),
  })
  .strict();
export const setLaunchAtLoginPayloadSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export const setTokensVisiblePayloadSchema = z
  .object({
    visible: z.boolean(),
    contentHeight: z.number().finite().int().min(1).max(4096).optional(),
  })
  .strict();
export const setAlwaysOnTopPayloadSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export const alwaysOnTopResultSchema = z
  .object({
    alwaysOnTop: z.boolean(),
  })
  .strict();
export const openClaudeSetupPayloadSchema = z
  .object({ action: claudeSetupActionSchema })
  .strict();
export const openClaudeSetupResultSchema = z
  .object({ opened: z.boolean() })
  .strict();
export const openAntigravitySetupPayloadSchema = z
  .object({ action: antigravitySetupActionSchema })
  .strict();
export const openAntigravitySetupResultSchema = z
  .object({ opened: z.boolean() })
  .strict();
export const openExternalUrlPayloadSchema = z
  .object({
    url: z.string().url().refine((val) => val.startsWith("https://") || val.startsWith("http://"), {
      message: "Only http and https URLs are allowed",
    }),
  })
  .strict();
export const openExternalUrlResultSchema = z
  .object({ opened: z.boolean() })
  .strict();

export const refreshResultSchema = z.void();
export { appSnapshotSchema, userPreferencesSchema };

export interface UsageMonitorAPI {
  getState(): Promise<AppSnapshot>;
  refresh(providerId?: ProviderId): Promise<void>;
  subscribe(listener: (state: AppSnapshot) => void): () => void;
  getPreferences(): Promise<UserPreferences>;
  setLaunchAtLogin(enabled: boolean): Promise<UserPreferences>;
  setTokensVisible(visible: boolean, contentHeight?: number): Promise<void>;
  openClaudeSetup(action: ClaudeSetupAction): Promise<{ opened: boolean }>;
  openAntigravitySetup(action: AntigravitySetupAction): Promise<{ opened: boolean }>;
  getAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  openExternalUrl(url: string): Promise<{ opened: boolean }>;
}
