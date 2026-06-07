/**
 * modules/ingestion — brings raw items from connected sources into the system.
 * Governance: services/ingestion.md.
 *
 * This file holds the cross-module types; the request-time ingestion paths
 * (manual upload + provider slices) live in `./server` (server-only). The
 * scheduled poll/webhook fan-out via Inngest remains future work.
 */

import type { SourceSystem } from "@/modules/shared";

/**
 * A single raw item handed to ingestion by a provider fetcher before
 * normalisation. Field names mirror the canonical `source_item` shape.
 */
export interface ProviderRawItem {
  readonly externalId?: string | null;
  readonly title?: string | null;
  readonly body: string;
  readonly author?: string | null;
  readonly occurredAt?: string | null;
  readonly kind?: string | null;
  readonly raw?: Record<string, unknown> | null;
}

/** Summary of an ingestion run. */
export interface IngestionResult {
  readonly sourceConnectionId: string;
  readonly system: SourceSystem;
  readonly itemCount: number;
}
