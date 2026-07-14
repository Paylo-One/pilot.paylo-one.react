/**
 * lib/i18n/format.ts
 *
 * Locale-aware formatting for dates, times, numbers, currencies and relative
 * time. Everything is a thin, dependency-free wrapper over the platform `Intl`
 * APIs keyed off a locale's BCP-47 `formatLocale` (see i18n/config.ts), so it
 * works unchanged on the server (RSC / server actions) and in the browser.
 *
 * Rationale (ADR-052): text translation and value formatting are different
 * concerns. next-intl owns message catalogues; this module owns the numbers.
 * Components should NEVER call `toLocaleDateString("en-GB", …)` directly — that
 * hard-codes British English regardless of the user's chosen language. They
 * resolve the active locale (server: `resolveActiveLocale()`; client:
 * `useLocale()`) and pass it here.
 *
 * `Intl` formatter construction is cheap but not free; formatters are memoised
 * by their (locale, options) signature.
 */

import { formatLocaleFor, localeConfig, resolveLocale } from "@/i18n/config";

type FormatterKind = "date" | "number" | "relative";

const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();

function cacheKey(kind: FormatterKind, bcp47: string, options: unknown): string {
  return `${kind}|${bcp47}|${JSON.stringify(options ?? {})}`;
}

function dateFormatter(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const bcp47 = formatLocaleFor(locale);
  const key = cacheKey("date", bcp47, options);
  let fmt = formatterCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(bcp47, options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function numberFormatter(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const bcp47 = formatLocaleFor(locale);
  const key = cacheKey("number", bcp47, options);
  let fmt = formatterCache.get(key) as Intl.NumberFormat | undefined;
  if (!fmt) {
    fmt = new Intl.NumberFormat(bcp47, options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function relativeFormatter(locale: string, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const bcp47 = formatLocaleFor(locale);
  const key = cacheKey("relative", bcp47, options);
  let fmt = formatterCache.get(key) as Intl.RelativeTimeFormat | undefined;
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(bcp47, { numeric: "auto", ...options });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Format a date, e.g. "Tuesday, 14 July" (long weekday + day + month). */
export function formatDate(
  locale: string,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
): string {
  return dateFormatter(locale, options).format(toDate(value));
}

/** Format a date + time in the given (optional) timezone. */
export function formatDateTime(
  locale: string,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return dateFormatter(locale, options).format(toDate(value));
}

/** Format a time-of-day, e.g. "09:30". */
export function formatTime(
  locale: string,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  return dateFormatter(locale, options).format(toDate(value));
}

/** Format a plain number with locale grouping/decimal separators. */
export function formatNumber(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormatter(locale, options).format(value);
}

/**
 * Format a currency amount. Defaults to the locale's configured currency
 * (EUR across all current locales); pass `currency` to override (product
 * prices are always explicitly EUR — see pricing content).
 */
export function formatCurrency(
  locale: string,
  amount: number,
  currency: string = localeConfig[resolveLocale(locale)].currency,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormatter(locale, { style: "currency", currency, ...options }).format(amount);
}

/** Format a percentage; `value` is a ratio (0.42 -> "42%"). */
export function formatPercent(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormatter(locale, { style: "percent", ...options }).format(value);
}

/**
 * Relative time from `value` to `now`, e.g. "in 3 days" / "2 hours ago".
 * Picks the largest sensible unit automatically.
 */
export function formatRelativeTime(
  locale: string,
  value: Date | string | number,
  now: Date | string | number = new Date(),
): string {
  const deltaMs = toDate(value).getTime() - toDate(now).getTime();
  const deltaSec = Math.round(deltaMs / 1000);
  const abs = Math.abs(deltaSec);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  for (const [unit, secondsInUnit] of units) {
    if (abs >= secondsInUnit || unit === "second") {
      const amount = Math.round(deltaSec / secondsInUnit);
      return relativeFormatter(locale).format(amount, unit);
    }
  }
  return relativeFormatter(locale).format(0, "second");
}

/** Join a list into locale-appropriate prose, e.g. "A, B and C". */
export function formatList(
  locale: string,
  items: readonly string[],
  options: Intl.ListFormatOptions = { style: "long", type: "conjunction" },
): string {
  return new Intl.ListFormat(formatLocaleFor(locale), options).format(items);
}

/** Test-only: drop memoised formatters. */
export function __clearFormatterCache(): void {
  formatterCache.clear();
}
