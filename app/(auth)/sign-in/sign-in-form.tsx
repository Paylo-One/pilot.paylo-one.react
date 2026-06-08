"use client";

/**
 * Magic-link sign-in form. Calls Supabase Auth `signInWithOtp` with the browser
 * client; the email link returns to /auth/callback (apex), which exchanges the
 * code for a session cookie scoped to the apex (shared across tenant
 * subdomains). This is the passkey-READY interim method
 * (authentication-architecture.md §11); passkeys replace it without changing
 * tenant binding or RLS.
 */

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

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
        className="btn btn--primary btn--block"
        style={{ marginTop: "var(--space-md)" }}
      >
        {status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {error && <p className="form-message form-message--error">{error}</p>}
    </form>
  );
}
