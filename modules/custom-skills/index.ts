/**
 * modules/custom-skills — reusable, versioned instruction sets that compose
 * into prompts. A skill is a named way of working ("Executive summarisation",
 * "Risk spotting") that can be attached to one or more prompts; when a prompt
 * runs, its linked skills are folded into the system instruction alongside the
 * Manager Manifesto (see prompt-versioning/server.ts).
 *
 * This file holds the pure types and the shipped default skill catalogue. The
 * DB-backed data layer lives in `./server`.
 *
 * Security: skills are SYSTEM INSTRUCTIONS — server-side only, never assembled
 * from ingested content, and capped in length before injection.
 */

/** Lifecycle status of a stored skill version. */
export type SkillVersionStatus = "draft" | "active" | "archived";

/** Where a skill came from. */
export type SkillOrigin = "system_default" | "custom";

/** The behavioural fields that make up one skill version. */
export interface SkillBehaviour {
  readonly instructions: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string;
  readonly outputFormat: string;
  readonly toneGuidance: string;
  readonly requiredContext: string;
  readonly safetyConstraints: string;
}

/** A tenant's skill (metadata; behaviour lives in versions). */
export interface CustomSkill {
  readonly id: string;
  readonly skillKey: string;
  readonly name: string;
  readonly purpose: string;
  readonly origin: SkillOrigin;
  readonly catalogueVersion: string;
  readonly archivedAt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Library row: the skill plus its active-version summary + link count. */
export interface CustomSkillSummary extends CustomSkill {
  readonly activeVersionNumber: number | null;
  readonly versionCount: number;
  readonly linkedPromptCount: number;
}

/** An immutable skill version. */
export interface CustomSkillVersion extends SkillBehaviour {
  readonly id: string;
  readonly customSkillId: string;
  readonly versionNumber: number;
  readonly status: SkillVersionStatus;
  readonly changeNote: string | null;
  readonly restoredFromVersionId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly archivedAt: string | null;
}

/** Detail view: the skill with its full version history (newest first). */
export interface CustomSkillDetail extends CustomSkill {
  readonly versions: readonly CustomSkillVersion[];
  /** Ids of the prompts this skill is linked to. */
  readonly linkedPromptIds: readonly string[];
}

/** A seedable default skill (the shipped catalogue). */
export interface SkillDefault extends SkillBehaviour {
  readonly skillKey: string;
  readonly name: string;
  readonly purpose: string;
  readonly catalogueVersion: string;
}

/** Max characters of skill instructions injected per prompt resolution. */
export const SKILL_INJECTION_CHAR_CAP = 4000;

/**
 * The shipped default skill catalogue. Each is a calm, practical way of working
 * a senior operator would recognise — copied into a tenant's library on first
 * read, then theirs to shape.
 */
export const DEFAULT_SKILL_CATALOGUE: readonly SkillDefault[] = [
  {
    skillKey: "executive_summarisation",
    name: "Executive summarisation",
    purpose: "Reduce anything to the few things a leader needs to understand.",
    instructions:
      "Lead with the conclusion. Give the three to five points that change what the reader thinks or does, in order of consequence. Cut background unless it changes the meaning. Name the so-what for each point.",
    whenToUse:
      "Long threads, dense documents, or busy briefings where the reader has minutes, not hours.",
    whenNotToUse:
      "Material that is already short, or where the detail itself is the point (legal text, figures to be checked).",
    outputFormat:
      "A one-line headline, then a short ordered list. No preamble.",
    toneGuidance: "Calm, decisive, plain. No hedging, no filler.",
    requiredContext: "The full source material and who the summary is for.",
    safetyConstraints:
      "Never invent figures, names, or commitments. If something is uncertain, say so rather than smoothing it over.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "decision_extraction",
    name: "Decision extraction",
    purpose: "Capture decisions with the context that keeps them useful later.",
    instructions:
      "Identify decisions that were made, deferred, or reversed. For each, record what was decided, why, who decided, and the options that were weighed. A decision without its reasoning is half a decision.",
    whenToUse:
      "Meeting notes, threads, and documents where choices are being made.",
    whenNotToUse:
      "Open questions and opinions that have not yet resolved into a choice.",
    outputFormat:
      "One entry per decision: title, rationale, alternatives considered, status.",
    toneGuidance:
      "Neutral and factual. Record the decision, not your view of it.",
    requiredContext: "The discussion or document, and who holds the decision.",
    safetyConstraints:
      "Do not infer a decision that was not actually made. Mark ambiguous cases as 'proposed', not 'decided'.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "risk_spotting",
    name: "Risk spotting",
    purpose: "Surface genuine risk early, without crying wolf.",
    instructions:
      "Flag what could go wrong and why it matters. Weigh severity against likelihood. Distinguish a real exposure from a passing worry. Note who owns it and what would resolve it.",
    whenToUse:
      "Status updates, incident notes, and anything touching deadlines, money, people, or reputation.",
    whenNotToUse:
      "Routine updates with no downside, where flagging risk would only add noise.",
    outputFormat:
      "One entry per risk: title, what is exposed, severity, likelihood, suggested owner.",
    toneGuidance: "Measured. State the exposure plainly; do not dramatise.",
    requiredContext:
      "The source material and any related open risks already on record.",
    safetyConstraints:
      "Do not manufacture urgency. A weak signal is a weak signal — label it as such.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "meeting_note_processing",
    name: "Meeting note processing",
    purpose: "Turn raw meeting notes into decisions, actions, and follow-ups.",
    instructions:
      "Separate what was discussed from what was decided and what someone now owns. Pull out actions with owners and dates. Note open questions for next time.",
    whenToUse: "Notes or transcripts from a meeting or call.",
    whenNotToUse:
      "Single messages or documents that are not a record of a discussion.",
    outputFormat:
      "Three sections: Decisions, Actions (owner + date), Open questions.",
    toneGuidance:
      "Brisk and organised. Attribute actions to named owners where the notes allow.",
    requiredContext: "The notes or transcript and the list of attendees.",
    safetyConstraints:
      "Do not assign an action to someone the notes did not name. Leave the owner blank rather than guess.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "founder_diary_reflection",
    name: "Founder diary reflection",
    purpose: "Make private reflection useful without making it exposing.",
    instructions:
      "Read diary entries as the operator's own thinking. Surface recurring themes, decisions taken in private, and risks worth watching. Offer a calm reflection, not advice the operator did not ask for.",
    whenToUse:
      "Private diary and reflection entries, processed for the author only.",
    whenNotToUse:
      "Anything that will be shown to other people or folded into a shared briefing.",
    outputFormat:
      "A short reflection: recurring themes, decisions, risks, and one thing worth attention next week.",
    toneGuidance:
      "Warm, private, unhurried. Speak with the operator, not about them.",
    requiredContext: "Recent diary entries by the same author.",
    safetyConstraints:
      "Diary content is private by default. Never let it leak into shared outputs unless explicitly permitted.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "investor_update_preparation",
    name: "Investor update preparation",
    purpose:
      "Assemble an honest, confident update from what actually happened.",
    instructions:
      "Pull progress, metrics, decisions, and risks into a structured update. Lead with what changed. Be candid about what is hard. Ground every claim in something that happened.",
    whenToUse: "Preparing a periodic update for investors or a board.",
    whenNotToUse:
      "Internal working notes, or before the underlying facts are settled.",
    outputFormat: "Headline, highlights, metrics, lowlights / risks, asks.",
    toneGuidance: "Confident and candid. Strength and honesty, not spin.",
    requiredContext: "The period's source material and any agreed metrics.",
    safetyConstraints:
      "Never overstate a metric or omit a known material risk. Mark anything unverified.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "compliance_aware_briefing",
    name: "Compliance-aware briefing",
    purpose: "Brief without exposing what should stay protected.",
    instructions:
      "Summarise normally, but watch for regulated, confidential, or personal data. Flag it, and prefer pointers over reproducing sensitive content in full.",
    whenToUse:
      "Briefings that may touch regulated, legal, or personal information.",
    whenNotToUse:
      "Clearly public or low-sensitivity material where the extra caution only slows things down.",
    outputFormat:
      "A normal briefing, with a short note on anything sensitive that was handled with care.",
    toneGuidance: "Careful and precise. Caution without alarm.",
    requiredContext:
      "The source material and the workspace's sensitivity expectations.",
    safetyConstraints:
      "Do not reproduce credentials, identifiers, or regulated personal data in full. Point to the source instead.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "product_strategy_synthesis",
    name: "Product strategy synthesis",
    purpose: "Connect scattered signals into a coherent strategic picture.",
    instructions:
      "Gather customer signals, decisions, and constraints into themes. Show how they relate. Name the tension or trade-off, not just the list of inputs.",
    whenToUse:
      "Pulling together product feedback, research, and decisions into a point of view.",
    whenNotToUse:
      "Tactical, single-issue questions that do not need synthesis.",
    outputFormat: "Themes, the tension within each, and what it implies.",
    toneGuidance: "Thoughtful and structured. Comfortable holding ambiguity.",
    requiredContext:
      "The relevant signals, decisions, and any stated strategy.",
    safetyConstraints:
      "Do not present a hypothesis as a finding. Separate evidence from interpretation.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "people_relationship_memory",
    name: "People and relationship memory",
    purpose: "Remember the people I work with — usefully, not invasively.",
    instructions:
      "Track commitments made and owed, recurring concerns, and context about the people in the workspace. Tie observations to where they came from.",
    whenToUse:
      "Processing items that involve named people and their commitments.",
    whenNotToUse:
      "Inferring private traits or sentiment that the source does not support.",
    outputFormat:
      "Per person: commitments, concerns, and notable context, each with a source.",
    toneGuidance: "Respectful and factual. Memory, not judgement.",
    requiredContext:
      "Items naming the person and any existing record for them.",
    safetyConstraints:
      "Record only what the source shows. Never infer protected characteristics or speculate about private life.",
    catalogueVersion: "1.0.0",
  },
  {
    skillKey: "weekly_operating_review",
    name: "Weekly operating review",
    purpose: "Close the week with a clear, honest operating picture.",
    instructions:
      "Pull the week into what moved, what stalled, decisions taken, risks still open, and what deserves attention next week. Reference the underlying items.",
    whenToUse:
      "End-of-week or end-of-period reviews across the whole workspace.",
    whenNotToUse: "Daily briefings or single-topic summaries.",
    outputFormat: "Moved, stalled, decisions, open risks, next week's focus.",
    toneGuidance: "Steady and complete. A calm close to the week.",
    requiredContext: "The week's signals, decisions, actions, and risks.",
    safetyConstraints:
      "Do not overstate progress. Carry forward unresolved risks rather than quietly dropping them.",
    catalogueVersion: "1.0.0",
  },
];

/** Lookup a default skill by key. */
export function getSkillDefault(skillKey: string): SkillDefault | undefined {
  return DEFAULT_SKILL_CATALOGUE.find((s) => s.skillKey === skillKey);
}
