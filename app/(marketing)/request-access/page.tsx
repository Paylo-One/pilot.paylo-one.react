/**
 * app/(marketing)/request-access/page.tsx
 *
 * Public request-access surface on the apex/neutral host. Paylo.one is
 * invite-only; this is how an interested operator asks to be let in. No session
 * is required and none is created here — the form stores the request for the
 * team to review.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";
import { RequestAccessForm } from "./request-access-form";

export const metadata: Metadata = {
  title: "Request access · Pilot by Paylo.one",
  description:
    "Ask for an invitation to Pilot by Paylo.one, a private place to run your decisions, people, and daily priorities from one calm view.",
  robots: { index: true, follow: true },
};

export default function RequestAccessPage() {
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
            Pilot
          </span>
        </div>
      </Link>

      <p className="eyebrow">Request access</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-sm) 0 var(--space-md)",
        }}
      >
        Ask for an invitation
      </h1>
      <p
        className="text-secondary measure"
        style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-xl)" }}
      >
        Paylo One is invite-only, so we can keep the early network small and
        considered. Tell us a little about yourself and what you want to get on
        top of, and we will be in touch if it is a fit. It takes under a minute.
      </p>

      <RequestAccessForm />

      <p
        className="text-tertiary"
        style={{ fontSize: "var(--text-small)", marginTop: "var(--space-lg)" }}
      >
        We use your details only to review your request and get in touch. No
        marketing, no sharing.
      </p>
    </main>
  );
}
