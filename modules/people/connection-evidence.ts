/**
 * modules/people/connection-evidence.ts
 *
 * Pure evidence extraction for person↔person connections. Turns a batch of
 * ingested source items plus the known people into deduplicated, dated
 * evidence per pair — the input to connection-scoring.ts. No I/O, no model
 * calls: string matching over content the operator can inspect.
 *
 * Noise controls built in:
 *  - items are deduplicated by content hash first (repeated sync ingestion of
 *    the same message counts once, not 116 times);
 *  - the operator's own record (is_self) is excluded — they co-occur with
 *    everyone, which carries no information;
 *  - name mentions require full display names (≥ 2 tokens or an email/handle
 *    match) with word boundaries, so short or generic fragments never match.
 */

import type { Person } from "./people.types";
import type {
  ConnectionEvidence,
  ConnectionSignal,
} from "./connection-scoring";

/** The minimal item shape evidence extraction needs. */
export interface EvidenceItem {
  readonly id: string;
  readonly system: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly author: string | null;
  readonly occurredAt: string | null;
}

/** A person↔person pair key, canonical (lower id first). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// --- Deduplication ------------------------------------------------------------

function contentKey(item: EvidenceItem): string {
  return `${(item.title ?? "").trim()}|${(item.body ?? "").trim()}|${item.author ?? ""}`;
}

/** Drop exact content duplicates, keeping the most recent occurrence of each. */
export function dedupeItems(items: readonly EvidenceItem[]): EvidenceItem[] {
  const byContent = new Map<string, EvidenceItem>();
  for (const item of items) {
    const key = contentKey(item);
    const existing = byContent.get(key);
    if (!existing || (item.occurredAt ?? "") > (existing.occurredAt ?? "")) {
      byContent.set(key, item);
    }
  }
  return [...byContent.values()];
}

// --- Person detection ---------------------------------------------------------

