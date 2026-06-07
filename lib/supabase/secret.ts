import "server-only";

/**
 * lib/supabase/secret.ts
 *
 * Secret-key Supabase client (authenticates as the service_role Postgres role;
 * BYPASSES RLS). Trusted server/worker code ONLY: provisioning, ingestion,
 * briefing generation, audit/usage writes, and the subdomain-availability check
 * (which must read across tenants). Callers MUST scope every query by an
 * explicit tenant_id. Never import into a client bundle.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseSecretKey } from "@/lib/config";

export function createSupabaseSecretClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
