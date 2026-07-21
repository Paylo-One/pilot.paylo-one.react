/**
 * modules/people/connection-scoring.ts
 *
 * Evidence-based connection scoring — pure and deterministic (no I/O, no model
 * calls), shared by server pipeline and UI. A connection between two people is
 * never created from a single embedding-similarity score: it is a weighted
 * combination of observable evidence, each piece of which can be shown to the
 * operator in plain language.
 *
 * All weights, saturation constants, and thresholds live in CONNECTION_SCORING
 * below — one documented place, no magic numbers scattered through the code.
 *
 * Governance: docs/product/people-and-companies.md (Relationship graph model),
 * docs/architecture/connection-scoring.md.
 */

// --- Evidence model -----------------------------------------------------------

/** The kinds of evidence a connection can rest on. */
export type ConnectionSignalKind =
  | "direct_interaction" // A wrote to B (1:1 message, email to/from, reply)
  | "co_occurrence" // A and B appear in the same conversation/thread/meeting
  | "shared_company" // both resolve to the same organisation
  | "explicit" // the operator recorded the relationship themselves
  | "semantic_profile"; // their profiles/activity read similar (weak, supporting)

/** One scoring signal, with everything needed to explain it to the operator. */
export interface ConnectionSignal {
  readonly kind: ConnectionSignalKind;
  /** Distinct evidence events (deduplicated content), when countable. */
  readonly count?: number;
  /** ISO timestamp of the most recent supporting event. */
  readonly lastAt?: string;
  /** Cosine similarity for semantic_profile (never shown raw to the user). */
  readonly similarity?: number;
  /** Plain-language line shown in the UI ("Exchanged 24 Teams messages…"). */
  readonly detail: string;
  /** Optional short excerpt of a supporting item. */
  readonly sample?: string;
}

/** The deduplicated evidence collected for one pair of people. */
export interface ConnectionEvidence {
  readonly signals: readonly ConnectionSignal[];
}

export type ConnectionTier = "strong" | "relevant" | "possible" | "hidden";

export interface ConnectionScore {
  /** Combined confidence in [0, 0.99]. */
  readonly score: number;
  readonly tier: ConnectionTier;
  /** The dominant relationship kind for entity_links.relationship_type. */
  readonly relationshipType:
    | "frequent_correspondent"
    | "collaborates_with"
    | "same_company"
    | "mentioned_with"
    | "semantically_related";
  /** One-line, human reason for the connection (the headline). */
  readonly headline: string;
  /** Distinct evidence items behind the score. */
  readonly evidenceCount: number;
}

// --- Configuration ------------------------------------------------------------

/**
 * The scoring model, versioned. Change a weight → bump `version` so stored
 * edges can be re-scored and stale scores identified.
 *
 * How a score is built:
 *   score = Σ weight(kind) × strength(kind)
 * where `strength` is in [0,1]:
 *   - countable signals (messages, co-occurrences) use diminishing returns,
 *     strength = decayedCount / (decayedCount + halfSaturation): the 5th shared
 *     conversation matters more than the 50th.
 *   - each event is recency-decayed by 2^(-ageDays / halfLifeDays): stale
 *     interaction fades instead of accumulating forever.
 *   - shared_company / explicit are boolean (present = 1).
 *   - semantic_profile maps similarity from [floor, 1] → [0, 1] and contributes
 *     nothing below the floor. It can SUPPORT a connection, never carry one:
 *     with no other evidence the tier is capped at "possible".
 */
export const CONNECTION_SCORING = {
  version: "2026-07-21.v1",

  /** Recency half-life: an event this many days old counts half. */
  halfLifeDays: 45,

  /** Relative weight of each evidence kind (sums to 1 for readability). */
  weights: {
    direct_interaction: 0.4,
    co_occurrence: 0.25,
    shared_company: 0.2,
    explicit: 0.1,
    semantic_profile: 0.05,
  } as const satisfies Record<ConnectionSignalKind, number>,

  /**
   * Half-saturation for countable signals: the decayed count at which the
   * signal reaches half strength (diminishing returns beyond it).
   */
  halfSaturation: {
    direct_interaction: 6,
    co_occurrence: 8,
  } as const,

  /** Below this cosine similarity, semantic evidence contributes nothing. */
  semanticFloor: 0.86,

  /** Tier boundaries on the combined score. Below `possible` → hidden. */
  tiers: {
    strong: 0.45,
    relevant: 0.25,
    possible: 0.12,
  } as const,

  /**
   * A visible connection needs at least this many distinct evidence events
   * (a single co-occurrence in one document is not a relationship).
   */
  minEvidenceEvents: 2,
} as const;

export const CONNECTION_TIER_LABELS: Record<Exclude<ConnectionTier, "hidden">, string> = {
  strong: "Strong",
  relevant: "Relevant",
  possible: "Possible",
};

// --- Scoring ------------------------------------------------------------------

/** Recency decay factor for one event: 2^(-ageDays / halfLife), clamped to [0,1]. */
export function recencyFactor(eventAt: string | undefined, now: Date): number {
  if (!eventAt) return 1;
  const at = Date.parse(eventAt);
  if (Number.isNaN(at)) return 1;
  const ageDays = Math.max(0, (now.getTime() - at) / 86_400_000);
  return 2 ** (-ageDays / CONNECTION_SCORING.halfLifeDays);
}

