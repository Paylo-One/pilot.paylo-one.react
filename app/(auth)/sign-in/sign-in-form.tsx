"use client";

/**
 * Sign-in form: passkey-first (WebAuthn assertion via the sign-in server
 * actions) with the magic link as the fallback. The magic link calls Supabase
 * Auth `signInWithOtp` with the browser client; the email link returns to
 * /auth/callback, which exchanges the code for a session cookie scoped to the
 * apex (shared across tenant subdomains). Passkey login follows
 * authentication-architecture.md §5 — same session, tenant binding, and RLS.
 */

import { useState, useSyncExternalStore } from "react";
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  beginPasskeyLoginAction,
  completePasskeyLoginAction,
} from "./actions";

/** WebAuthn support never changes within a page lifetime — no updates to push. */
function subscribeNever(): () => void {
  return () => {};
}

const PASSKEY_ERROR_COPY: Record<string, string> = {
  challenge_expired: "The sign-in request expired — try again.",
  unknown_credential: "This passkey is not enrolled here. Use the magic link, then add it in Settings.",
  assertion_not_verified: "The passkey could not be verified.",
};

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // null on the server snapshot so SSR and hydration agree.
  const passkeySupported = useSyncExternalStore(
    subscribeNever,
    () => browserSupportsWebAuthn(),
    () => null,
  );

  async function signInWithPasskey() {
    setError(null);
    setPasskeyBusy(true);
    try {
      const { optionsJSON, token } = await beginPasskeyLoginAction();
      const response = await startAuthentication({ optionsJSON });
      const result = await completePasskeyLoginAction({ token, response });
      if (!result.ok || !result.redirectTo) {
        setError(PASSKEY_ERROR_COPY[result.error ?? ""] ?? result.error ?? "Passkey sign-in failed.");
        return;
      }
      window.location.assign(result.redirectTo);
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
        options: { emailRedirectTo },
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
          Check your inbox for a sign-in link. Locally, open{" "}
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
      {passkeySupported !== false ? (
        <>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={passkeyBusy || passkeySupported !== true}
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
          autoComplete="email"
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
        {status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {error && <p className="form-message form-message--error">{error}</p>}
    </form>
  );
}
