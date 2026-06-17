/**
 * modules/people/people.types.ts
 *
 * People Context — the relationship layer that turns fragmented information into
 * relationship-aware operating intelligence. Pure types + label maps (no
 * persistence, no server-only) so server and client components share them.
 *
 * Governance: architecture/people-context-architecture.md, services/people-context-service.md.
 *
 * Scaffold note: backed by typed mock data; no persistence yet.
 */

import type { SourceSystem } from "@/modules/shared";

/** How much a person matters to the operator (drives triage + memo ranking). */
export type PersonImportanceLevel = "critical" | "high" | "normal" | "low";

/** Lifecycle of a person record. */
export type PersonStatus = "active" | "inactive";

/** The person's relationship to the operator. */
export type RelationshipType =
  | "report"
  | "manager"
  | "peer"
  | "investor"
  | "customer"
  | "vendor"
  | "partner"
  | "external"
  | "other";

/** A per-source identity that resolves an incoming signal to a person. */
export type IdentityType =
  | "email"
  | "phone"
  | "whatsapp"
  | "teams"
  | "slack"
  | "discord"
  | "github"
  | "notion"
  | "alias";

/**
 * A single source identity mapping for a person — e.g. an email address, a
 * WhatsApp contact id, a GitHub username. `verifiedByUser` distinguishes a
 * user-confirmed mapping from an automatic guess.
 */
export interface PersonIdentity {
  readonly id: string;
  readonly personId: string;
  /** The source system this identity belongs to (or "generic" for email/phone). */
  readonly sourceType: SourceSystem | "generic";
  readonly identityType: IdentityType;
  /** The literal value: address, phone, handle, etc. */
  readonly identityValue: string;
  /** Provider-native id where available (e.g. WhatsApp wid, Teams AAD id). */
  readonly providerUserId?: string | null;
  /** Match confidence in [0,1] (1 when user-verified). */
  readonly confidence: number;
  readonly verifiedByUser: boolean;
}

/** A free-text alias the person is known by (used in fuzzy matching). */
export interface PersonAlias {
  readonly id: string;
  readonly personId: string;
  readonly alias: string;
  /** Optional source the alias was seen in. */
  readonly source?: SourceSystem | null;
}

/** A tag applied to a person (DevOps, Board, Investor…). */
export type PersonTag = string;

/** A relationship from a person to another entity (person/project/topic). */
export interface PersonRelationship {
  readonly id: string;
  readonly personId: string;
  readonly relatedType: "person" | "project" | "topic";
  readonly relatedId: string;
  readonly relatedLabel: string;
  readonly kind: string;
}

/** A recent signal (source item) linked to a person — shown on the person page. */
export interface PersonSignal {
  readonly id: string;
  readonly system: SourceSystem;
  readonly title: string;
  readonly occurredAt: string;
  /** Link confidence in [0,1]. */
  readonly confidence: number;
}

/** An action linked to a person. */
export interface PersonLinkedAction {
  readonly id: string;
  readonly title: string;
  readonly status: "suggested" | "approved" | "deferred" | "done";
}

/** A person record with the data the People surface displays. */
export interface Person {
  readonly id: string;
  readonly displayName: string;
  readonly roleTitle: string | null;
  readonly organisation: string | null;
  readonly relationshipType: RelationshipType;
  readonly importance: PersonImportanceLevel;
  readonly status: PersonStatus;
  readonly emails: string[];
  readonly phones: string[];
  readonly tags: PersonTag[];
  readonly notes: string | null;
  readonly identities: PersonIdentity[];
  readonly relationships: PersonRelationship[];
  readonly signals: PersonSignal[];
  readonly linkedActions: PersonLinkedAction[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The source a mapping belongs to ("generic" covers email/phone). */
export type SourceMappingSourceType = SourceSystem | "generic";

/** A grouped, source-oriented view of a person's identities (for the UI). */
export interface PersonSourceMapping {
  readonly sourceType: SourceMappingSourceType;
  readonly identities: PersonIdentity[];
}

/**
 * A suggested link between an unresolved incoming signal and a known (or new)
 * person — surfaced for explicit user confirmation. The system proposes; the
 * operator confirms (never silently merges).
 */
export interface PersonLinkSuggestion {
  readonly id: string;
  /** A short preview of the signal that triggered the suggestion. */
  readonly signalPreview: string;
  readonly sourceSystem: SourceSystem;
  /** The identity value seen (email/handle/number). */
  readonly observedIdentity: string;
  /** The candidate person, if a likely match exists. */
  readonly candidatePersonId: string | null;
  readonly candidateName: string | null;
  readonly confidence: number;
  readonly reason: string;
}

// --- Label maps -------------------------------------------------------------

export const IMPORTANCE_LABELS: Record<PersonImportanceLevel, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** Importance → design-system status tone (muted vocabulary, never teal). */
export const IMPORTANCE_TONE: Record<
  PersonImportanceLevel,
  "ok" | "info" | "warn" | "risk" | "neutral"
> = {
  critical: "risk",
  high: "warn",
  normal: "info",
  low: "neutral",
};

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  report: "Direct report",
  manager: "Manager",
  peer: "Peer",
  investor: "Investor",
  customer: "Customer",
  vendor: "Vendor",
  partner: "Partner",
  external: "External",
  other: "Other",
};

export const IDENTITY_TYPE_LABELS: Record<IdentityType, string> = {
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  teams: "Teams",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  notion: "Notion",
  alias: "Alias",
};
