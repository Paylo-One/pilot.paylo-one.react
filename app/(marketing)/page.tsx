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
import { BrandMark } from "@/components/brand-mark";

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
    <main className="landing">
      <div
        className="auth__brand"
        style={{ color: "var(--colour-text-primary)", marginBottom: "var(--space-xl)" }}
      >
        <BrandMark size={28} />
        <div className="brand__wordmark">
          <span className="brand__product" style={{ color: "var(--colour-text-primary)" }}>
            Management<span className="brand__os" style={{ color: "var(--colour-text-primary)" }}>OS</span>
          </span>
          <span className="brand__inst" style={{ color: "var(--colour-text-tertiary)" }}>
            Paylo.one
          </span>
        </div>
      </div>

      <p className="eyebrow">A private management operating system</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-sm) 0 var(--space-md)" }}>
        Run your operating context from one calm management layer.
      </h1>
      <p className="text-secondary measure" style={{ fontSize: "var(--text-body)" }}>
        Every morning, know what matters, what changed, what needs approval, and
        what cannot slip. Source-referenced briefings for leaders managing
        decisions, actions, signals, and context across fragmented channels.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-sm)",
          margin: "var(--space-lg) 0",
        }}
      >
        <span className="badge badge--plain">Daily Memo</span>
        <span className="badge badge--plain">Suggested actions · your approval</span>
        <span className="badge badge--plain">Private diary</span>
        <span className="badge badge--plain">Source-referenced</span>
      </div>

      <p className="text-tertiary" style={{ fontSize: "var(--text-small)", marginBottom: "var(--space-lg)" }}>
        Each operator works inside their own isolated workspace at{" "}
        <span className="mono">&lt;slug&gt;.paylo.one</span>. Access is
        invite-only.
      </p>

      <Link href="/sign-in" className="btn btn--primary">
        Sign in
      </Link>
    </main>
  );
}
