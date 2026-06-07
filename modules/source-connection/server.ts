import "server-only";

/**
 * modules/source-connection/server.ts
 *
 * Server-only data helpers for tenant source connections and their encrypted
 * integration credentials. Governance: services/source-connection.md.
 *
 * Client choice:
 *  - Reads + operator-driven inserts (file_upload) use the RLS-scoped USER
 *    client (authenticated may select/insert source_connections).
 *  - OAuth callback writes run on a neutral host with no user session, so they
 *    use the SECRET client and ALWAYS filter by an explicit tenant_id.
 */

import type { SourceSystem, StoragePolicy, TenantContext } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  defaultDisplayName,
  type SourceConnection,
  type SourceConnectionStatus,
} from "./index";

interface SourceConnectionRow {
  id: string;
  system: string;
  display_name: string;
  status: string;
  storage_policy: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: SourceConnectionRow): SourceConnection {
  return {
    id: row.id,
    system: row.system as SourceSystem,
    displayName: row.display_name,
    status: row.status as SourceConnectionStatus,
    storagePolicy: row.storage_policy as StoragePolicy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  "id, system, display_name, status, storage_policy, created_at, updated_at";

/**
 * List the current tenant's source connections (oldest first). Uses the USER
 * client so RLS scopes the result to the caller's tenant automatically.
 */
export async function listSourceConnections(): Promise<SourceConnection[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("source_connections")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SourceConnectionRow[]).map(mapRow);
}

/**
 * Find-or-create a connection for `system` using the USER (RLS) client. Used for
 * operator-driven sources (e.g. file_upload) where the user is authenticated and
 * RLS permits the insert. Returns the connection id.
 */
export async function ensureSourceConnection(
  ctx: TenantContext,
  system: SourceSystem,
  opts?: { displayName?: string; storagePolicy?: StoragePolicy },
): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: selectError } = await supabase
    .from("source_connections")
    .select("id")
    .eq("system", system)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) return existing.id as string;

  const { data, error } = await supabase
    .from("source_connections")
    .insert({
      tenant_id: ctx.tenantId,
      system,
      display_name: opts?.displayName ?? defaultDisplayName(system),
      status: "connected",
      storage_policy: opts?.storagePolicy ?? "summaries_only",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "source_connection_create_failed");
  }
  return data.id as string;
}

/**
 * Create or update a provider connection with the SECRET client (used from OAuth
 * callbacks that run without a user session). Always scoped by tenant_id.
 */
export async function upsertProviderConnection(
  tenantId: string,
  system: SourceSystem,
  opts?: {
    displayName?: string;
    status?: SourceConnectionStatus;
    storagePolicy?: StoragePolicy;
  },
): Promise<string> {
  const secret = createSupabaseSecretClient();

  const { data: existing, error: selectError } = await secret
    .from("source_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("system", system)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  const displayName = opts?.displayName ?? defaultDisplayName(system);
  const status = opts?.status ?? "connected";

  if (existing) {
    const { error } = await secret
      .from("source_connections")
      .update({ status, display_name: displayName })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return existing.id as string;
  }

  const { data, error } = await secret
    .from("source_connections")
    .insert({
      tenant_id: tenantId,
      system,
      display_name: displayName,
      status,
      storage_policy: opts?.storagePolicy ?? "summaries_only",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "provider_connection_failed");
  }
  return data.id as string;
}

/**
 * Disconnect a source connection: mark it disconnected and wipe its OAuth
 * credentials. Uses the USER client for the status update (RLS allows it) and
 * the SECRET client to delete credentials (never exposed to authenticated).
 */
export async function disconnectSourceConnection(
  connectionId: string,
  tenantId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error: updateError } = await supabase
    .from("source_connections")
    .update({ status: "disconnected" })
    .eq("id", connectionId);
  if (updateError) throw new Error(updateError.message);

  // Wipe OAuth tokens — requires secret client (no authenticated grant).
  const secret = createSupabaseSecretClient();
  await secret
    .from("integration_credentials")
    .delete()
    .eq("source_connection_id", connectionId)
    .eq("tenant_id", tenantId);
}

/**
 * Persist OAuth credentials for a connection (SECRET client; tenant-scoped).
 * Replaces any prior credentials for the same connection so re-auth is clean.
 */
export async function storeIntegrationCredentials(
  tenantId: string,
  sourceConnectionId: string,
  creds: {
    accessToken: string;
    refreshToken?: string | null;
    scope?: string | null;
    expiresAt?: string | null;
  },
): Promise<void> {
  const secret = createSupabaseSecretClient();

  await secret
    .from("integration_credentials")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId);

  const { error } = await secret.from("integration_credentials").insert({
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken ?? null,
    scope: creds.scope ?? null,
    expires_at: creds.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
}
