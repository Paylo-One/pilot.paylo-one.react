/**
 * app/(marketing)/page.tsx
 *
 * Apex (paylo.one) entry for the APPLICATION. The full public marketing site is
 * a separate project (../site); this surface is the invite/landing shown when
 * the app is reached on the apex rather than a tenant subdomain
 * (technical-design.md: "(marketing) public, apex paylo.one").
 *
 * Scaffold note: static placeholder.
 */

export default function AppApexLanding() {
  return (
    <main className="app-main">
      <p className="eyebrow">Paylo.one · Management OS</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "8px 0 16px" }}>
        A private management operating system for high-context leaders.
      </h1>
      <p style={{ color: "var(--colour-text-secondary)", maxWidth: "60ch" }}>
        This is the application shell. Operators work inside their own tenant
        workspace at <span className="mono">&lt;slug&gt;.paylo.one</span>. Access
        is invite-only.
      </p>
      <p className="scaffold-note" style={{ marginTop: "24px" }}>
        Scaffold: routing, tenancy, auth, and the governed Model and Tool
        gateways are stubbed and documented, not yet implemented.
      </p>
    </main>
  );
}
