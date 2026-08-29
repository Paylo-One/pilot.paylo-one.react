/**
 * app/(auth)/invite/page.tsx
 *
 * Invite-acceptance surface — the start of passkey enrolment
 * (authentication-architecture.md §4 registration). Paylo.one is invite-only;
 * accepting an invite establishes a verified identity, after which the user
 * enrols their first passkey. Governance:
 *   - governance/docs/architecture/authentication-architecture.md
 *   - governance/docs/services/identity-and-tenant.md
 *
 * Scaffold note: STATIC placeholder. There is no token validation, no WebAuthn
 * registration, and no tenant provisioning — the real flow verifies the one-time
 * invite, issues a registration challenge (RP ID = paylo.one), verifies the
 * attestation, and prompts for a second credential / recovery codes.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Invitation unavailable · Paylo.one",
  robots: { index: false, follow: false },
};

export default function InviteAcceptancePage() {
  return (
    <>
      <p className="eyebrow">Invitation</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
        This invitation is not available yet
      </h1>
      <p
        className="text-secondary"
        style={{ marginBottom: "var(--space-lg)", fontSize: "var(--text-small)" }}
      >
        Workspace invitation acceptance is paused while we finish the identity
        and membership safeguards. This link cannot add you to a workspace.
      </p>

      <div className="card">
        <p className="action-card__rationale">
          Ask the person who shared this link to wait before sending another
          one. If you want your own workspace, you can request access instead.
        </p>
        <div style={{ marginTop: "var(--space-lg)", display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <Link href="/request-access" className="btn btn--primary">
            Request access
          </Link>
          <Link href="/sign-in" className="btn btn--secondary">
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
