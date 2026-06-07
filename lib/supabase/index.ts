/**
 * lib/supabase — Supabase client factories.
 *
 * Uses the NEW Supabase API keys (publishable + secret), via @supabase/ssr.
 * Three client kinds, each in its own file so server-only code never leaks into
 * a client bundle:
 *
 *   - client.ts → createSupabaseBrowserClient()  (publishable key, RLS active)
 *   - server.ts → createSupabaseServerClient()    (publishable key, cookie-bound, RLS active)
 *   - secret.ts → createSupabaseSecretClient()    (secret key, server-only, BYPASSES RLS)
 *
 * This barrel re-exports ONLY the browser client (safe everywhere). Import the
 * server and secret clients directly from their modules in server code:
 *   import { createSupabaseServerClient } from "@/lib/supabase/server";
 *   import { createSupabaseSecretClient } from "@/lib/supabase/secret";
 */

export { createSupabaseBrowserClient } from "./client";
