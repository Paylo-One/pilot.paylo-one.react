/**
 * app/(auth)/sign-in/page.tsx
 *
 * Sign-in surface — the front door to the workspace. Passkey-first (WebAuthn
 * assertion, authentication-architecture.md §5) with the magic link (Supabase
 * Auth) as the fallback; both establish the same session, tenant binding, and
 * RLS. If already signed in, bounce to onboarding (which forwards to the user's
 * workspace).
 *
 * The callbacks (/auth/confirm, OAuth, tenant guards) redirect here with a
 * `?error=` code when something interrupts a sign-in; `notice()` turns those
 * into calm, non-technical guidance instead of leaking raw provider messages.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { noticeFor } from "./notice";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Pilot by Paylo.one",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; existing?: string }>;
}) {
  const user = await getSignedInUser();
  if (user) redirect("/onboarding");

  const params = await searchParams;
  const notice = noticeFor(params);

  return (
    <div className="auth-stack">
      <header className="auth-head">
        <h1 className="auth-head__title">Open your workspace</h1>
        <p className="auth-head__sub">
          Secure access to your private operating layer. New workspaces are
          created by invitation only.
        </p>
      </header>

      {notice ? (
        <p className={`auth-notice auth-notice--${notice.tone}`} role="status">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 12h1v4h1" />
          </svg>
          <span>{notice.message}</span>
        </p>
      ) : null}

      <SignInForm />

      <p className="auth-alt">
        New here?{" "}
        <Link href="/request-access">Request access</Link> — Pilot is invite-only
        while we&rsquo;re in private beta.
      </p>

      <p className="auth-privacy">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Private by design. We only show what your account is allowed to see.
      </p>
    </div>
  );
}
