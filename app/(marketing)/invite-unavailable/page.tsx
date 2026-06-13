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

interface InviteUnavailablePageProps {
  searchParams: Promise<{ reason?: string }>;
}

const COPY = {
  "limit-reached": {
    eyebrow: "Invitation limit reached",
    title: "This referral has no invitations left",
    body:
      "The available places on this referral have already been used. Ask the person who shared it whether they can send you another valid referral.",
  },
  "referral-required": {
    eyebrow: "Invitation required",
    title: "A valid referral is required to register",
    body:
      "Paylo.one is currently invite-only. Open the personal referral link you were sent, or request access if you do not have one.",
  },
  invalid: {
    eyebrow: "Invalid invitation",
    title: "This referral link is not valid",
    body:
      "The link may be incomplete or no longer active. Ask the person who shared it to check the referral and send it again.",
  },
  unavailable: {
    eyebrow: "Invitation unavailable",
    title: "We could not verify this referral",
    body:
      "The referral could not be checked right now. Try the original link again, or request access if the problem continues.",
  },
} as const;

export default async function InviteUnavailablePage({
  searchParams,
}: InviteUnavailablePageProps) {
  const { reason } = await searchParams;
  const copy = COPY[reason as keyof typeof COPY] ?? COPY.invalid;

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

      <p className="eyebrow">{copy.eyebrow}</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-sm) 0 var(--space-md)",
        }}
      >
        {copy.title}
      </h1>
      <p
        className="text-secondary measure"
        style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-xl)" }}
      >
        {copy.body}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <Link href="/request-access" className="btn btn--primary">
          Request access
        </Link>
        <Link href="/sign-in?existing=1" className="btn btn--secondary">
          Sign in to an existing account
        </Link>
      </div>
    </main>
  );
}
