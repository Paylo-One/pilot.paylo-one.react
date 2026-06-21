/**
 * modules/people/people-tags.ts
 *
 * The behavioural tag taxonomy for People & Companies. A tag is not decoration:
 * each catalogued tag carries a contract — what it means, how it changes what
 * Pilot does, and where that shows up. Tags become **explicit, inspectable
 * tenant state** (importance, refinement rules, proposed actions) — never hidden
 * model learning (architecture/information-refinement-loop.md).
 *
 * Pure data + helpers (no persistence, no server-only) so the picker, the
 * explainer, and the server-side behaviour wiring all read the same source.
 *
 * Free-text tags remain allowed; only catalogued slugs carry behaviour. The
 * catalogue is operator-editable later (documented as Planned).
 *
 * Governance: docs/product/people-and-companies.md (Tag taxonomy + behavioural
 * impact), services/people-context-service.md.
 */

import type { PersonImportanceLevel } from "./people.types";

/** Muted semantic tone for the chip (never the teal accent — colour-system.md). */
export type TagTone = "ok" | "info" | "warn" | "risk" | "neutral";

/** Where a tag's effect is felt across the product. */
export type TagSurface =
  | "briefing"
  | "actions"
  | "source_ranking"
  | "decisions"
  | "mcp";

/** The machine-readable effect a tag has. */
export type TagBehaviourKind =
  /** Sets a floor on the person's importance (consumed by briefing ranking). */
  | "raise_importance"
  /** Proposes a follow-up action the operator confirms. */
  | "suggest_action"
  /** Quietens this person: excluded from the briefing unless directly relevant. */
  | "reduce_noise"
  /** Marks the relationship sensitive, changing default link visibility + tone. */
  | "mark_sensitive"
  /** Classification only this pass; downstream effects documented as Planned. */
  | "classify";

export interface TagBehaviour {
  readonly kind: TagBehaviourKind;
  /** For raise_importance: the importance level this tag implies as a floor. */
  readonly importanceFloor?: PersonImportanceLevel;
  /** True when the effect is wired live in this pass; false = documented Planned. */
  readonly wired: boolean;
}

export interface TagDefinition {
  /** Stable, kebab-case identifier persisted in person_tags/company_tags. */
  readonly slug: string;
  /** Operator-facing label. */
  readonly label: string;
  /** One-line description shown under the label. */
  readonly description: string;
  /** Plain-language statement of what selecting this tag actually does. */
  readonly explanation: string;
  readonly tone: TagTone;
  readonly behaviour: TagBehaviour;
  /** The surfaces this tag influences (for the "where it appears" line). */
  readonly appearsIn: readonly TagSurface[];
  /** Whether the tag applies to people, companies, or both. */
  readonly appliesTo: readonly ("person" | "company")[];
}

const BOTH = ["person", "company"] as const;
const PERSON_ONLY = ["person"] as const;

/**
 * The canonical tag catalogue. Order is the suggested display order (most
 * operationally consequential first).
 */
