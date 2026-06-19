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
import { PayloWordmark } from "@/components/paylo-wordmark";

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
          <PayloWordmark size={18} />
          <span className="brand__inst" style={{ color: "var(--colour-text-tertiary)" }}>
            Pilot
          </span>
        </div>
      </div>

      <p className="eyebrow">A calm intelligence layer for leaders</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-sm) 0 var(--space-md)" }}>
        Know what matters. Lose the noise.
      </h1>
      <p className="text-secondary measure" style={{ fontSize: "var(--text-body)" }}>
        Pilot pulls together the email, messages, calendar, and documents you
        already work across, then gives you one short briefing each morning: what
        matters today, what changed, what needs a decision, and what cannot slip.
        Source-backed Actions keep the commitments, people, and context behind
        the next move together. Built for leaders who carry a lot of context and
        cannot afford to lose any of it.
      </p>

      <ul className="stack" style={{ gap: "var(--space-sm)", margin: "var(--space-lg) 0" }}>
        <li className="text-secondary" style={{ fontSize: "var(--text-small)" }}>
          A clear daily brief, with every point traceable to where it came from
        </li>
        <li className="text-secondary" style={{ fontSize: "var(--text-small)" }}>
          Actions with their rationale and source, held for your approval
        </li>
        <li className="text-secondary" style={{ fontSize: "var(--text-small)" }}>
          A private space to keep your decisions and the thinking behind them
        </li>
      </ul>

      <p className="text-tertiary" style={{ fontSize: "var(--text-small)", marginBottom: "var(--space-lg)" }}>
        Your workspace is private to you. Access is invite-only while we are in
        private beta.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <Link href="/request-access" className="btn btn--primary">
          Request access
        </Link>
        <Link href="/sign-in" className="btn btn--secondary">
          Sign in
        </Link>
      </div>

      <footer className="landing__footer">
        <Link href="/terms">Terms and Conditions</Link>
        <Link href="/privacy">Privacy Policy</Link>
      </footer>
    </main>
  );
}