/** Diminishing-returns normalisation for countable evidence. */
function saturate(decayedCount: number, halfSaturation: number): number {
  if (decayedCount <= 0) return 0;
  return decayedCount / (decayedCount + halfSaturation);
}

function strengthOf(signal: ConnectionSignal, now: Date): number {
  switch (signal.kind) {
    case "direct_interaction":
    case "co_occurrence": {
      const decayed = (signal.count ?? 0) * recencyFactor(signal.lastAt, now);
      return saturate(decayed, CONNECTION_SCORING.halfSaturation[signal.kind]);
    }
    case "shared_company":
    case "explicit":
      return 1;
    case "semantic_profile": {
      const floor = CONNECTION_SCORING.semanticFloor;
      const sim = signal.similarity ?? 0;
      if (sim < floor) return 0;
      return (sim - floor) / (1 - floor);
    }
  }
}

function countableEvents(signals: readonly ConnectionSignal[]): number {
  return signals.reduce((sum, s) => sum + (s.count ?? (s.kind === "explicit" ? 1 : 0)), 0);
}

function dominantRelationship(
  signals: readonly ConnectionSignal[],
  contributions: ReadonlyMap<ConnectionSignalKind, number>,
): ConnectionScore["relationshipType"] {
  const direct = contributions.get("direct_interaction") ?? 0;
  const cooc = contributions.get("co_occurrence") ?? 0;
  const company = contributions.get("shared_company") ?? 0;
  if (direct > 0 && cooc > 0) return "collaborates_with";
  if (direct >= Math.max(cooc, company) && direct > 0) return "frequent_correspondent";
  if (company >= Math.max(direct, cooc) && company > 0) return "same_company";
  if (cooc > 0) return "mentioned_with";
  return "semantically_related";
}

function headlineFor(
  relationshipType: ConnectionScore["relationshipType"],
  signals: readonly ConnectionSignal[],
): string {
  const byKind = (kind: ConnectionSignalKind) => signals.find((s) => s.kind === kind);
  switch (relationshipType) {
    case "collaborates_with": {
      const direct = byKind("direct_interaction");
      const cooc = byKind("co_occurrence");
      return direct?.detail ?? cooc?.detail ?? "Work together across your activity.";
    }
    case "frequent_correspondent":
      return byKind("direct_interaction")?.detail ?? "Message each other regularly.";
    case "same_company":
      return byKind("shared_company")?.detail ?? "Belong to the same organisation.";
    case "mentioned_with":
      return byKind("co_occurrence")?.detail ?? "Keep appearing in the same conversations.";
    case "semantically_related":
      return "Their profiles and activity look closely related.";
  }
}

/**
 * Score a pair of people from their collected evidence. Pure: same inputs →
 * same outputs (pass `now` explicitly).
 */
export function scoreConnection(evidence: ConnectionEvidence, now: Date): ConnectionScore {
  const contributions = new Map<ConnectionSignalKind, number>();
  let score = 0;
  for (const signal of evidence.signals) {
    const strength = strengthOf(signal, now);
    const contribution = CONNECTION_SCORING.weights[signal.kind] * strength;
    contributions.set(signal.kind, (contributions.get(signal.kind) ?? 0) + contribution);
    score += contribution;
  }
  score = Math.max(0, Math.min(0.99, Math.round(score * 1000) / 1000));

  const events = countableEvents(evidence.signals);
  const hasHardEvidence = evidence.signals.some((s) => s.kind !== "semantic_profile");

  let tier: ConnectionTier;
  if (score >= CONNECTION_SCORING.tiers.strong) tier = "strong";
  else if (score >= CONNECTION_SCORING.tiers.relevant) tier = "relevant";
  else if (score >= CONNECTION_SCORING.tiers.possible) tier = "possible";
  else tier = "hidden";

  // Guards: semantic similarity alone can never make a connection visible
  // beyond "possible", and thin evidence (a single event, no structural signal
  // like a shared company) stays hidden.
  if (!hasHardEvidence && tier !== "hidden") tier = "possible";
  const hasStructuralEvidence = evidence.signals.some(
    (s) => s.kind === "shared_company" || s.kind === "explicit",
  );
  if (events < CONNECTION_SCORING.minEvidenceEvents && !hasStructuralEvidence) {
    tier = "hidden";
  }
  // An operator-recorded relationship is never hidden or merely "possible":
  // the strongest evidence there is, regardless of observed volume.
  if (evidence.signals.some((s) => s.kind === "explicit") && tier !== "strong") {
    tier = "relevant";
  }

  const relationshipType = dominantRelationship(evidence.signals, contributions);
  return {
    score,
    tier,
    relationshipType,
    headline: headlineFor(relationshipType, evidence.signals),
    evidenceCount: evidence.signals.reduce((sum, s) => sum + (s.count ?? 1), 0),
  };
}

/** Tier for an already-stored confidence (read path; keeps old rows sensible). */
export function tierForConfidence(confidence: number): ConnectionTier {
  if (confidence >= CONNECTION_SCORING.tiers.strong) return "strong";
  if (confidence >= CONNECTION_SCORING.tiers.relevant) return "relevant";
  if (confidence >= CONNECTION_SCORING.tiers.possible) return "possible";
  return "hidden";
}
