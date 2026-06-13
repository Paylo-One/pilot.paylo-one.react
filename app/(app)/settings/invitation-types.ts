/**
 * Client-safe shapes and display maps for the Settings invitation UI. Kept out
 * of the server-only beta-invitations module and the "use server" actions file
 * so both the client card and the server page can import them. The status type
 * is imported as a type only (erased at build time), so this stays safe to ship
 * to the browser.
 */

import type { InvitationStatus } from "@/modules/beta-invitations";

/** A single invitation, flattened + enriched with a shareable link for the UI. */
export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly status: InvitationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly link: string;
}

/** Result of sending an invitation, rendered inline by the card. */
export interface InvitationFormState {
  readonly status: "idle" | "ok" | "error";
  readonly message: string | null;
}

export const initialInvitationFormState: InvitationFormState = {
  status: "idle",
  message: null,
};

/** Plain Title-Case labels for each invitation status. */
export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
};

/** Muted status tones (never the teal accent). */
export const INVITATION_STATUS_TONE: Record<
  InvitationStatus,
  "info" | "ok" | "neutral"
> = {
  pending: "info",
  accepted: "ok",
  expired: "neutral",
  revoked: "neutral",
};
