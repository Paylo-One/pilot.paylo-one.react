/**
 * modules/agent-orchestration/memo-attribution.ts
 *
 * Pure, dependency-free helpers that turn a synthesised Daily Memo into its
 * persistable, source-attributed payload. They live apart from the orchestration
 * flow so the wedge's most trust-critical logic is unit-testable without a DB or
 * the Model Gateway.
 *
 * Trust contract (governance-locked): every shown insight/action must carry >=1
 * `source_reference` to a REAL retrieved item it drew from; excerpts are never
 * fabricated; and — critically — "if an insight cannot be attributed, it is not
 * shown" (governance `docs/product/daily-memo.md`;
 * `docs/architecture/ai-agent-architecture.md` Source Attribution).
 *
 * We therefore DROP any section/action that resolves to zero real references
 * rather than back-filling an unrelated item as false provenance. Fabricating a
 * citation is worse than omitting the claim: it violates the product's first
 * principle ("trust is the product") and product risk PR-1 (one wrong/unsourced
 * claim). See governance decision log 2026-07-20 (memo source-attribution honesty).
 */

import type { StoredSourceItem } from "@/modules/knowledge-store/server";

/** Default confidence when the model does not supply one for a reference. */
export const DEFAULT_CONFIDENCE = 0.7;

/** Clamp text to a bound so prompts/excerpts stay cost- and storage-bounded. */
export function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** A short, real excerpt for a source reference (never fabricated). */
export function itemExcerpt(item: StoredSourceItem): string {
  return clamp(item.title || item.body || `(${item.system} item)`, 160);
}

export function roundConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export interface MemoReferencePayload {
  readonly source_item_id: string;
  readonly source_system: string;
  readonly item_timestamp: string | null;
  readonly confidence: number;
  readonly excerpt_or_pointer: string;
}

/** Structural inputs — compatible with the Zod-inferred Memo without importing it. */
export interface MemoSectionInput {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly sourceItemIds: readonly string[];
  readonly confidence?: number;
}
export interface MemoActionInput {
  readonly title: string;
  readonly rationale: string;
  readonly sourceItemIds: readonly string[];
}
export interface MemoInput {
  readonly summary: string;
  readonly sections: readonly MemoSectionInput[];
  readonly actions: readonly MemoActionInput[];
}

export interface AttributedSectionPayload {
  readonly kind: string;
  readonly position: number;
  readonly title: string;
  readonly body: string;
  readonly references: MemoReferencePayload[];
}
export interface AttributedActionPayload {
  readonly status: string;
  readonly created_from: string;
  readonly title: string;
  readonly rationale: string;
  readonly references: MemoReferencePayload[];
}
export interface AttributedMemoPayload {
  readonly sections: AttributedSectionPayload[];
  readonly actions: AttributedActionPayload[];
  /** How many model sections were dropped for lacking real attribution. */
  readonly droppedSections: number;
  /** How many model actions were dropped for lacking real attribution. */
  readonly droppedActions: number;
}

/**
 * Resolve model-supplied item-id tokens to de-duplicated REAL items. Tokens that
 * do not map to a retrieved item are ignored. There is deliberately NO fallback:
 * back-filling an unrelated item would fabricate provenance and break the trust
 * contract, so an insight with no resolvable token is left with zero references
 * (and dropped by `buildAttributedMemoPayload`).
 */
export function resolveMemoReferenceItems(
  tokens: readonly string[],
  tokenToItem: ReadonlyMap<string, StoredSourceItem>,
): StoredSourceItem[] {
  const seen = new Set<string>();
  const resolved: StoredSourceItem[] = [];
  for (const token of tokens) {
    const item = tokenToItem.get(token.trim());
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      resolved.push(item);
    }
  }
  return resolved;
}

/** An extracted item (decision/risk) paired with the REAL source item it drew from. */
export interface AttributedExtraction<T> {
  readonly item: T;
  /** id of the first resolved real source item — never null (unresolved are dropped). */
  readonly sourceItemId: string;
}
export interface PartitionedExtractions<T> {
  readonly attributed: AttributedExtraction<T>[];
  /** How many extracted items were dropped for lacking real attribution. */
  readonly dropped: number;
}

/**
 * Enforce the trust contract on extracted decisions/risks (the memo's sibling
 * agents). Keep only items whose model-supplied tokens resolve to >=1 REAL
 * retrieved item, pairing each survivor with that item's id for `source_item_id`.
 * Items resolving to zero real items are DROPPED — persisting them would write an
 * unattributed AI claim into the decision log / risk register, the same PR-1
 * failure the memo path already guards against. No fallback, no fabrication.
 * See governance decision log 2026-07-20 (memo source-attribution honesty),
 * follow-up "audit sibling agents for the same anti-pattern".
 */
