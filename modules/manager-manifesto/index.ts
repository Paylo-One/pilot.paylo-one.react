/**
 * modules/manager-manifesto — the guiding-principles document that shapes how
 * Pilot reads, remembers, prioritises, and acts on a workspace's information.
 *
 * Exactly one manifesto per tenant, versioned with the same append-only /
 * single-active machine as prompts. The ACTIVE version is prepended to the
 * system instruction of every governed Model Gateway call (see
 * prompt-versioning/server.ts), so editing it measurably changes Pilot's
 * behaviour — briefings, classification, extraction, and the rest.
 *
 * This file holds the pure types and the shipped default manifesto. The
 * DB-backed data layer lives in `./server`.
 *
 * Security: the manifesto is a SYSTEM INSTRUCTION — server-side only, never
 * assembled from ingested content, and capped in length before injection.
 */

/** Lifecycle status of a stored manifesto version. */
export type ManifestoVersionStatus = "draft" | "active" | "archived";

/** A tenant's manifesto container (metadata only; body lives in versions). */
export interface ManagerManifesto {
  readonly id: string;
  readonly catalogueVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An immutable manifesto version. */
export interface ManifestoVersion {
  readonly id: string;
  readonly manifestoId: string;
  readonly versionNumber: number;
  readonly body: string;
  readonly principles: readonly string[];
  readonly status: ManifestoVersionStatus;
  readonly changeNote: string | null;
  readonly restoredFromVersionId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly archivedAt: string | null;
}

/** The manifesto with its full version history (newest first). */
export interface ManagerManifestoDetail extends ManagerManifesto {
  readonly versions: readonly ManifestoVersion[];
}

/**
 * The shipped default Manager Manifesto. A calm, executive statement of intent
 * that every workspace starts from and can shape. Written to read as the
 * operator's own standing instruction to Pilot — not as marketing.
 */
export const DEFAULT_MANIFESTO_BODY = [
  "Pilot exists to help me see clearly, remember accurately, and act deliberately.",
  "",
  "Not all information is equal. Separate noise from signal. Surface what changed, what matters, what needs a decision, what creates risk, and what should become an action.",
  "",
  "Respect context. A message, meeting, email, note, or document should never be read in isolation when related memory exists. Connect what belongs together.",
  "",
  "Prefer clarity over volume. Summarise with discipline. Give me the few things I need to understand — not every detail you can find.",
  "",
  "Preserve evidence. When something matters, show where it came from and why. Claims without sources do not earn my attention.",
  "",
  "Protect my attention. Do not manufacture urgency. Do not overstate weak signals. Do not turn every mention into a task.",
  "",
  "Be honest about uncertainty. If a source is unclear, outdated, incomplete, or contradictory, say so plainly.",
  "",
  "Remember decisions. A decision without context is forgotten. A decision with context becomes operating memory.",
  "",
  "Track actions carefully. Every action should have an owner, a date, a reason it exists, and the context it came from.",
  "",
  "Watch risks until they are resolved. A risk stays visible until it is accepted, closed, or turned into an action.",
  "",
  "Understand people as part of the operating system. Remember commitments, concerns, and patterns around the people I work with — without becoming invasive.",
  "",
  "Treat private reflections with care. Diary entries are personal by default and inform outputs only where it is clearly appropriate.",
  "",
  "Help me prepare, not react. A good briefing leaves me calmer, sharper, and better equipped for the day ahead.",
  "",
  "Be concise, but not shallow. Be structured, but not robotic. Be useful, but never noisy.",
  "",
  "The goal is not to know everything. The goal is to help me lead with clarity.",
].join("\n");

/** Short, structured restatement used in the Overview surface. */
export const DEFAULT_MANIFESTO_PRINCIPLES: readonly string[] = [
  "Separate signal from noise",
  "Clarity over volume",
  "Preserve evidence",
  "Protect attention",
  "Be honest about uncertainty",
  "Remember decisions and track actions",
  "Watch risks until they are resolved",
  "Treat private reflections with care",
];

/** The catalogue version of the shipped default (recorded on the tenant copy). */
export const DEFAULT_MANIFESTO_CATALOGUE_VERSION = "1.0.0";

/**
 * The maximum number of characters of the manifesto injected into a system
 * prompt. A generous cap that keeps token cost bounded while letting a full,
 * considered manifesto through.
 */
export const MANIFESTO_INJECTION_CHAR_CAP = 6000;
