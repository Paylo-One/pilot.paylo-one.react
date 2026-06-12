"use client";

/**
 * Client side of the fixed-origin passkey enrolment ceremony. Runs
 * auth.registerPasskey() on the app host (the only origin registered with the
 * Auth server), optionally names the credential, then returns to the caller
 * (tenant Settings) with the outcome in query params so the tenant host can
 * mint its audit trail:
 *
 *   success → return_to + ?passkey_registered=<id>&passkey_label=<name>
 *   cancel  → return_to (no params)
 *
 * The ceremony starts from a button, not on mount: browsers (Safari in
 * particular) require a user gesture for navigator.credentials.create().
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

function withResultParams(returnTo: string, id: string, label: string): string {
  const url = new URL(returnTo, window.location.origin);
  url.searchParams.set("passkey_registered", id);
  if (label) url.searchParams.set("passkey_label", label);
  return url.toString();
}

export function EnrollPasskeyForm({
  returnTo,
  initialLabel,
}: {
  returnTo: string;
  initialLabel: string;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null on the server snapshot so SSR and hydration agree.
  const supported = useSyncExternalStore(subscribeNever, passkeySupported, () => null);

  async function enroll() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.registerPasskey();
      if (error) throw error;

      const trimmed = label.trim();
      if (data?.id && trimmed) {
        // Best-effort rename; the passkey exists either way.
        await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: trimmed });
      }
      window.location.assign(
        data?.id ? withResultParams(returnTo, data.id, trimmed) : returnTo,
      );
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Passkey creation was cancelled."
          : cause instanceof Error
            ? cause.message
            : "Could not create the passkey.",
      );
      setBusy(false);
    }
  }

  if (supported === false) {
    return (
      <div className="card">
        <p className="form-message form-message--error">
          This browser context does not support passkeys (WebAuthn needs a
          secure https context).
        </p>
        <a className="btn btn--ghost" href={returnTo}>
          Back to settings
        </a>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="passkey_label" className="field__label">
          Passkey label
        </label>
        <input
          id="passkey_label"
          type="text"
          className="input"
          placeholder='e.g. "MacBook Touch ID"'
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy || supported !== true}
        onClick={enroll}
        style={{ marginTop: "var(--space-md)" }}
      >
        {busy ? "Waiting for your authenticator…" : "Create the passkey"}
      </button>
      <a
        className="btn btn--ghost btn--block"
        href={returnTo}
        style={{ marginTop: "var(--space-sm)" }}
      >
        Cancel
      </a>
      {error ? <p className="form-message form-message--error">{error}</p> : null}
    </div>
  );
}
