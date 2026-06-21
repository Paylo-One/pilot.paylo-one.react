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

export function BillingActions({
  canManage,
}: {
  canManage: boolean;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "checkout" | "portal") {
    setBusy(kind);
    setError(null);
    try {
      const url = await postForUrl(
        kind === "checkout"
          ? "/api/billing/create-checkout-session"
          : "/api/billing/create-customer-portal-session",
      );
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--space-sm)" }}>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null}
          onClick={() => go("checkout")}
        >
          {busy === "checkout" ? "Opening..." : "Choose plan"}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!canManage || busy !== null}
          onClick={() => go("portal")}
        >
          {busy === "portal" ? "Opening..." : "Manage subscription"}
        </button>
      </div>
      {error ? <p className="alert alert--risk">{error}</p> : null}
    </div>
  );
}
