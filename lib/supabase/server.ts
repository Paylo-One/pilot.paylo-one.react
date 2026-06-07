import "server-only";

/**
 * lib/supabase/server.ts
 *
 * Cookie-bound server Supabase client (publishable key, RLS active) for Server
 * Components, Server Actions, and Route Handlers. Reads/writes the auth cookie
 * via next/headers so the request runs as the signed-in user (authenticated
 * role). RLS isolates rows; this client never bypasses it.
 *
 * Protect pages/data with `getClaims()` (validates the JWT signature), never by
 * trusting `getSession()` in server code.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseUrl, supabasePublishableKey } from "@/lib/config";
import { supabaseCookieOptions } from "./cookies";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In Server Components cookies cannot be written; the proxy refreshes
        // and persists the session, so ignore the failure here.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* called from a Server Component; safe to ignore */
        }
      },
    },
  });
}
