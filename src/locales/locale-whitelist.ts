export const SUPPORTED_LOCALES = ["zh-CN"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

export function normalizeLocale(locale?: string | null): SupportedLocale | null {
  return locale ? DEFAULT_LOCALE : null;
}

export function resolveAppLocale(): SupportedLocale {
  return DEFAULT_LOCALE;
}
