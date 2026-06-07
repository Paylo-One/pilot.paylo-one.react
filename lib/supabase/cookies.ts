/**
 * lib/supabase/cookies.ts
 *
 * Shared cookie options for every Supabase client. The auth cookie MUST be
 * scoped to the registrable apex (e.g. `.lvh.me` locally, `.paylo.one` in prod)
 * with a leading dot so a session established on the apex/auth host is sent to
 * every tenant subdomain `<slug>.<apex>`. Without this, signing in on the apex
 * would not carry the session to `<slug>.lvh.me` and the workspace would appear
 * logged-out.
 */

import { activeApex, isDev } from "@/lib/config";

export interface SupabaseCookieOptions {
  domain: string;
  path: string;
  sameSite: "lax";
  secure: boolean;
}

export function supabaseCookieOptions(): SupabaseCookieOptions {
  return {
    // Leading dot → shared across all subdomains of the apex.
    domain: `.${activeApex()}`,
    path: "/",
    sameSite: "lax",
    // http on localhost (lvh.me) in dev; secure cookies in production.
    secure: !isDev(),
  };
}
