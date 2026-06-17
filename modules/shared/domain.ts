/**
 * domain.ts
 *
 * Cross-module domain primitives referenced by more than one module (so they
 * live in `shared` rather than being owned by a single module). Governance:
 * data-architecture.md, ai-agent-architecture.md.
 *
 * Scaffold note: shapes only; no persistence.
 */

/**
 * Connected source systems (data-architecture.md `source_system` enum).
 *
 * `email` is the GENERIC email category (Gmail/Outlook); `ms365_mail` is the
 * SPECIFIC Microsoft 365 mail connector (Entra/Graph) — they overlap by design
 * and are kept distinct so the operator can reason about the connector they
 * actually authorise. See source-integration-strategy.md §3 "Source catalogue".
 */
export type SourceSystem =
  | "email"
  | "ms365_mail"
  | "calendar"
  | "teams"
  | "slack"
  | "discord"
  | "whatsapp"
  | "github"
  | "notion"
  | "file_upload"
  | "obsidian"
  | "news";

/** Per-source retention choice (data-architecture.md `storage_policy` enum). */
export type StoragePolicy =
  | "raw_and_summaries"
  | "summaries_only"
  | "no_raw"
  | "disabled";

/**
 * The provenance record attached to every AI insight/action/output. If an
 * insight cannot produce at least one of these, it is withheld rather than
 * shown (the product's trust contract).
 */
export interface SourceReference {
  readonly sourceSystem: SourceSystem;
  /** Stable id of the originating item/summary. */
  readonly sourceItemId: string;
  readonly timestamp: string;
  /** Model/heuristic confidence in [0, 1]. */
  readonly confidence: number;
  /** A short excerpt or a deep-link pointer back to the source. */
  readonly excerptOrPointer: string;
}

/** Append-only business audit event (audit-and-source-traceability.md). */
export interface AuditEvent {
  readonly tenantId: string;
  readonly userId?: string;
  readonly action: string;
  readonly target?: string;
  readonly metadata?: Record<string, unknown>;
  readonly occurredAt: string;
}
