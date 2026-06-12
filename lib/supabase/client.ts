"use client";

/**
 * lib/supabase/client.ts
 *
 * Browser Supabase client (publishable key, RLS active). Safe in Client
 * Components. `createBrowserClient` from @supabase/ssr is a singleton, so it is
 * cheap to call repeatedly.
 */

import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabasePublishableKey } from "@/lib/config";
import { supabaseCookieOptions } from "./cookies";

export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
    // Native WebAuthn passkeys (auth.registerPasskey / signInWithPasskey /
    // auth.passkey.*). Experimental opt-in; the methods throw without it. The
    // RP ID and origins live on the Auth server (dashboard / config.toml).
    auth: { experimental: { passkey: true } },
  });
}