export const TAG_CATALOGUE: readonly TagDefinition[] = [
  {
    slug: "key-stakeholder",
    label: "Key stakeholder",
    description: "Central to a decision, project, or outcome you own.",
    explanation:
      "Raises this person in your briefing so their activity surfaces before lower-priority noise.",
    tone: "warn",
    behaviour: { kind: "raise_importance", importanceFloor: "high", wired: true },
    appearsIn: ["briefing", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "high-priority-contact",
    label: "High-priority contact",
    description: "Always worth your attention when they reach out.",
    explanation:
      "Keeps this person near the top of your briefing and people-in-focus, regardless of volume.",
    tone: "warn",
    behaviour: { kind: "raise_importance", importanceFloor: "high", wired: true },
    appearsIn: ["briefing", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "strategic-relationship",
    label: "Strategic relationship",
    description: "Matters to the long game, not just today's task.",
    explanation:
      "Treated as high importance in your briefing and flagged as strategic context for the relationship graph.",
    tone: "info",
    behaviour: { kind: "raise_importance", importanceFloor: "high", wired: true },
    appearsIn: ["briefing", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "follow-up-required",
    label: "Follow-up required",
    description: "There is an open loop with this person.",
    explanation:
      "Proposes a follow-up action for you to confirm, so the loop is tracked rather than forgotten.",
    tone: "warn",
    behaviour: { kind: "suggest_action", wired: true },
    appearsIn: ["actions", "briefing", "mcp"],
    appliesTo: PERSON_ONLY,
  },
  {
    slug: "do-not-surface-unless-relevant",
    label: "Do not surface unless relevant",
    description: "Quiet by default; only when it genuinely matters.",
    explanation:
      "Keeps this person out of the daily briefing unless an item is directly relevant. Reduces noise without losing the record.",
    tone: "neutral",
    behaviour: { kind: "reduce_noise", wired: true },
    appearsIn: ["briefing"],
    appliesTo: BOTH,
  },
  {
    slug: "sensitive-relationship",
    label: "Sensitive relationship",
    description: "Handle with discretion.",
    explanation:
      "Marks linked context as sensitive, so summaries stay measured and the relationship is treated with care. Tone and confidence handling is expanding (planned).",
    tone: "risk",
    behaviour: { kind: "mark_sensitive", wired: true },
    appearsIn: ["briefing", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "decision-maker",
    label: "Decision maker",
    description: "Can approve, block, or change direction.",
    explanation:
      "Classifies this person's role in decisions. Surfacing of their approvals in the decision log is planned.",
    tone: "info",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["decisions", "mcp"],
    appliesTo: PERSON_ONLY,
  },
  {
    slug: "investor",
    label: "Investor",
    description: "Backs the business or a venture you run.",
    explanation:
      "Classifies the relationship as investor context, used to frame related content and graph connections.",
    tone: "info",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["source_ranking", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "client",
    label: "Client",
    description: "Buys from or is served by you.",
    explanation:
      "Classifies the relationship as client context, used to frame related content and graph connections.",
    tone: "info",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["source_ranking", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "supplier",
    label: "Supplier",
    description: "Provides a product or service to you.",
    explanation:
      "Classifies the relationship as supplier context for grouping and graph connections.",
    tone: "info",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "partner",
    label: "Partner",
    description: "You work alongside them toward shared goals.",
    explanation:
      "Classifies the relationship as partner context for grouping and graph connections.",
    tone: "info",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "team-member",
    label: "Team member",
    description: "Part of your team or organisation.",
    explanation:
      "Classifies this person as internal, used to frame their activity and graph connections.",
    tone: "neutral",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["mcp"],
    appliesTo: PERSON_ONLY,
  },
  {
    slug: "compliance-relevance",
    label: "Compliance relevance",
    description: "Connected to a regulatory or compliance matter.",
    explanation:
      "Flags compliance context so related items are easy to find. Dedicated compliance handling is planned.",
    tone: "warn",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["briefing", "mcp"],
    appliesTo: BOTH,
  },
  {
    slug: "personal-contact",
    label: "Personal contact",
    description: "A personal relationship, not a work one.",
    explanation:
      "Classifies this person as personal, so their non-work activity is framed accordingly rather than treated as work signal.",
    tone: "neutral",
    behaviour: { kind: "classify", wired: false },
    appearsIn: ["source_ranking", "mcp"],
    appliesTo: PERSON_ONLY,
  },
];

const BY_SLUG: ReadonlyMap<string, TagDefinition> = new Map(
  TAG_CATALOGUE.map((t) => [t.slug, t]),
);

/** Look up a catalogued tag by slug (or by its label, case-insensitively). */
export function getTagDefinition(slugOrLabel: string): TagDefinition | null {
  const key = slugOrLabel.trim();
  const direct = BY_SLUG.get(key);
  if (direct) return direct;
  const lower = key.toLowerCase();
  return (
    TAG_CATALOGUE.find(
      (t) => t.slug.toLowerCase() === lower || t.label.toLowerCase() === lower,
    ) ?? null
  );
}

/** True when a tag string is part of the behavioural catalogue. */
export function isCatalogTag(slugOrLabel: string): boolean {
  return getTagDefinition(slugOrLabel) !== null;
}

/** Catalogue filtered to those that apply to the given entity kind. */
export function tagsFor(entity: "person" | "company"): readonly TagDefinition[] {
  return TAG_CATALOGUE.filter((t) => t.appliesTo.includes(entity));
}

/** Human label for a tag string (catalogued label, else the raw value). */
export function tagLabel(slugOrLabel: string): string {
  return getTagDefinition(slugOrLabel)?.label ?? slugOrLabel;
}

/** Muted tone for a tag string (catalogued tone, else neutral). */
export function tagTone(slugOrLabel: string): TagTone {
  return getTagDefinition(slugOrLabel)?.tone ?? "neutral";
}

/** Plain-language label for where a tag's effect appears. */
export const TAG_SURFACE_LABELS: Record<TagSurface, string> = {
  briefing: "Daily briefing",
  actions: "Actions",
  source_ranking: "Source ranking",
  decisions: "Decisions",
  mcp: "Connected tools",
};
