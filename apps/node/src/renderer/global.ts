import type { UsageMonitorAPI } from "../shared/index";

declare global {
  interface Window {
    usageMonitor: UsageMonitorAPI;
  }
}

export {};
