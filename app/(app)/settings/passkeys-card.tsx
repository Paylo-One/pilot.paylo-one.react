"use client";

/**
 * Passkey enrolment + device management for the Settings security section,
 * backed by native Supabase WebAuthn (auth.registerPasskey / auth.passkey.*).
 * The browser SDK runs the whole ceremony and Supabase Auth owns the
 * credentials, so this component is fully client-side; it only calls a thin
 * server action to mint the tenant audit trail after a ceremony succeeds.
 *
 * Requires a secure context (https, or localhost): on plain-http dev hosts
 * (lvh.me) the browser disables WebAuthn, so the card explains instead of
 * failing.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { recordPasskeyAuditAction } from "./actions";

interface PasskeyItem {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

function subscribeNever(): () => void {
  return () => {};
}

function passkeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB");
}

export function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const supported = useSyncExternalStore(subscribeNever, passkeySupported, () => null);

  const refresh = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      setError(error.message);
      return;
    }
    setPasskeys((data ?? []) as PasskeyItem[]);
  }, []);

  useEffect(() => {
    // Only the supported branch shows a count; the unsupported branch renders
    // "—" regardless of `loaded`, so there is nothing to load there. The fetch
    // runs in an async IIFE so the setState happens in a deferred continuation,
    // not synchronously in the effect body.
    if (supported !== true) return;
    let active = true;
    void (async () => {
      await refresh();
      if (active) setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [supported, refresh]);

  async function addPasskey() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.registerPasskey();
      if (error) throw error;

      const newId = data?.id;
      const trimmed = label.trim();
      if (newId && trimmed) {
        await supabase.auth.passkey.update({ passkeyId: newId, friendlyName: trimmed });
      }
      if (newId) {
        await recordPasskeyAuditAction({
          action: "registered",
          credentialId: newId,
          label: trimmed || null,
        });
      }
      setLabel("");
      setNotice("Passkey created. Add a second one on another device so losing this one is a non-event.");
      await refresh();
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Passkey creation was cancelled."
          : cause instanceof Error
            ? cause.message
            : "Could not create the passkey.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel(passkeyId: string) {
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.passkey.update({
      passkeyId,
      friendlyName: editingLabel.trim(),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    await refresh();
  }

  async function revoke(passkeyId: string) {
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.passkey.delete({ passkeyId });
    if (error) {
      setError(error.message);
      return;
    }
    await recordPasskeyAuditAction({ action: "revoked", credentialId: passkeyId });
    await refresh();
  }

  return (
    <div>
      <div className="meta-row">
        <span className="meta-row__key">Enrolled passkeys</span>
        <span className="meta-row__value mono">
          {supported === false ? "—" : loaded ? passkeys.length : "…"}
        </span>
      </div>

      {passkeys.length > 0 ? (
        <div className="stack" style={{ gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
          {passkeys.map((pk) => (
            <div className="meta-row" key={pk.id}>
              <span className="meta-row__key">
                {editingId === pk.id ? (
                  <input
                    type="text"
                    className="input"
                    value={editingLabel}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setEditingLabel(e.target.value)}
                  />
                ) : (
                  pk.friendly_name || "Unnamed passkey"
                )}
              </span>
              <span className="meta-row__value">
                <span className="mono" style={{ marginRight: "var(--space-sm)" }}>
                  {pk.last_used_at ? `used ${formatDate(pk.last_used_at)}` : `added ${formatDate(pk.created_at)}`}
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
                        setEditingLabel(pk.friendly_name ?? "");
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => revoke(pk.id)}>
                      Revoke
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : loaded && supported === true ? (
        <p className="action-card__rationale" style={{ margin: "var(--space-md) 0" }}>
          No passkeys enrolled yet. Add one to enable phishing-resistant sign-in;
          the magic link remains as a fallback.
        </p>
      ) : null}

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
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: "var(--space-sm)" }}
            disabled={busy || supported !== true}
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
