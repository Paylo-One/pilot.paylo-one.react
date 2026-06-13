/**
 * app/(marketing)/invite-unavailable/page.tsx
 *
 * Where the /join handler sends visitors whose referral link is no longer
 * usable (unknown, suspended, or fully used). Calm and non-alarming: explain
 * plainly and offer the standard request-access path forward.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";

export const metadata: Metadata = {
  title: "Invitation unavailable · Paylo.one Management OS",
  description:
    "This invitation link is no longer available. You can ask for access to Paylo.one Management OS instead.",
  robots: { index: false, follow: false },
};

export default function InviteUnavailablePage() {
  return (
    <main className="landing">
      <Link
        href="/"
        className="auth__brand"
        style={{
          color: "var(--colour-text-primary)",
          marginBottom: "var(--space-xl)",
        }}
      >
        <BrandMark size={28} />
        <div className="brand__wordmark">
          <PayloWordmark size={18} />
          <span
            className="brand__inst"
            style={{ color: "var(--colour-text-tertiary)" }}
          >
            Management OS
          </span>
        </div>
      </Link>

      <p className="eyebrow">Invitation</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-sm) 0 var(--space-md)",
        }}
      >
        This invitation link is no longer available
      </h1>
      <p
        className="text-secondary measure"
        style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-xl)" }}
      >
        The reference you used has already been fully used, or it is no longer
        active. If you were expecting to join a workspace, ask the person who
        shared it for a fresh link.
      </p>

      <Link href="/request-access" className="btn btn--primary">
        Request access instead
      </Link>
    </main>
  );
}
