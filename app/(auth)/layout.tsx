/**
 * app/(auth)/layout.tsx
 *
 * Layout for the authentication surfaces (sign-in, invite acceptance), served on
 * the apex / neutral host. Authentication establishes WHO the user is; the
 * tenant is resolved separately, server-side, from the request host
 * (authentication-architecture.md §8). Governance:
 *   - governance/docs/architecture/authentication-architecture.md
 *   - governance/docs/services/identity-and-tenant.md
 *
 * Scaffold note: a static, centered shell. No session is established here and no
 * passkey/WebAuthn or Supabase Auth call is made.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-xl)",
      }}
    >
      <main className="app-main" style={{ maxWidth: "460px" }}>
        <div
          className="app-nav__brand"
          style={{ marginBottom: "var(--space-lg)" }}
        >
          Paylo.one
          <span
            className="mono"
            style={{
              display: "block",
              fontSize: "var(--text-label)",
              color: "var(--colour-text-tertiary)",
            }}
          >
            MANAGEMENT OS
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
