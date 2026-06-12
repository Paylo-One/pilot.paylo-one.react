/**
 * lib/supabase/proxy.ts
 *
 * Session refresh for the edge proxy (middleware). Bridges Supabase auth cookies
 * between the incoming request and the outgoing response, and refreshes the
 * session by calling `getClaims()` (validates the JWT signature). Returns the
 * verified claims (or null) so the proxy can make coarse auth decisions.
 *
 * Only `getClaims()` is trusted in proxy/server code; `getSession()` is not.
 */

import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { supabaseUrl, supabasePublishableKey } from "@/lib/config";
import { supabaseCookieOptions } from "./cookies";

export interface VerifiedClaims {
  /** Supabase auth user id (sub claim). */
  readonly sub: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

/**
 * Refresh the Supabase session, writing any rotated cookies onto `response`.
 * Returns verified claims or null when there is no valid session.
 */
export async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<VerifiedClaims | null> {
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    return (data?.claims as VerifiedClaims | undefined) ?? null;
  } catch {
    // A stale, rotated, or corrupt session (e.g. leftover cookie chunks after a
    // flow change) makes getClaims throw `refresh_token_not_found`. Treat it as
    // logged-out AND clear the auth cookies so the bad state self-heals instead
    // of bouncing the user between the workspace and sign-in. Clearing uses the
    // same apex domain/path the cookies were written with so the delete matches.
    const base = supabaseCookieOptions();
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.set(cookie.name, "", { ...base, maxAge: 0 });
      }
    }
    return null;
  }
}
