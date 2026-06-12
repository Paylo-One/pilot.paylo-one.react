"use client";

/**
 * Passkey management for the Settings security section, backed by native
 * Supabase WebAuthn (auth.passkey.*).
 *
 * Enrolment does NOT run here: the Auth server matches WebAuthn origins
 * exactly (no wildcards, max 5), so the create() ceremony cannot run on
 * arbitrary tenant hosts. "Create a passkey" hands off to the fixed-origin
 * page on the app host (/enroll-passkey) with a return_to back to this page;
 * the result comes back as ?passkey_registered=<id>&passkey_label=<name>,
 * which this card turns into the tenant audit trail. List / rename / revoke
 * are plain REST calls (no ceremony) and stay on the tenant host.
 *
 * Requires a secure context (https, or localhost): on plain-http dev hosts
 * (lvh.me) the browser disables WebAuthn, so the card explains instead of
 * failing.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { appHostBaseUrl } from "@/lib/config";
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

  // Returning from the fixed-origin enrolment page: the ceremony already
  // succeeded on the app host, so record the tenant audit trail here (this is
  // the host with tenant context), then clean the URL. The params are stripped
  // synchronously before the async work so a re-mount cannot double-record.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const newId = params.get("passkey_registered");
    if (!newId) return;
    const newLabel = params.get("passkey_label");
    params.delete("passkey_registered");
    params.delete("passkey_label");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : ""),
    );
    void (async () => {
      await recordPasskeyAuditAction({
        action: "registered",
        credentialId: newId,
        label: newLabel || null,
      });
      setNotice(
        "Passkey created. Add a second one on another device so losing this one is a non-event.",
      );
      await refresh();
    })();
  }, [refresh]);

  /**
   * Hand off to the fixed-origin enrolment page on the app host — the only
   * origin the Auth server accepts WebAuthn ceremonies from. The apex-scoped
   * session cookie travels with the user; they come straight back here.
   */
  function addPasskey() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const target = new URL("/enroll-passkey", appHostBaseUrl());
    target.searchParams.set("return_to", window.location.href);
    const trimmed = label.trim();
    if (trimmed) target.searchParams.set("label", trimmed);
    window.location.assign(target.toString());
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
            {busy ? "Opening the secure enrolment page…" : "Create a passkey"}
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
