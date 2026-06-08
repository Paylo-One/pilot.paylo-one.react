/**
 * app/(auth)/sign-in/page.tsx
 *
 * Sign-in surface. Ships the passkey-READY interim method (magic link via
 * Supabase Auth); passkeys (authentication-architecture.md §5) replace it later
 * without changing tenant binding or RLS. If already signed in, bounce to
 * onboarding (which forwards to the user's workspace).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Paylo.one",
  robots: { index: false, follow: false },
};

export default async function SignInPage() {
  const user = await getSignedInUser();
  if (user) redirect("/onboarding");

  return (
    <>
      <p className="eyebrow">Sign in</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
        Return to your management layer
      </h1>
      <p
        className="text-secondary"
        style={{ marginBottom: "var(--space-lg)", fontSize: "var(--text-small)" }}
      >
        Access is invite-only. Sign in to open your workspace at
        &lt;slug&gt;.paylo.one.
      </p>

      <SignInForm />

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Passkey-ready interim sign-in (magic link). Passkeys are the target
        primary credential (RP ID = paylo.one, one passkey across every
        &lt;slug&gt;.paylo.one); they slot in later without changing tenant
        binding or RLS.
      </p>
    </>
  );
}
