"use client";

/**
 * app/(app)/actions/error.tsx
 *
 * Error boundary for the Actions surface. Reading suggested actions can now fail
 * loud (rather than silently render an empty inbox, or actions stripped of their
 * source references) — so the operator sees a calm, recoverable state instead of
 * a blank screen or a raw stack trace. Copy stays in the product's voice and
 * offers a single clear way forward, mirroring the Briefing surface.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function ActionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[actions] render error", error);
  }, [error]);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Actions</p>
        <h1 className="page-head__title">We couldn&rsquo;t load your actions</h1>
        <p className="page-head__lead">
          Something interrupted us while loading the board. Your data is safe
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
