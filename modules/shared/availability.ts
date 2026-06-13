/**
 * availability.ts
 *
 * The shared release-readiness vocabulary used across the product so that every
 * surface separates what is live from what is on the roadmap in exactly one
 * way. Planned and coming-soon features stay visible but read as intentional
 * roadmap — muted, non-interactive, never broken or half-finished.
 *
 * Pure data only (no server-only imports) so both server components and client
 * components (e.g. the workspace navigation) can use it.
 *
 * Governance: governance/docs/product/release-readiness.md.
 */

/** Whether a feature is usable now, on the near roadmap, or further out. */
export type Availability = "available" | "planned" | "coming_soon";

/** Plain, customer-facing label for each state. No jargon, Title Case. */
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "Available",
  planned: "Planned",
  coming_soon: "Coming soon",
};

/**
 * Maps each state onto the existing muted status tones (never the teal accent):
 * available → green, planned → slate/blue, coming soon → neutral grey.
 */
export const AVAILABILITY_TONE: Record<Availability, "ok" | "info" | "neutral"> =
  {
    available: "ok",
    planned: "info",
    coming_soon: "neutral",
  };

/** True when a feature cannot be opened or acted on yet. */
export function isPlanned(availability: Availability): boolean {
  return availability !== "available";
}
