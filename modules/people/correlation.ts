/**
 * modules/people/correlation.ts
 *
 * Information Correlation core — pure, deterministic. Resolves ingested source
 * items to known people using their verified identities + aliases, producing:
 *  - **signals**: items confidently attributed to a person (verified-exact match),
 *  - **suggestions**: uncertain matches (unverified/weak) or unknown senders, for
 *    explicit user confirmation ("Is this the same person?").
 *
 * The system proposes; the operator confirms — uncertain matches are surfaced,
 * never silently applied (ADR-034; people-context-architecture.md §6). No I/O,
 * no model calls; higher-fidelity matching stays behind confirmation.
 *
 * Governance: services/information-correlation-service.md.
 */

import type { IdentityType, Person, PersonSignal } from "./people.types";
import type { SourceSystem } from "@/modules/shared";
import { matchPerson, AUTO_LINK_THRESHOLD } from "./person-matching";

/** The minimal source-item shape correlation needs (decoupled from DB rows). */
export interface CorrelationItem {
  readonly id: string;
  readonly system: SourceSystem;
  readonly title: string | null;
  readonly body: string | null;
  readonly author: string | null;
  readonly occurredAt: string | null;
}

/** A suggestion to persist (no id yet). */
export interface SuggestionInput {
  readonly sourceItemId: string;
  readonly sourceSystem: SourceSystem;
  readonly observedIdentity: string;
  readonly candidatePersonId: string | null;
  readonly candidateName: string | null;
  readonly confidence: number;
  readonly reason: string;
  readonly signalPreview: string;
}

export interface CorrelationResult {
  /** personId → recent attributed signals. */
  readonly signalsByPerson: Record<string, PersonSignal[]>;
  /** Deduped suggestions (by observed identity), highest-confidence kept. */
  readonly suggestions: SuggestionInput[];
}

const EMAIL_RE = /<([^>]+@[^>]+)>|([^\s<]+@[^\s>]+)/;

/**
 * Extract the observed identity (sender/author) from a source item, typed by
 * source. Returns null for sources without a meaningful counterparty (file
 * upload, Obsidian — authored by the operator) or when no identity is present.
 */
export function observedIdentityFromItem(
  item: CorrelationItem,
): { type: IdentityType; value: string } | null {
  const author = (item.author ?? "").trim();
  if (!author) return null;

  switch (item.system) {
    case "github":
      return { type: "github", value: author };
    case "email":
    case "ms365_mail": {
      const m = EMAIL_RE.exec(author);
      const email = m ? (m[1] ?? m[2] ?? "").trim() : author.includes("@") ? author : "";
      return email ? { type: "email", value: email } : null;
    }
    case "whatsapp": {
      const digits = author.replace(/[^\d]/g, "");
      return digits.length >= 7 ? { type: "whatsapp", value: author } : null;
    }
    case "teams":
      return { type: "teams", value: author };
    case "notion":
      return { type: "notion", value: author };
    case "calendar":
      return author.includes("@") ? { type: "email", value: author } : null;
    default:
      return null; // file_upload, etc. — operator-authored
  }
}

function previewOf(item: CorrelationItem): string {
  const text = item.title?.trim() || item.body?.trim() || "(no preview)";
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/**
 * Correlate a batch of items against the known people. Pure: same inputs →
 * same outputs.
 */
export function correlateSourceItems(
  items: readonly CorrelationItem[],
  people: readonly Person[],
): CorrelationResult {
  const signalsByPerson: Record<string, PersonSignal[]> = {};
  const suggestionByIdentity = new Map<string, SuggestionInput>();

  const nameOf = (personId: string) =>
    people.find((p) => p.id === personId)?.displayName ?? null;

  for (const item of items) {
    const observed = observedIdentityFromItem(item);
    if (!observed) continue;

    const match = matchPerson(observed, people);

    // Confident, verified-exact attribution → a signal on that person.
    if (match && match.confidence >= AUTO_LINK_THRESHOLD && !match.needsConfirmation) {
      const list = signalsByPerson[match.personId] ?? [];
      list.push({
        id: item.id,
        system: item.system,
        title: previewOf(item),
        occurredAt: item.occurredAt ?? new Date(0).toISOString(),
        confidence: match.confidence,
      });
      signalsByPerson[match.personId] = list;
      continue;
    }

    // Otherwise → a confirmable suggestion (uncertain match, or unknown sender).
    const key = `${observed.type}:${observed.value.toLowerCase()}`;
    const candidate: SuggestionInput = {
      sourceItemId: item.id,
      sourceSystem: item.system,
      observedIdentity: observed.value,
      candidatePersonId: match?.personId ?? null,
      candidateName: match ? nameOf(match.personId) : null,
      confidence: match?.confidence ?? 0,
      reason: match
        ? match.reason
        : "No known person matches this identity. Add as a new person?",
      signalPreview: previewOf(item),
    };
    const existing = suggestionByIdentity.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      suggestionByIdentity.set(key, candidate);
    }
  }

  // Newest signals first, bounded per person.
  for (const personId of Object.keys(signalsByPerson)) {
    signalsByPerson[personId] = (signalsByPerson[personId] ?? [])
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, 10);
  }

  return { signalsByPerson, suggestions: [...suggestionByIdentity.values()] };
}
