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

export const IPC_CHANNELS = {
  getState: "usage-monitor:get-state",
  refresh: "usage-monitor:refresh",
  stateChanged: "usage-monitor:state-changed",
  getPreferences: "usage-monitor:get-preferences",
  setLaunchAtLogin: "usage-monitor:set-launch-at-login",
  setTokensVisible: "usage-monitor:set-tokens-visible",
  openClaudeSetup: "usage-monitor:open-claude-setup",
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
  })
  .strict();
export const openClaudeSetupPayloadSchema = z
  .object({ action: claudeSetupActionSchema })
  .strict();
export const openClaudeSetupResultSchema = z
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
  setTokensVisible(visible: boolean): Promise<void>;
  openClaudeSetup(action: ClaudeSetupAction): Promise<{ opened: boolean }>;
}
