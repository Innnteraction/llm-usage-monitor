export type Locale = "en" | "ko";

export interface TrayMessages {
  open: string;
  refresh: string;
  resetPosition: string;
  launchAtLoginWin: string;
  launchAtLoginMac: string;
  quit: string;
}

export interface ErrorMessages {
  not_installed: string;
  not_authenticated: string;
  workspace_trust_required: string;
  unsupported_output: string;
  rate_limited: string;
  network: string;
  timeout: string;
  process_failed: string;
  unavailable: string;
  unexpected: string;
}

export interface UiMessages {
  appName: string;
  loading: string;
  refreshQuota: string;
  expandDetailed: string;
  collapseCompact: string;
  alwaysOnTop: string;
  toggleTheme: string;
  localSessionTokens: string;
  additionalLimits: (count: number) => string;
  lastSuccessful: (time: string) => string;
}

export interface I18nMessages {
  tray: TrayMessages;
  errors: ErrorMessages;
  ui: UiMessages;
}
