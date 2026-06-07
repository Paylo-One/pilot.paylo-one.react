/**
 * modules/normalisation — converts heterogeneous source payloads into one common
 * shape and prepares concise titles/bodies for downstream agents. Governance:
 * services/normalisation.md.
 *
 * MVP implementation: a deterministic passthrough. It tidies whitespace, derives
 * a title from the first meaningful line when one is not supplied, and assigns a
 * default kind. Ingested text is untrusted (prompt-injection surface), so a light
 * neutralisation pass strips control characters before the text is persisted; the
 * richer summarisation/sanitisation pass lives with the intelligence lane.
 */

import type { SourceSystem } from "@/modules/shared";

/** Canonical, source-agnostic representation produced by normalisation. */
export interface NormalisedItem {
  /** Short human title (derived from the body when not provided). */
  readonly title: string | null;
  /** Tidied body text. */
  readonly body: string;
  /** Coarse item type (e.g. "note", "issue", "event"). */
  readonly kind: string;
}

/** Raw input handed to normalisation from ingestion. */
export interface NormalisationInput {
  readonly system: SourceSystem;
  readonly title?: string | null;
  readonly body: string;
  readonly kind?: string | null;
}

/** Interface contract retained for cross-module callers (technical-design.md). */
export interface NormalisationService {
  normaliseContent(input: NormalisationInput): NormalisedItem;
}

const MAX_TITLE = 120;

/** Strip control characters (keep tab/newline), normalise newlines, trim. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Truncate to MAX_TITLE with an ellipsis when over length. */
function clampTitle(text: string): string {
  return text.length > MAX_TITLE
    ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}\u2026`
    : text;
}

/** Derive a title from the first non-empty line of the body. */
function deriveTitle(body: string): string | null {
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ? clampTitle(firstLine) : null;
}

/**
 * Normalise a raw payload into the canonical {@link NormalisedItem} shape. Pure
 * and synchronous: no I/O, safe to call from server actions or jobs.
 */
export function normaliseContent(input: NormalisationInput): NormalisedItem {
  const body = tidy(input.body);
  const providedTitle = input.title ? tidy(input.title) : "";
  const title =
    providedTitle.length > 0 ? clampTitle(providedTitle) : deriveTitle(body);
  const kind = input.kind?.trim() || "note";
  return { title, body, kind };
}

/** Concrete service implementation backed by {@link normaliseContent}. */
export const normalisationService: NormalisationService = {
  normaliseContent,
};