interface PersonMatcher {
  readonly personId: string;
  readonly displayName: string;
  /** Regex over item text; null when the name is too weak to match safely. */
  readonly nameRe: RegExp | null;
  readonly emails: readonly string[];
  readonly handles: readonly string[];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a safe matcher for a person. Single-word names (and anything under 5
 * characters) never match free text — too generic — but emails and verified
 * handles still do.
 */
export function buildMatcher(person: Person): PersonMatcher {
  const name = person.displayName.trim();
  const tokens = name.split(/\s+/).filter(Boolean);
  const safeName = tokens.length >= 2 && name.length >= 5 && !name.includes("@");
  const nameRe = safeName
    ? new RegExp(`(?:^|[^\\p{L}])${escapeRe(name)}(?:[^\\p{L}]|$)`, "iu")
    : null;
  const handles = person.identities
    .filter((i) => i.identityType !== "email" && i.identityType !== "phone")
    .map((i) => i.identityValue.trim().toLowerCase())
    .filter((v) => v.length >= 3);
  return {
    personId: person.id,
    displayName: name,
    nameRe,
    emails: person.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    handles,
  };
}

/** The people detected in one item, split by how they appear. */
export interface ItemMentions {
  /** Person the item is authored by (if a known person). */
  readonly authorPersonId: string | null;
  /** All known people appearing in the item (including the author). */
  readonly personIds: readonly string[];
}

export function detectMentions(
  item: EvidenceItem,
  matchers: readonly PersonMatcher[],
): ItemMentions {
  const text = `${item.title ?? ""}\n${item.body ?? ""}`;
  const lower = text.toLowerCase();
  const author = (item.author ?? "").toLowerCase();

  const personIds: string[] = [];
  let authorPersonId: string | null = null;

  for (const m of matchers) {
    const inAuthor =
      (m.nameRe !== null && m.nameRe.test(item.author ?? "")) ||
      m.emails.some((e) => author.includes(e)) ||
      m.handles.some((h) => author === h);
    const inText =
      (m.nameRe !== null && m.nameRe.test(text)) ||
      m.emails.some((e) => lower.includes(e));
    if (inAuthor && authorPersonId === null) authorPersonId = m.personId;
    if (inAuthor || inText) personIds.push(m.personId);
  }
  return { authorPersonId, personIds };
}

// --- Pair evidence accumulation -------------------------------------------------

interface PairAccumulator {
  direct: number;
  directLastAt: string | null;
  directSystems: Set<string>;
  cooc: number;
  coocLastAt: string | null;
  sample: string | null;
}

const SYSTEM_LABELS: Record<string, string> = {
  teams: "Teams",
  ms365_mail: "email",
  email: "email",
  whatsapp: "WhatsApp",
  slack: "Slack",
  github: "GitHub",
  calendar: "calendar",
};

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function directDetail(count: number, systems: ReadonlySet<string>): string {
  const labels = [...new Set([...systems].map((s) => SYSTEM_LABELS[s] ?? s))];
  if (labels.length === 1) return `Exchanged ${plural(count, `${labels[0]} message`)}.`;
  if (labels.length > 1) {
    return `Exchanged ${plural(count, "message")} across ${labels.join(", ")}.`;
  }
  return `Exchanged ${plural(count, "message")}.`;
}

function sampleOf(item: EvidenceItem): string | null {
  const text = (item.title ?? item.body ?? "").trim();
  if (!text) return null;
  return text.length > 110 ? `${text.slice(0, 109)}…` : text;
}

export interface PairEvidence {
  readonly personAId: string;
  readonly personBId: string;
  readonly evidence: ConnectionEvidence;
}

export interface CollectEvidenceInput {
  readonly people: readonly Person[];
  readonly items: readonly EvidenceItem[];
  /** Pairwise profile similarity keyed by pairKey (optional, supporting only). */
  readonly profileSimilarity?: ReadonlyMap<string, number>;
}

/**
 * Collect evidence for every pair of known people observed together in the
 * items. Deterministic; items are deduplicated internally.
 */
export function collectPairEvidence(input: CollectEvidenceInput): PairEvidence[] {
  const active = input.people.filter((p) => !p.isSelf && p.status !== "inactive");
  const matchers = active.map(buildMatcher);
  const items = dedupeItems(input.items);

  const pairs = new Map<string, PairAccumulator>();
  const acc = (a: string, b: string): PairAccumulator => {
    const key = pairKey(a, b);
    let entry = pairs.get(key);
    if (!entry) {
      entry = {
        direct: 0,
        directLastAt: null,
        directSystems: new Set(),
        cooc: 0,
        coocLastAt: null,
        sample: null,
      };
      pairs.set(key, entry);
    }
    return entry;
  };
  const later = (a: string | null, b: string | null): string | null =>
    !a ? b : !b ? a : a > b ? a : b;

  for (const item of items) {
    const { authorPersonId, personIds } = detectMentions(item, matchers);
    const unique = [...new Set(personIds)];
    if (unique.length < 2) continue;
    // Guard against megadocuments that mention everyone: cap the fan-out.
    if (unique.length > 6) continue;

    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const a = unique[i] as string;
        const b = unique[j] as string;
        const entry = acc(a, b);
        const isDirect = authorPersonId === a || authorPersonId === b;
        if (isDirect) {
          entry.direct += 1;
          entry.directLastAt = later(entry.directLastAt, item.occurredAt);
          entry.directSystems.add(item.system);
        } else {
          entry.cooc += 1;
          entry.coocLastAt = later(entry.coocLastAt, item.occurredAt);
        }
        if (!entry.sample) entry.sample = sampleOf(item);
      }
    }
  }

  // Structural evidence: shared, resolved company (or identical organisation text).
  const orgOf = (p: Person): string | null => {
    if (p.companyId) return `company:${p.companyId}`;
    const org = (p.organisation ?? "").trim().toLowerCase();
    return org ? `org:${org}` : null;
  };
  const companyLabelOf = (p: Person): string | null => p.companyName ?? p.organisation;

  const byId = new Map(active.map((p) => [p.id, p]));
  const out: PairEvidence[] = [];
  const emitted = new Set<string>();

  const buildSignals = (aId: string, bId: string, entry: PairAccumulator | null): ConnectionSignal[] => {
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) return [];
    const signals: ConnectionSignal[] = [];
    if (entry && entry.direct > 0) {
      signals.push({
        kind: "direct_interaction",
        count: entry.direct,
        lastAt: entry.directLastAt ?? undefined,
        detail: directDetail(entry.direct, entry.directSystems),
        sample: entry.sample ?? undefined,
      });
    }
    if (entry && entry.cooc > 0) {
      signals.push({
        kind: "co_occurrence",
        count: entry.cooc,
        lastAt: entry.coocLastAt ?? undefined,
        detail: `Appeared together in ${plural(entry.cooc, "conversation")}.`,
        sample: entry.sample ?? undefined,
      });
    }
    const orgA = orgOf(a);
    if (orgA !== null && orgA === orgOf(b)) {
      signals.push({
        kind: "shared_company",
        detail: `Both linked to ${companyLabelOf(a) ?? "the same organisation"}.`,
      });
    }
    const similarity = input.profileSimilarity?.get(pairKey(aId, bId));
    if (similarity !== undefined) {
      signals.push({
        kind: "semantic_profile",
        similarity,
        detail: "Their profiles and recent activity read closely related.",
      });
    }
    return signals;
  };

  const emit = (aId: string, bId: string, entry: PairAccumulator | null) => {
    const key = pairKey(aId, bId);
    if (emitted.has(key)) return;
    emitted.add(key);
    const signals = buildSignals(aId, bId, entry);
    if (signals.length === 0) return;
    const [first, second] = key.split("|") as [string, string];
    out.push({ personAId: first, personBId: second, evidence: { signals } });
  };

  for (const key of pairs.keys()) {
    const [aId, bId] = key.split("|") as [string, string];
    emit(aId, bId, pairs.get(key) ?? null);
  }
  // Pairs with no observed items can still connect structurally (same company)
  // or semantically; enumerate the remaining combinations of known people.
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      emit((active[i] as Person).id, (active[j] as Person).id, null);
    }
  }

  return out;
}
