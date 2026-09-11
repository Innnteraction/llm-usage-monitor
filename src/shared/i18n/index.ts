import { en } from "./locales/en";
import { ko } from "./locales/ko";
import type { I18nMessages, Locale } from "./types";

export * from "./types";
export { en } from "./locales/en";
export { ko } from "./locales/ko";

export const LOCALES: Record<Locale, I18nMessages> = {
  en,
  ko,
};

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Detects the system locale from environment or system properties.
 * Designed to support future multi-language auto-detection while
 * maintaining English as the safe layout baseline.
 */
export function detectSystemLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  const lang = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  if (lang.toLowerCase().startsWith("ko")) {
    // Open for future Korean enablement, but currently English is canonical layout default.
    return "en";
  }
  return DEFAULT_LOCALE;
}

export function getMessages(locale: Locale = DEFAULT_LOCALE): I18nMessages {
  return LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE];
}
