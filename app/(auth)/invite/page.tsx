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
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
        Accept your invite
      </h1>
      <p
        className="text-secondary"
        style={{ marginBottom: "var(--space-lg)", fontSize: "var(--text-small)" }}
      >
        You&apos;ve been invited to a Paylo.one workspace. Accepting verifies your
        identity, then sets up your first passkey — no password to choose, store,
        or leak.
      </p>

      <div className="card">
        <div className="steps">
          <div className="step">
            <span className="step__no">1</span>
            <div>
              <p className="step__title">Confirm the invite</p>
              <p className="step__body">A one-time link verifies who you are.</p>
            </div>
          </div>
          <div className="step">
            <span className="step__no">2</span>
            <div>
              <p className="step__title">Create a passkey on this device</p>
              <p className="step__body">
                Phishing-resistant and device-bound; it works across every
                &lt;slug&gt;.paylo.one.
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step__no">3</span>
            <div>
              <p className="step__title">Add a recovery method</p>
              <p className="step__body">
                A second passkey or recovery codes, so losing one device is a
                non-event.
              </p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "var(--space-lg)" }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled
            title="Passkey registration is designed, not yet wired in this scaffold"
          >
            Create my passkey
          </button>
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
