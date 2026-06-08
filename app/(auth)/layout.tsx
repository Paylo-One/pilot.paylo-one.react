/**
 * app/(auth)/layout.tsx
 *
 * Layout for the authentication surfaces (sign-in, invite acceptance,
 * onboarding), served on the apex / neutral host. Authentication establishes
 * WHO the user is; the tenant is resolved separately, server-side, from the
 * request host (authentication-architecture.md §8). A calm, centred shell with
 * the product lockup — no session is established here.
 */

import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth" style={{ color: "var(--colour-text-primary)" }}>
      <main className="auth__panel">
        <div className="auth__brand" style={{ color: "var(--colour-text-primary)" }}>
          <BrandMark size={28} />
          <div className="brand__wordmark">
            <span className="brand__product" style={{ color: "var(--colour-text-primary)" }}>
              Management
              <span className="brand__os" style={{ color: "var(--colour-text-primary)" }}>
                OS
              </span>
            </span>
            <span className="brand__inst" style={{ color: "var(--colour-text-tertiary)" }}>
              Paylo.one
            </span>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
