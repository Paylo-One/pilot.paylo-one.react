"use client";

/**
 * Passkey enrolment + device management for the Settings security section.
 * Drives the WebAuthn ceremony in the browser (@simplewebauthn/browser) against
 * the beginPasskeyRegistrationAction / completePasskeyRegistrationAction server
 * actions; the attestation is verified and stored server-side only.
 *
 * Requires a secure context (https, or plain localhost): on plain-http dev
 * hosts (lvh.me) the browser disables WebAuthn, so the card explains instead
 * of failing.
 */

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type { PasskeyView } from "@/modules/authentication/server";
import {
  beginPasskeyRegistrationAction,
  completePasskeyRegistrationAction,
  renamePasskeyAction,
  revokePasskeyAction,
} from "./actions";

const ERROR_COPY: Record<string, string> = {
  challenge_expired: "The request expired — try again.",
  already_registered: "This device already has a passkey for your account.",
  attestation_not_verified: "The authenticator response could not be verified.",
};

function friendlyError(raw: string | null): string {
  if (!raw) return "Something went wrong — try again.";
  return ERROR_COPY[raw] ?? raw;
}

/** WebAuthn support never changes within a page lifetime — no updates to push. */
function subscribeNever(): () => void {
  return () => {};
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB");
}

export function PasskeysCard({ passkeys }: { passkeys: PasskeyView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  // null on the server snapshot so SSR and hydration agree; WebAuthn support
  // is only knowable in the browser.
  const supported = useSyncExternalStore(
    subscribeNever,
    () => browserSupportsWebAuthn(),
    () => null,
  );

  async function addPasskey() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { optionsJSON, token } = await beginPasskeyRegistrationAction();
      const response = await startRegistration({ optionsJSON });
      const result = await completePasskeyRegistrationAction({
        token,
        response,
        label: label.trim() || null,
      });
      if (!result.ok) {
        setError(friendlyError(result.error));
        return;
      }
      setLabel("");
      setNotice("Passkey created. Add a second one on another device so losing this one is a non-event.");
      startTransition(() => router.refresh());
    } catch (cause) {
      // The user dismissing the platform prompt surfaces as NotAllowedError.
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Passkey creation was cancelled."
          : friendlyError(cause instanceof Error ? cause.message : null),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel(credentialRowId: string) {
    const result = await renamePasskeyAction({ credentialRowId, label: editingLabel });
    if (!result.ok) {
      setError(friendlyError(result.error));
      return;
    }
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  async function revoke(credentialRowId: string) {
    setError(null);
    const result = await revokePasskeyAction({ credentialRowId });
    if (!result.ok) {
      setError(friendlyError(result.error));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      {passkeys.length > 0 ? (
        <div className="stack" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
          {passkeys.map((pk) => (
            <div className="meta-row" key={pk.id}>
              <span className="meta-row__key">
                {editingId === pk.id ? (
                  <input
                    type="text"
                    className="input"
                    value={editingLabel}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setEditingLabel(e.target.value)}
                  />
                ) : (
                  <>
                    {pk.label ?? "Unnamed passkey"}{" "}
                    <span className="badge badge--plain">
                      {pk.deviceType === "multi_device" ? "synced" : "device-bound"}
                    </span>
                  </>
                )}
              </span>
              <span className="meta-row__value">
                <span className="mono" style={{ marginRight: "var(--space-sm)" }}>
                  added {formatDate(pk.createdAt)}
                </span>
                {editingId === pk.id ? (
                  <>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => saveLabel(pk.id)}>
                      Save
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setEditingId(pk.id);
                        setEditingLabel(pk.label ?? "");
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => revoke(pk.id)}
                    >
                      Revoke
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
          No passkeys enrolled yet. Your account currently signs in with a magic
          link; add a passkey to enable phishing-resistant sign-in.
        </p>
      )}

      {supported !== false ? (
        <div className="field">
          <label htmlFor="passkey_label" className="field__label">
            New passkey label
          </label>
          <input
            id="passkey_label"
            type="text"
            className="input"
            placeholder='e.g. "MacBook Touch ID"'
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: "var(--space-sm)" }}
            disabled={busy || pending || supported !== true}
            onClick={addPasskey}
          >
            {busy ? "Waiting for your authenticator…" : "Create a passkey"}
          </button>
        </div>
      ) : (
        <p className="form-message form-message--error">
          This browser context does not support passkeys (WebAuthn needs a
          secure https context).
        </p>
      )}

      {error ? <p className="form-message form-message--error">{error}</p> : null}
      {notice ? <p className="form-message form-message--ok">{notice}</p> : null}
    </div>
  );
}
