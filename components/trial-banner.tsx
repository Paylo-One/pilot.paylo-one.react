"use client";

import { useSyncExternalStore } from "react";

/**
 * TrialBanner
 *
 * App-wide strip shown below the topbar while the workspace is on its 7-day
 * free trial. It counts down to `endsAt` (the free-access end timestamp from
 * billing_access) and links back to Billing to choose a plan.
 *
 * The live time is read through useSyncExternalStore: the server snapshot is
 * `null` (a calm static label renders during SSR and the first client paint, so
 * there is never a hydration mismatch), and a one-second interval drives the
 * client snapshot once mounted.
 */

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

function breakdown(totalSeconds: number) {
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}

export function TrialBanner({ endsAt }: { endsAt: string }) {
  const endsAtMs = Date.parse(endsAt);

  // Returns whole seconds remaining (a primitive, so referential equality holds
  // between ticks). Server snapshot is null -> static label, no SSR mismatch.
  const secondsLeft = useSyncExternalStore(
    subscribe,
    () =>
      Number.isNaN(endsAtMs)
        ? 0
        : Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000)),
    () => null as number | null,
  );

  if (Number.isNaN(endsAtMs)) return null;

  const ended = secondsLeft !== null && secondsLeft <= 0;
  const parts = secondsLeft !== null ? breakdown(secondsLeft) : null;
  // The accent strip turns to the warning tone inside the final day.
  const isEnding = parts !== null && parts.days < 1 && !ended;

  const segments =
    parts === null
      ? []
      : [
          { value: parts.days, unit: parts.days === 1 ? "day" : "days" },
          { value: parts.hours, unit: "hrs" },
          { value: parts.minutes, unit: "min" },
          { value: parts.seconds, unit: "sec" },
        ];

  return (
    <div
      className={`trial-banner${isEnding ? " trial-banner--ending" : ""}`}
      role="status"
    >
      <div className="trial-banner__body">
        <span className="trial-banner__title">
          {ended
            ? "Your free trial has ended"
            : "Free trial — choose a plan before it ends"}
        </span>
        {parts !== null && !ended ? (
          <span className="trial-banner__count" aria-live="off">
            {segments.map((seg) => (
              <span className="trial-banner__seg" key={seg.unit}>
                <span className="trial-banner__num">
                  {String(seg.value).padStart(2, "0")}
                </span>
                <span className="trial-banner__unit">{seg.unit}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <a className="btn btn--primary btn--sm trial-banner__cta" href="/billing">
        {ended ? "Choose a plan" : "View plans"}
      </a>
    </div>
  );
}
