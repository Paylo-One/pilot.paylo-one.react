/**
 * lib/i18n/locale-cookie.ts
 *
 * Shared handling for the durable `NEXT_LOCALE` cookie. Like the Supabase auth
 * cookie (see lib/supabase/cookies.ts), it is scoped to the registrable apex
 * with a leading dot so a preference set on the auth host is carried to every
 * tenant subdomain `<slug>.<apex>` — otherwise the language chosen at sign-in
 * would not follow the user into their workspace.
 *
 * The DB (`user_profiles.locale`) is the source of truth; this cookie is a fast,
 * cross-subdomain mirror re-seeded from the profile at login.
 */

import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeApex, isDev } from "@/lib/config";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from "@/i18n/config";

export function localeCookieOptions() {
  return {
    domain: `.${activeApex()}`,
    path: "/",
    sameSite: "lax" as const,
    secure: !isDev(),
    maxAge: LOCALE_COOKIE_MAX_AGE,
    // Not httpOnly: the language selector (client) may read it for optimistic UI.
    httpOnly: false,
  };
}

/** Set the locale cookie on an outgoing response (e.g. a login redirect). */
export function setLocaleCookieOnResponse(response: NextResponse, locale: Locale): void {
  response.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions());
}

/**
 * Read a user's stored locale preference. Uses whatever client is passed
 * (RLS-scoped user client at login is fine — a user can always read their own
 * profile row). Returns null when unset or unsupported.
 */
export async function readProfileLocale(
  supabase: SupabaseClient,
  userId: string,
): Promise<Locale | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("locale")
    .eq("user_id", userId)
    .maybeSingle();
  const value = (data as { locale?: string | null } | null)?.locale;
  return isLocale(value) ? value : null;
}

/**
 * Seed the locale cookie on a login redirect from the user's stored preference.
 * Best-effort: any failure (no profile yet, transient DB error) leaves the
 * cookie untouched so request-time Accept-Language negotiation still applies.
 */
export async function seedLocaleCookieFromProfile(
  supabase: SupabaseClient,
  userId: string,
  response: NextResponse,
): Promise<void> {
  try {
    const locale = await readProfileLocale(supabase, userId);
    if (locale) setLocaleCookieOnResponse(response, locale);
  } catch {
    // Non-fatal: the app still resolves a locale from Accept-Language / default.
  }
}