export function partitionAttributedExtractions<
  T extends { readonly sourceItemIds: readonly string[] },
>(
  items: readonly T[],
  tokenToItem: ReadonlyMap<string, StoredSourceItem>,
): PartitionedExtractions<T> {
  const attributed: AttributedExtraction<T>[] = [];
  let dropped = 0;
  for (const item of items) {
    const [first] = resolveMemoReferenceItems(item.sourceItemIds, tokenToItem);
    if (!first) {
      dropped += 1;
      continue;
    }
    attributed.push({ item, sourceItemId: first.id });
  }
  return { attributed, dropped };
}

/** Structural input for an AI-extracted suggested action awaiting attribution. */
export interface SuggestedActionInput {
  readonly title: string;
  readonly rationale: string;
  readonly dueAt: string | null;
  readonly sourceItemIds: readonly string[];
}

/**
 * A suggested action resolved to real references, shaped for the
 * `persist_suggested_actions` RPC (which fans `references` out into
 * `source_references` rows keyed by the inserted action).
 */
export interface AttributedSuggestedActionPayload {
  readonly status: string;
  readonly created_from: string;
  readonly title: string;
  readonly rationale: string;
  readonly due_at: string | null;
  readonly references: MemoReferencePayload[];
}

export interface AttributedSuggestedActions {
  readonly actions: AttributedSuggestedActionPayload[];
  /** How many extracted actions were dropped for lacking real attribution. */
  readonly droppedUnattributed: number;
}

/**
 * Enforce the trust contract on AI-extracted suggested actions (the action
 * extraction agent — the memo's third sibling alongside decisions and risks).
 * Keep an action only if its model-supplied tokens resolve to >=1 REAL retrieved
 * item, attaching those references so the Actions surface can cite where the
 * suggestion came from. Actions resolving to zero real items are DROPPED rather
 * than shown unattributed — the same PR-1 guard the memo and decision/risk paths
 * already apply. No fallback, no fabricated provenance. Closes the last leg of
 * governance decision log 2026-07-20 (memo source-attribution honesty),
 * follow-up "audit sibling agents for the same anti-pattern".
 */
export function buildAttributedSuggestedActions(
  inputs: readonly SuggestedActionInput[],
  tokenToItem: ReadonlyMap<string, StoredSourceItem>,
): AttributedSuggestedActions {
  const actions: AttributedSuggestedActionPayload[] = [];
  let droppedUnattributed = 0;
  for (const input of inputs) {
    const references = toReferences(
      resolveMemoReferenceItems(input.sourceItemIds, tokenToItem),
      DEFAULT_CONFIDENCE,
    );
    if (references.length === 0) {
      droppedUnattributed += 1;
      continue;
    }
    actions.push({
      status: "inbox",
      created_from: "suggestion",
      title: input.title,
      rationale: input.rationale,
      due_at: input.dueAt,
      references,
    });
  }
  return { actions, droppedUnattributed };
}

function toReferences(
  items: readonly StoredSourceItem[],
  confidence: number,
): MemoReferencePayload[] {
  return items.map((item) => ({
    source_item_id: item.id,
    source_system: item.system,
    item_timestamp: item.occurredAt,
    confidence,
    excerpt_or_pointer: itemExcerpt(item),
  }));
}

/**
 * Turn a synthesised memo into its persistable payload, enforcing source
 * attribution: any section or action that resolves to zero real references is
 * DROPPED (unattributed claims are not shown as fact). Surviving sections are
 * re-positioned in order so persisted positions stay contiguous.
 */
export function buildAttributedMemoPayload(
  memo: MemoInput,
  tokenToItem: ReadonlyMap<string, StoredSourceItem>,
): AttributedMemoPayload {
  const sections: AttributedSectionPayload[] = [];
  let droppedSections = 0;
  for (const section of memo.sections) {
    const references = toReferences(
      resolveMemoReferenceItems(section.sourceItemIds, tokenToItem),
      roundConfidence(section.confidence ?? DEFAULT_CONFIDENCE),
    );
    if (references.length === 0) {
      droppedSections += 1;
      continue;
    }
    sections.push({
      kind: section.kind,
      position: sections.length,
      title: section.title,
      body: section.body,
      references,
    });
  }

  const actions: AttributedActionPayload[] = [];
  let droppedActions = 0;
  for (const action of memo.actions) {
    const references = toReferences(
      resolveMemoReferenceItems(action.sourceItemIds, tokenToItem),
      DEFAULT_CONFIDENCE,
    );
    if (references.length === 0) {
      droppedActions += 1;
      continue;
    }
    actions.push({
      status: "inbox",
      created_from: "briefing",
      title: action.title,
      rationale: action.rationale,
      references,
    });
  }

  return { sections, actions, droppedSections, droppedActions };
}
