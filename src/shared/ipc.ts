import { z } from "zod";
import {
  appSnapshotSchema,
  providerIdSchema,
  userPreferencesSchema,
  type AppSnapshot,
  type ProviderId,
  type UserPreferences,
} from "./contracts";

export const IPC_CHANNELS = {
  getState: "usage-monitor:get-state",
  refresh: "usage-monitor:refresh",
  stateChanged: "usage-monitor:state-changed",
  getPreferences: "usage-monitor:get-preferences",
  setLaunchAtLogin: "usage-monitor:set-launch-at-login",
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

export const refreshResultSchema = z.void();
export { appSnapshotSchema, userPreferencesSchema };

export interface UsageMonitorAPI {
  getState(): Promise<AppSnapshot>;
  refresh(providerId?: ProviderId): Promise<void>;
  subscribe(listener: (state: AppSnapshot) => void): () => void;
  getPreferences(): Promise<UserPreferences>;
  setLaunchAtLogin(enabled: boolean): Promise<UserPreferences>;
}
