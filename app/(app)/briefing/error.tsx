"use client";

/**
 * app/(app)/briefing/error.tsx
 *
 * Error boundary for the Briefing surface. If reading the latest briefing or its
 * inputs fails, the operator sees a calm, recoverable state — never a blank
 * screen or a raw stack trace. The brief copy stays in the product's voice and
 * offers a single clear way forward.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function BriefingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[briefing] render error", error);
  }, [error]);

  return (
    <main className="workspace__content">
      <div className="briefing">
        <header className="briefing__masthead">
          <div>
            <p className="eyebrow">Daily briefing</p>
            <h1 className="briefing__title">We couldn&apos;t load your briefing</h1>
            <p className="briefing__lead">
              Something interrupted us while assembling your briefing. Your data
              is safe and nothing was changed. Try again in a moment.
            </p>
          </div>
        </header>

        <div className="briefing-onboard">
          <h2 className="briefing-onboard__title">Let&apos;s try that again</h2>
          <p className="briefing-onboard__body">
            If this keeps happening, your sources may still be syncing. You can
            check their status while we recover.
          </p>
          <div className="briefing-onboard__cta">
            <button type="button" className="btn btn--primary" onClick={reset}>
              Retry
            </button>
            <Link href="/sources" className="btn btn--secondary">
              Check sources
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
