/**
 * i18n/load.ts
 *
 * Filesystem message loading for next-intl (no-URL-routing mode). Messages live
 * at `messages/<locale>/<namespace>.json`; each non-`_`-prefixed `*.json` file
 * is one namespace (keyed by filename). English is the source of truth and the
 * guaranteed per-key fallback (ADR-046): for any non-English locale we load the
 * English base and DEEP-MERGE the locale on top, so a key missing from a draft
 * locale transparently renders its English string.
 *
 * Loading is memoised per locale (a module-level Map) so repeated
 * `getRequestConfig` calls in a single server process do not re-read disk.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultLocale, resolveLocale, type Locale } from "./config";

/** The next-intl message tree: nested namespaces of strings/arrays/objects. */
export type Messages = Record<string, unknown>;

const MESSAGES_DIR = join(process.cwd(), "messages");

/** Read every non-`_`-prefixed `*.json` in a locale folder, keyed by filename. */
function readLocaleMessages(locale: Locale): Messages {
  const dir = join(MESSAGES_DIR, locale);
  const out: Messages = {};
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return out;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const namespace = file.slice(0, -".json".length);
    try {
      out[namespace] = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      // A malformed locale file must never take the app down: skip it and let
      // the English fallback (or the governance check) surface the problem.
    }
  }
  return out;
}

/**
 * Deep-merge `override` onto `base`, returning a new object. Plain objects are
 * merged key-by-key; every other value (including ARRAYS) is replaced wholesale
 * by the override when present — so a translated list replaces the English one
 * rather than concatenating with it (ADR-046).
 */
function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const cache = new Map<Locale, Messages>();

/**
 * Load the full message tree for `locale` with English per-key fallback.
 * Unknown/invalid locales coerce to the default via `resolveLocale`.
 */
export function loadMessages(locale: string): Messages {
  const resolved = resolveLocale(locale);
  const cached = cache.get(resolved);
  if (cached) return cached;

  const base = readLocaleMessages(defaultLocale);
  const messages =
    resolved === defaultLocale
      ? base
      : (deepMerge(base, readLocaleMessages(resolved)) as Messages);

  cache.set(resolved, messages);
  return messages;
}

/** Test-only: clear the per-locale memo. */
export function __clearMessageCache(): void {
  cache.clear();
}
