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

export const metadata: Metadata = {
  title: "Accept invite · Paylo.one",
  robots: { index: false, follow: false },
};

export default function InviteAcceptancePage() {
  return (
    <>
      <p className="eyebrow">Invitation</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>
        Accept your invite
      </h1>

      <div className="panel">
        <p style={{ color: "var(--colour-text-secondary)" }}>
          You&apos;ve been invited to a Paylo.one workspace. Accepting verifies
          your identity, then sets up your first <strong>passkey</strong> — no
          password to choose, store, or leak.
        </p>

        <ol
          style={{
            color: "var(--colour-text-secondary)",
            margin: "var(--space-lg) 0 0",
            paddingLeft: "1.25rem",
            listStyle: "decimal",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <li>Confirm the invite (one-time link).</li>
          <li>Create a passkey on this device.</li>
          <li>
            Add a second credential or recovery codes, so losing one device is a
            non-event.
          </li>
        </ol>

        <div style={{ marginTop: "var(--space-lg)" }}>
          <span className="badge" aria-disabled="true">
            Create my passkey
          </span>
        </div>
      </div>

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Scaffold: this screen is a static placeholder. Invite-token validation,
        passkey registration / attestation verification, and tenant provisioning
        are documented but not yet implemented.
      </p>
    </>
  );
}
