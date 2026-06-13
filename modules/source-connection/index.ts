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
