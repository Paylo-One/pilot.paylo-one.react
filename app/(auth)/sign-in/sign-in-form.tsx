"use client";

/**
 * Sign-in form: passkey-first (native Supabase WebAuthn) with the magic link as
 * the fallback. Both establish the same apex-scoped session cookie, so tenant
 * binding and RLS are identical regardless of method.
 *
 *   - signInWithPasskey() runs the full discoverable-credential ceremony
 *     (challenge → navigator.credentials.get() → verify → session) entirely on
 *     the Auth server; the user picks their account from the authenticator UI,
 *     so no email is needed up front.
 *   - signInWithOtp() emails a magic link back to /auth/callback. Existing-user
 *     sign-in disables account creation; the referral-only registration page
 *     opts into it after server-side validation.
 *
 * After either succeeds we send the user to /onboarding on the app host, which
 * forwards to their workspace (or claims a subdomain for a brand-new user).
 */

import { useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** WebAuthn support never changes within a page lifetime — no updates to push. */
function subscribeNever(): () => void {
  return () => {};
}

function passkeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export function SignInForm({
  mode = "sign-in",
}: {
  mode?: "sign-in" | "registration";
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // null on the server snapshot so SSR and hydration agree.
  const supported = useSyncExternalStore(subscribeNever, passkeySupported, () => null);

  async function signInWithPasskey() {
    setError(null);
    setPasskeyBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      window.location.assign("/onboarding");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Passkey sign-in was cancelled."
          : err instanceof Error
            ? err.message
            : "Passkey sign-in failed.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
          shouldCreateUser: mode === "registration",
        },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send the link.");
    }
  }

  if (status === "sent") {
    return (
      <div className="card">
        <p className="text-secondary">
          Check your inbox for a one-time link. Locally, open{" "}
          <a className="mono" href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
            Mailpit
          </a>{" "}
          to find it.
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      {mode === "sign-in" && supported !== false ? (
        <>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={passkeyBusy || supported !== true}
            onClick={signInWithPasskey}
            style={{ marginBottom: "var(--space-md)" }}
          >
            {passkeyBusy ? "Waiting for your passkey…" : "Sign in with a passkey"}
          </button>
          <p
            className="text-secondary mono"
            style={{ textAlign: "center", marginBottom: "var(--space-md)" }}
          >
            — or —
          </p>
        </>
      ) : null}

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="email" className="field__label">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email webauthn"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="input"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="btn btn--secondary btn--block"
        style={{ marginTop: "var(--space-md)" }}
      >
        {status === "sending"
          ? "Sending…"
          : mode === "registration"
            ? "Verify my email"
            : "Email me a sign-in link"}
      </button>
      {error && <p className="form-message form-message--error">{error}</p>}
    </form>
  );
}
