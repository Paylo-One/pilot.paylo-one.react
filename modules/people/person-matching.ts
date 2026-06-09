/**
 * modules/people/person-matching.ts
 *
 * Pure, deterministic person-matching helpers used by the Information
 * Correlation capability. Given an observed identity (email, phone, handle) and
 * the known people, propose a match with a confidence score. The system
 * proposes; the operator confirms — uncertain matches are surfaced, never
 * silently applied (architecture/people-context-architecture.md §6).
 *
 * No I/O, no model calls — string/identity heuristics only. Higher-fidelity
 * matching (embedding similarity, LLM adjudication) is future work, always
 * gated behind user confirmation.
 */

import type { IdentityType, Person } from "./people.types";

/** Normalise an email for comparison (lowercase, trim). */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Normalise a phone to digits only (drops spaces, +, dashes, parentheses). */
export function normalisePhone(value: string): string {
  return value.replace(/[^\d]/g, "");
}

/** Normalise a handle/username (lowercase, strip leading @). */
export function normaliseHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function normaliseFor(type: IdentityType, value: string): string {
  if (type === "email") return normaliseEmail(value);
  if (type === "phone" || type === "whatsapp") return normalisePhone(value);
  return normaliseHandle(value);
}

export interface MatchResult {
  readonly personId: string;
  readonly confidence: number;
  readonly reason: string;
  /** Whether the operator should confirm before this link is trusted. */
  readonly needsConfirmation: boolean;
}

/** Confidence at/above which a match may be auto-applied (still audited). */
export const AUTO_LINK_THRESHOLD = 0.9;
/** Confidence below which we do not even suggest a match. */
export const SUGGEST_THRESHOLD = 0.4;

/**
 * Match an observed identity to a known person. Exact, user-verified identity
 * matches score highest; unverified identity matches are strong-but-confirmable;
 * display-name similarity is weak and always needs confirmation.
 */
export function matchPerson(
  observed: { type: IdentityType; value: string },
  people: readonly Person[],
): MatchResult | null {
  const target = normaliseFor(observed.type, observed.value);
  if (!target) return null;

  let best: MatchResult | null = null;
  const consider = (candidate: MatchResult) => {
    if (!best || candidate.confidence > best.confidence) best = candidate;
  };

  for (const person of people) {
    // 1) Exact identity match (strongest; verified beats unverified).
    for (const identity of person.identities) {
      if (normaliseFor(identity.identityType, identity.identityValue) !== target) continue;
      const verified = identity.verifiedByUser;
      consider({
        personId: person.id,
        confidence: verified ? 1 : Math.min(0.85, identity.confidence),
        reason: verified
          ? "Exact match on a user-verified identity."
          : "Exact match on an unverified identity — confirm to lock it in.",
        needsConfirmation: !verified,
      });
    }

    // 2) Email match against the person's known email addresses.
    if (observed.type === "email") {
      if (person.emails.some((e) => normaliseEmail(e) === target)) {
        consider({
          personId: person.id,
          confidence: 0.95,
          reason: "Matches a known email address.",
          needsConfirmation: false,
        });
      }
    }

    // 3) Phone match against known numbers.
    if (observed.type === "phone" || observed.type === "whatsapp") {
      if (person.phones.some((p) => normalisePhone(p) === target)) {
        consider({
          personId: person.id,
          confidence: 0.82,
          reason: "Matches a known phone number (confirm WhatsApp identity).",
          needsConfirmation: true,
        });
      }
    }

    // 4) Weak display-name similarity (local-part / handle vs name tokens).
    const nameTokens = person.displayName.toLowerCase().split(/\s+/).filter(Boolean);
    const probe = observed.type === "email" ? target.split("@")[0] ?? "" : target;
    if (probe.length >= 3 && nameTokens.some((t) => t.length >= 3 && probe.includes(t))) {
      consider({
        personId: person.id,
        confidence: 0.46,
        reason: "Name similarity only — needs confirmation.",
        needsConfirmation: true,
      });
    }
  }

  if (!best) return null;
  return (best as MatchResult).confidence >= SUGGEST_THRESHOLD ? best : null;
}
