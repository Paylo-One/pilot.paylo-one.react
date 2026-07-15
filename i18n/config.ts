/**
 * Canonical locale configuration for Paylo.one internationalisation (ADR-046).
 *
 * This file is the SINGLE source of supported languages. Adding a new language
 * is intended to be a content task: add its entry here and drop in the
 * `messages/<locale>/*.json` files — no other code changes are required
 * (routing, detection, the language selector, SEO alternates, the sitemap and
 * the governance checks all derive from this list).
 *
 * Keep this file identical between the pilot and marketing repositories; the
 * `shared` message namespace is synced across repos by
 * `scripts/sync-shared-messages.mjs`.
 */

/**
 * Cookie carrying the resolved locale. Written on login / settings-save from
 * `user_profiles.locale` and read first by i18n/request.ts (see that file for
 * the full resolution precedence). One year, lax, path=/ — it is a durable
 * preference, not a session token, and carries no sensitive data.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

/** Supported locale identifiers (used in URLs, cookies, message folders). */
export const locales = ["en", "nl", "de", "fr", "no", "da", "es"] as const;

export type Locale = (typeof locales)[number];

/** English is the human-owned source of truth and the guaranteed fallback. */
export const defaultLocale: Locale = "en";

export interface LocaleMeta {
  /** Endonym — the language's own name, shown in the selector (never a flag). */
  label: string;
  /** English exonym, for accessibility / secondary labelling. */
  englishName: string;
  /**
   * BCP-47 tag used for `Intl` formatting (dates/numbers/currencies/plurals).
   * May differ from the locale id (e.g. `no` → `nb-NO`).
   */
  formatLocale: string;
  /** Text direction. All current locales are LTR; kept for future RTL. */
  dir: "ltr" | "rtl";
  /**
   * Default currency for generic locale-currency formatting. Product prices are
   * always quoted explicitly in EUR (see pricing content); this is the default
   * used only when a currency is not otherwise specified.
   */
  currency: string;
}

export const localeConfig: Record<Locale, LocaleMeta> = {
  en: { label: "English", englishName: "English", formatLocale: "en-GB", dir: "ltr", currency: "EUR" },
  nl: { label: "Nederlands", englishName: "Dutch", formatLocale: "nl-NL", dir: "ltr", currency: "EUR" },
  de: { label: "Deutsch", englishName: "German", formatLocale: "de-DE", dir: "ltr", currency: "EUR" },
  fr: { label: "Français", englishName: "French", formatLocale: "fr-FR", dir: "ltr", currency: "EUR" },
  no: { label: "Norsk", englishName: "Norwegian", formatLocale: "nb-NO", dir: "ltr", currency: "EUR" },
  da: { label: "Dansk", englishName: "Danish", formatLocale: "da-DK", dir: "ltr", currency: "EUR" },
  es: { label: "Español", englishName: "Spanish", formatLocale: "es-ES", dir: "ltr", currency: "EUR" },
};

/** Type guard: is an arbitrary string one of our supported locales? */
export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** Coerce any candidate to a supported locale, falling back to English. */
export function resolveLocale(candidate: string | undefined | null): Locale {
  return isLocale(candidate) ? candidate : defaultLocale;
}

/** The BCP-47 tag to hand to `Intl.*` for a given locale. */
export function formatLocaleFor(locale: string): string {
  return isLocale(locale) ? localeConfig[locale].formatLocale : localeConfig[defaultLocale].formatLocale;
}
