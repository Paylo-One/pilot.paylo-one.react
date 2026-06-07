/**
 * app/(marketing)/page.tsx
 *
 * Root path `/`. Host-aware:
 *   - On a tenant subdomain (proxy set the tenant-slug header) → forward to the
 *     workspace; the gated (app) layout enforces membership.
 *   - On the apex/neutral host, signed-in operators go to onboarding (which
 *     forwards to their workspace); everyone else sees the invite landing with a
 *     sign-in link.
 */

import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/modules/identity-tenant/server";

const TENANT_SLUG_HEADER = "x-paylo-tenant-slug";

export default async function AppApexLanding() {
  const tenantSlug = (await headers()).get(TENANT_SLUG_HEADER);
  if (tenantSlug) {
    // Tenant host: the root opens the workspace (Briefing is the wedge).
    redirect("/briefing");
  }

  const user = await getSignedInUser();
  if (user) redirect("/onboarding");

  return (
    <main className="app-main">
      <p className="eyebrow">Paylo.one · Management OS</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "8px 0 16px" }}>
        A private management operating system for high-context leaders.
      </h1>
      <p style={{ color: "var(--colour-text-secondary)", maxWidth: "60ch" }}>
        Consolidate the channels you already run on into a high-signal Daily
        Memo, suggested actions held for your approval, and a private diary. Each
        operator works inside their own isolated workspace at{" "}
        <span className="mono">&lt;slug&gt;.paylo.one</span>. Access is
        invite-only.
      </p>

      <div style={{ marginTop: "var(--space-lg)", display: "flex", gap: "var(--space-md)" }}>
        <Link
          href="/sign-in"
          className="btn"
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: "var(--radius-md)",
            background: "var(--colour-accent)",
            color: "var(--colour-accent-on)",
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
