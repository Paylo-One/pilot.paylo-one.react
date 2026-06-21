"use client";

import { useState } from "react";
import {
  STRIPE_BILLING_PRICE_OPTIONS,
  STRIPE_BILLING_TIERS,
  type StripeBillingPriceOption,
} from "@/modules/billing/stripe-plans";

async function postForUrl(path: string, body?: unknown): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Could not start billing flow.");
  }
  return payload.url;
}

export function BillingActions({
  canManage,
  currentPriceOption,
}: {
  canManage: boolean;
  currentPriceOption: StripeBillingPriceOption["key"] | null;
}) {
  const [busy, setBusy] = useState<StripeBillingPriceOption["key"] | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(priceOption: StripeBillingPriceOption) {
    setBusy(priceOption.key);
    setError(null);
    try {
      const url = await postForUrl("/api/billing/create-checkout-session", {
        priceOption: priceOption.key,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(null);
    }
  }

  async function managePortal() {
    setBusy("portal");
    setError(null);
    try {
      const url = await postForUrl("/api/billing/create-customer-portal-session");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--space-sm)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--space-sm)",
        }}
      >
        {STRIPE_BILLING_TIERS.map((tier) => {
          const options = STRIPE_BILLING_PRICE_OPTIONS.filter(
            (option) => option.tierKey === tier.key,
          );
          return (
            <div key={tier.key} className="card card--sunken" style={{ padding: "var(--space-md)" }}>
              <p className="eyebrow">{tier.name}</p>
              <p className="action-card__rationale" style={{ marginTop: 4 }}>
                {tier.summary}
              </p>
              <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", marginTop: "var(--space-md)" }}>
                {options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`btn ${currentPriceOption === option.key ? "btn--secondary" : "btn--primary"}`}
                    disabled={busy !== null}
                    onClick={() => startCheckout(option)}
                  >
                    <span>
                      {busy === option.key
                        ? "Opening..."
                        : currentPriceOption === option.key
                          ? `Keep ${option.interval}`
                          : `Choose ${option.interval}`}
                    </span>
                    <span style={{ display: "block", fontSize: "0.82rem", opacity: 0.78, marginTop: 3 }}>
                      {option.displayPrice} {option.displayCadence}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!canManage || busy !== null}
          onClick={managePortal}
        >
          {busy === "portal" ? "Opening..." : "Manage subscription"}
        </button>
      </div>
      {error ? <p className="alert alert--risk">{error}</p> : null}
    </div>
  );
}
