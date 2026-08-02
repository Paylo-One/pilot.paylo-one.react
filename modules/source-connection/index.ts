/**
 * modules/source-connection — connect/configure external sources + per-source
 * storage policy; owns tenant-scoped, encrypted integration credentials.
 * Governance: services/source-connection.md, integration-architecture.md.
 *
 * This module file holds the pure types + the human-facing labels that are safe
 * to import anywhere. The data access (RLS reads, secret-client writes, OAuth
 * credential storage) lives in `./server` (server-only).
 */

import type { Result, SourceSystem, StoragePolicy, TenantContext } from "@/modules/shared";

/** Lifecycle of a connection (mirrors the `source_connections.status` check). */
export type SourceConnectionStatus = "connected" | "disconnected" | "error";

/** A tenant's relationship with one external source system. */
export interface SourceConnection {
  readonly id: string;
  readonly system: SourceSystem;
  readonly displayName: string;
  readonly status: SourceConnectionStatus;
  readonly storagePolicy: StoragePolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly autoRefreshEnabled: boolean;
  readonly syncFrequency: string;
  readonly nextSyncAt: string | null;
  readonly lastSyncStatus: string | null;
  readonly lastSyncError: string | null;
  readonly providerWorkspaceId: string | null;
  readonly providerWorkspaceName: string | null;
  readonly permissionsGranted: Record<string, unknown> | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly failedSyncAttempts: number;
}

/** Interface contract retained for cross-module callers (technical-design.md). */
export interface SourceConnectionService {
  list(ctx: TenantContext): Promise<Result<SourceConnection[]>>;
}

/** Human-facing label for each connectable source system. */
export const SOURCE_SYSTEM_LABELS: Record<SourceSystem, string> = {
  email: "Gmail",
  ms365_mail: "Microsoft 365 — Mail",
  calendar: "Google Calendar",
  teams: "Microsoft Teams",
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
  github: "GitHub",
  notion: "Notion",
  file_upload: "File & paste upload",
  obsidian: "Obsidian",
  news: "News",
};

/** Default `display_name` for a freshly created connection of `system`. */
export function defaultDisplayName(system: SourceSystem): string {
  return SOURCE_SYSTEM_LABELS[system] ?? system;
}

/**
 * Human-facing label for a persisted `source_system` value that reaches an
 * operator-visible surface as a plain `string` (e.g. a Daily Memo citation's
 * `source_items.system`, read back untyped). Maps the internal enum token to
 * its friendly label, falling back to the raw value for any unmapped system so
 * an unknown source degrades to its token rather than crashing — but a known
 * one never leaks a raw enum (`email`, `ms365_mail`, `file_upload`) into copy.
 */
export function sourceSystemLabel(system: string): string {
  return SOURCE_SYSTEM_LABELS[system as SourceSystem] ?? system;
}
