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

  const { data } = await supabase.auth.getClaims();
  return (data?.claims as VerifiedClaims | undefined) ?? null;
}
