"use client";

/**
 * app/(app)/companies/error.tsx
 *
 * Error boundary for the Companies surface. Loading a company, its people, or
 * its relationship graph can fail loud (rather than silently render a company
 * stripped of connections, or connections with the operator's own diary-linked
 * edges quietly removed) — so the operator sees a calm, recoverable state
 * instead of a blank screen or a raw stack trace. Copy stays in the product's
 * voice, mirroring the Briefing, Actions, and People surfaces.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function CompaniesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[companies] render error", error);
  }, [error]);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Companies</p>
        <h1 className="page-head__title">We couldn&rsquo;t load this company</h1>
        <p className="page-head__lead">
          Something interrupted us while loading this view. Your data is safe
          and nothing was changed. Try again in a moment.
        </p>
      </div>
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button type="button" className="btn btn--primary" onClick={reset}>
          Retry
        </button>
        <Link href="/briefing" className="btn btn--secondary">
          Back to briefing
        </Link>
      </div>
    </main>
  );
}
