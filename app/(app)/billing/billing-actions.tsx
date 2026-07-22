"use client";

import { useState } from "react";

async function postForUrl(path: string): Promise<string> {
  const response = await fetch(path, { method: "POST" });
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Could not start billing flow.");
  }
  return payload.url;
}

/**
 * Manage-subscription action — opens the Stripe customer portal so an existing
 * subscriber can update payment details, change plan, or cancel. Disabled until
 * a Stripe customer is linked to the workspace.
 */
export function ManageSubscriptionButton({ canManage }: { canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function managePortal() {
    setBusy(true);
    setError(null);
    try {
      const url = await postForUrl("/api/billing/create-customer-portal-session");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--space-sm)" }}>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!canManage || busy}
          onClick={managePortal}
        >
          {busy ? "Opening…" : "Manage subscription"}
        </button>
      </div>
      {!canManage ? (
        <p className="scaffold-note">
          Subscription management opens once you have an active paid plan.
        </p>
      ) : null}
      {error ? <p className="alert alert--risk">{error}</p> : null}
    </div>
  );
}

/**
 * Manage-billing action for Paddle-fulfilled subscriptions (public
 * self-service tiers bought on the marketing site). Opens the Paddle customer
 * portal; rendered only when a Paddle customer is linked to the workspace.
 */
export function ManagePaddleBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const url = await postForUrl("/api/billing/paddle-portal");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--space-sm)" }}>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={openPortal}
        >
          {busy ? "Opening…" : "Manage billing"}
        </button>
      </div>
      {error ? <p className="alert alert--risk">{error}</p> : null}
    </div>
  );
}
