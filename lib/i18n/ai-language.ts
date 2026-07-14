/**
 * lib/i18n/ai-language.ts
 *
 * Threads the user's chosen language into AI execution context (ADR-052,
 * requirement 8) WITHOUT weakening tenant isolation, prompt controls or safety
 * boundaries (requirement 9).
 *
 * Safety design:
 *   - The language is ALWAYS one of our fixed supported locales, mapped to a
 *     hard-coded English endonym (`localeConfig[locale].englishName`). A raw,
 *     user-supplied locale string is never interpolated into a prompt — that
 *     would be a prompt-injection vector. `resolveResponseLanguage` validates
 *     via `resolveLocale` before mapping.
 *   - The directive is a static, tenant-agnostic sentence APPENDED to the
 *     tenant-owned system prompt. It carries no tenant data, and being last it
 *     cannot override the safety/role instructions that precede it. It also
 *     tells the model to preserve names, identifiers and source references
 *     verbatim, so localisation never rewrites provenance.
 *   - English (the default) yields no directive: the base prompts are English,
 *     so there is nothing to add and no tokens are wasted.
 */

import {
  defaultLocale,
  isLocale,
  localeConfig,
  resolveLocale,
} from "@/i18n/config";

/**
 * The safe instruction appended to a system prompt. `languageEnglishName` MUST
 * come from `localeConfig` (a closed set), never from raw request input.
 */
export function languageDirective(languageEnglishName: string): string {
  return (
    `\n\nRespond in ${languageEnglishName}. ` +
    `Translate only your own prose. Keep all names, identifiers, quoted source ` +
    `text, URLs and source references exactly as given, and do not add, drop or ` +
    `alter any facts when changing language.`
  );
}

/**
 * Append the language directive to a system prompt for a given locale. Returns
 * the prompt unchanged for the default (English) locale or an unknown value.
 */
export function withLanguageDirective(systemPrompt: string, locale: string | undefined | null): string {
  const resolved = resolveLocale(locale);
  if (resolved === defaultLocale) return systemPrompt;
  return systemPrompt + languageDirective(localeConfig[resolved].englishName);
}

/**
 * Resolve the active request locale to its English language name for use in an
 * AI prompt. Guarded: outside a request context (e.g. a background/cron run
 * with no cookies) it returns undefined, so callers fall back to English.
 * Returns undefined for English too (no directive needed).
 */
export async function resolveResponseLanguage(): Promise<string | undefined> {
  try {
    // Imported lazily: keeps this module usable in pure/unit contexts and
    // avoids pulling next/headers into non-request code paths.
    const { resolveActiveLocale } = await import("@/i18n/request");
    const locale = await resolveActiveLocale();
    if (!isLocale(locale) || locale === defaultLocale) return undefined;
    return localeConfig[locale].englishName;
  } catch {
    return undefined;
  }
}
