"use client";

/**
 * components/settings/byo-model-card.tsx
 *
 * Bring-your-own-key model providers (ADR-038). The operator picks a provider
 * (Anthropic or OpenAI) and model, pastes their API key, and saves — which also
 * runs a real verification call. A verified provider can be made the workspace's
 * active routing choice; the workspace can revert to the Paylo-hosted default at
 * any time. The API key is write-only: it is sent to the server once and only a
 * masked hint (last 4) ever comes back.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PROVIDER_LABELS,
  PROVIDER_KEY_HINTS,
  SUGGESTED_MODELS,
  type TenantModelProvider,
  type TenantModelProviderKind,
  type TenantModelStatus,
} from "@/modules/tenant-models";
import {
  activateModelProviderAction,
  addModelProviderAction,
  removeModelProviderAction,
  revertToDefaultModelProviderAction,
  verifyModelProviderAction,
} from "@/app/(app)/settings/actions";

const STATUS_TONE: Record<TenantModelStatus, string> = {
  untested: "neutral",
  verified: "ok",
  failed: "risk",
};

const STATUS_LABEL: Record<TenantModelStatus, string> = {
  untested: "Not tested",
  verified: "Verified",
  failed: "Failed",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ByoModelCard({ providers }: { providers: readonly TenantModelProvider[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add form state.
  const [adding, setAdding] = useState(providers.length === 0);
  const [provider, setProvider] = useState<TenantModelProviderKind>("anthropic");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const hasActive = providers.some((p) => p.isActive);

  function reset() {
    setModelId("");
    setDisplayName("");
    setApiKey("");
  }

  function add() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await addModelProviderAction({ provider, modelId, displayName, apiKey });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setAdding(false);
      setMessage(
        res.status === "verified"
          ? "Key saved and verified. Make it active to route this workspace through it."
          : "Key saved, but the test call failed — check the key and model id, then test again.",
      );
      router.refresh();
    });
  }

  function run(
    action: () => Promise<{ ok: boolean; error: string | null }>,
    okMessage?: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        if (okMessage) setMessage(okMessage);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div>
      <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
        Route this workspace&apos;s AI processing through your own Anthropic or
        OpenAI account. Your key is stored encrypted server-side, used only via
        the Model Gateway, and never shown again. Leave this empty to use the
        Paylo-hosted default.
      </p>

      <div className="meta-row">
        <span className="meta-row__key">Active model</span>
        <span className="meta-row__value">
          {hasActive ? (
            <span className="status status--ok">Your key</span>
          ) : (
            <span className="badge badge--plain">Paylo-hosted default</span>
          )}
        </span>
      </div>

      {/* --- Registered providers ------------------------------------------- */}
      {providers.length > 0 ? (
        <div className="stack" style={{ gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
          {providers.map((p) => (
            <div
              key={p.id}
              className="stack"
              style={{
                gap: "var(--space-xs)",
                paddingBottom: "var(--space-sm)",
                borderBottom: "1px solid var(--colour-border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span className="badge">{PROVIDER_LABELS[p.provider]}</span>
                  <span className="mono">{p.modelId}</span>
                  <span className="mono text-tertiary">key {p.keyHint}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  {p.isActive ? <span className="status status--ok">In use</span> : null}
                  <span className={`status status--${STATUS_TONE[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </span>
              </div>

              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={pending}
                  onClick={() => run(() => verifyModelProviderAction({ id: p.id }), "Test complete.")}
                >
                  Test
                </button>
                {p.status === "verified" && !p.isActive ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => activateModelProviderAction({ id: p.id }), "Now routing through your key.")
                    }
                  >
                    Make active
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={pending}
                  onClick={() => run(() => removeModelProviderAction({ id: p.id }))}
                >
                  Remove
                </button>
              </div>

              {p.status === "failed" && p.lastError ? (
                <p className="form-message form-message--error" style={{ margin: 0 }}>
                  {p.lastError}
                </p>
              ) : (
                <p className="scaffold-note" style={{ margin: 0 }}>
                  {p.lastVerifiedAt ? `Verified ${formatDate(p.lastVerifiedAt)}` : "Not yet verified"}
                </p>
              )}
            </div>
          ))}

          {hasActive ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={pending}
              style={{ alignSelf: "flex-start" }}
              onClick={() =>
                run(() => revertToDefaultModelProviderAction(), "Reverted to the Paylo-hosted default.")
              }
            >
              Use the Paylo default instead
            </button>
          ) : null}
        </div>
      ) : null}

      {/* --- Add form -------------------------------------------------------- */}
      {adding ? (
        <div
          className="stack"
          style={{
            gap: "var(--space-md)",
            marginTop: "var(--space-md)",
            paddingTop: "var(--space-md)",
            borderTop: providers.length > 0 ? "1px solid var(--colour-border)" : "none",
          }}
        >
          <div className="grid grid--2">
            <div className="field">
              <label className="field__label" htmlFor="byo-provider">
                Provider
              </label>
              <select
                id="byo-provider"
                className="input"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as TenantModelProviderKind);
                  setModelId("");
                }}
              >
                <option value="anthropic">{PROVIDER_LABELS.anthropic}</option>
                <option value="openai">{PROVIDER_LABELS.openai}</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="byo-model">
                Model
              </label>
              <input
                id="byo-model"
                className="input"
                list="byo-model-options"
                placeholder={SUGGESTED_MODELS[provider][0]}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
              <datalist id="byo-model-options">
                {SUGGESTED_MODELS[provider].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="byo-key">
              API key
            </label>
            <input
              id="byo-key"
              className="input mono"
              type="password"
              autoComplete="off"
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="scaffold-note" style={{ marginTop: "var(--space-xs)" }}>
              {PROVIDER_KEY_HINTS[provider]}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="byo-label">
              Label <span className="text-tertiary">(optional)</span>
            </label>
            <input
              id="byo-label"
              className="input"
              placeholder="e.g. Acme Anthropic account"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={pending || !modelId.trim() || !apiKey.trim()}
              onClick={add}
            >
              {pending ? "Saving & testing…" : "Save & test key"}
            </button>
            {providers.length > 0 ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  reset();
                  setError(null);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          style={{ marginTop: "var(--space-md)" }}
          disabled={pending}
          onClick={() => setAdding(true)}
        >
          Add a provider key
        </button>
      )}

      {error ? <p className="form-message form-message--error">{error}</p> : null}
      {message ? <p className="form-message form-message--ok">{message}</p> : null}
    </div>
  );
}
