/**
 * i18n/request.ts
 *
 * next-intl request configuration (no-URL-routing mode). The pilot routes
 * TENANTS by subdomain (see proxy.ts) and is authenticated / not indexed, so
 * the locale is NOT a URL prefix — it is resolved per request from preference
 * signals instead.
 *
 * Resolution precedence honoured here:
 *   1. `NEXT_LOCALE` cookie — the durable, cross-device preference. It is
 *      written on login / settings-save from `user_profiles.locale` (see
 *      app/(app)/settings/actions.ts and app/(app)/layout.tsx), so the DB
 *      preference reaches this file as the cookie.
 *   2. `Accept-Language` — negotiated against our supported `locales`.
 *   3. `defaultLocale` (English).
 *
 * Messages are loaded from the filesystem with English per-key fallback
 * (see i18n/load.ts).
 */

import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, locales, type Locale } from "./config";
import { loadMessages } from "./load";

/**
 * Parse an `Accept-Language` header into an ordered list of base language tags
 * (highest q-value first) and return the first that we support.
 */
function negotiateAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    const match = (locales as readonly string[]).find((l) => l === base);
    if (match) return match as Locale;
  }
  return null;
}

export async function resolveActiveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerStore = await headers();
  const negotiated = negotiateAcceptLanguage(headerStore.get("accept-language"));
  if (negotiated) return negotiated;

  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveActiveLocale();
  return { locale, messages: loadMessages(locale) };
});
