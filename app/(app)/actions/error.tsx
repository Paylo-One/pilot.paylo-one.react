"use client";

/**
 * Error boundary for the Actions surface. Calm, honest, actionable: what
 * happened, that nothing was changed, and the recovery path.
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
