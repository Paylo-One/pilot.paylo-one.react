/**
 * app/(app)/sources/catalogue.ts
 *
 * The presentational catalogue of connectable sources, ordered by the MVP
 * phasing in integration-architecture.md / services/source-connection.md:
 * a dependable core (Email, Calendar, GitHub, Notion, File upload) plus phased
 * channels (Teams, WhatsApp). This describes the DESIGNED integrations; only
 * file upload and (when credentials are configured) GitHub are wired in this
 * build. Everything else is scaffolded.
 */

import type { SourceSystem, StoragePolicy } from "@/modules/shared";

export type SourceTier = "core" | "phased";

export interface SourceCatalogueEntry {
  readonly system: SourceSystem;
  /** Short two/three-letter glyph for the card. */
  readonly glyph: string;
  /** "Email · Gmail" style provider hint. */
  readonly provider: string;
  readonly description: string;
  readonly tier: SourceTier;
  /** Conservative default storage policy shown before connection. */
  readonly defaultPolicy: StoragePolicy;
  /** Whether this source produces source-referenceable items by design. */
  readonly referenceReady: boolean;
}

export const STORAGE_POLICY_LABELS: Record<StoragePolicy, string> = {
  raw_and_summaries: "raw + summaries",
  summaries_only: "summaries only",
  no_raw: "no raw",
  disabled: "disabled",
};

export const TIER_LABELS: Record<SourceTier, string> = {
  core: "Dependable core",
  phased: "Phased",
};

/** Ordered for display: core first, then phased. */
export const SOURCE_CATALOGUE: readonly SourceCatalogueEntry[] = [
  {
    system: "email",
    glyph: "@",
    provider: "Email · Gmail",
    description:
      "Read-only access to surface threads, asks, and commitments owed.",
    tier: "core",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "calendar",
    glyph: "◷",
    provider: "Calendar · Google",
    description: "Meetings with prep pointers and linked context for the day.",
    tier: "core",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "github",
    glyph: "GH",
    provider: "GitHub",
    description: "Issues, pull requests, and activity that change your context.",
    tier: "core",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "notion",
    glyph: "N",
    provider: "Notion",
    description: "Docs and briefs the memo can draw on and cite.",
    tier: "core",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "file_upload",
    glyph: "↑",
    provider: "File & paste upload",
    description: "Bring in a note or document directly — no credentials needed.",
    tier: "core",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "teams",
    glyph: "T",
    provider: "Microsoft Teams",
    description: "Signals and themes across your team's channels.",
    tier: "phased",
    defaultPolicy: "summaries_only",
    referenceReady: true,
  },
  {
    system: "whatsapp",
    glyph: "W",
    provider: "WhatsApp",
    description: "Forwarded or exported conversations brought in as context.",
    tier: "phased",
    defaultPolicy: "no_raw",
    referenceReady: true,
  },
];
