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
import { checkCanAddSourceConnection } from "./entitlement-guard";

interface SourceConnectionRow {
  id: string;
  system: string;
  display_name: string;
  status: string;
  storage_policy: string;
  created_at: string;
  updated_at: string;
  auto_refresh_enabled: boolean;
  sync_frequency: string;
  next_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
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
    autoRefreshEnabled: row.auto_refresh_enabled,
    syncFrequency: row.sync_frequency,
    nextSyncAt: row.next_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
  };
}

const SELECT_COLUMNS =
  "id, system, display_name, status, storage_policy, created_at, updated_at, auto_refresh_enabled, sync_frequency, next_sync_at, last_sync_status, last_sync_error";

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

  // New connection (no existing row for this system) → enforce the plan's
  // maxConnectedSources. Observe-only for now: a denial is logged, not thrown.
  const allowed = await checkCanAddSourceConnection({ tenantId: ctx.tenantId, system });
  if (!allowed) {
    throw new Error("source_connection_limit_reached");
  }

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

  // New connection (no existing row for this system) → enforce the plan's
  // maxConnectedSources. Observe-only for now: a denial is logged, not thrown.
  const allowed = await checkCanAddSourceConnection({ tenantId, system });
  if (!allowed) {
    throw new Error("source_connection_limit_reached");
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
 * Read the stored access token for a connection (SECRET client; tenant-scoped).
 * Used by server-side sync that runs without a user session. Returns null if no
 * credentials are stored. Never expose this to the browser/RLS path.
 */
export async function getIntegrationAccessToken(
  tenantId: string,
  sourceConnectionId: string,
): Promise<string | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("integration_credentials")
    .select("access_token")
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.access_token as string | undefined) ?? null;
}

/** Stored credential fields (server-only). */
export interface StoredCredentials {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
}

/**
 * Read the full stored credentials for a connection (SECRET client;
 * tenant-scoped). Used by adapters that must refresh expiring tokens (e.g.
 * Google). Returns null when none are stored.
 */
export async function getIntegrationCredentials(
  tenantId: string,
  sourceConnectionId: string,
): Promise<StoredCredentials | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("integration_credentials")
    .select("access_token, refresh_token, scope, expires_at")
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    accessToken: (data.access_token as string | null) ?? "",
    refreshToken: (data.refresh_token as string | null) ?? null,
    scope: (data.scope as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
  };
}

/**
 * Resolve the current tenant's connection id for a system using the USER (RLS)
 * client. Returns null when none exists. Used by UI server actions that need to
 * target a connection without trusting a client-supplied id.
 */
export async function findConnectionIdBySystem(
  system: SourceSystem,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("source_connections")
    .select("id")
    .eq("system", system)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
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
