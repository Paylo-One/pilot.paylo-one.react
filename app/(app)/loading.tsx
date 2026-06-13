/**
 * app/(app)/loading.tsx
 *
 * The Suspense fallback for every workspace route. Because the screens
 * (Briefing, Actions, Diary, People, Sources, Settings…) are async server
 * components that wait on the backend, navigating between them used to leave
 * the previous screen frozen on screen. This fallback renders instantly while
 * the next screen's data loads, so a transition reads as motion, not a stall.
 *
 * The command layer (sidebar) and topbar belong to the layout and stay put;
 * only the content column swaps to this loader. The animation is the brand
 * "Convergence" mark (components/brand-mark.tsx) brought to life: five signals
 * flow into the single teal focal point — synthesis in progress. Pure CSS, no
 * JavaScript, and it collapses to a calm static mark under reduced-motion.
 */

const RAILS = [
  { y1: 3, width: 1.5 },
  { y1: 16, width: 2 },
  { y1: 32, width: 2.5 },
  { y1: 48, width: 2 },
  { y1: 61, width: 1.5 },
];

export default function WorkspaceLoading() {
  return (
    <div
      className="route-loader"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <svg
        className="route-loader__mark"
        width="92"
        height="74"
        viewBox="0 0 80 64"
        fill="none"
        aria-hidden="true"
      >
        {/* Faint rails — the static structure of the mark. */}
        <g className="route-loader__rails">
          {RAILS.map((rail, i) => (
            <line
              key={`rail-${i}`}
              x1="0"
              y1={rail.y1}
              x2="62"
              y2="32"
              stroke="currentColor"
              strokeWidth={rail.width}
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Signals — a pulse travels each rail toward the focal point. */}
        <g className="route-loader__signals">
          {RAILS.map((rail, i) => (
            <line
              key={`signal-${i}`}
              className="route-loader__signal"
              x1="0"
              y1={rail.y1}
              x2="62"
              y2="32"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* The focal point — where the signals resolve. */}
        <circle className="route-loader__glow" cx="68" cy="32" r="9" />
        <circle className="route-loader__focus" cx="68" cy="32" r="4" />
      </svg>

      <p className="route-loader__label">One moment…</p>
    </div>
  );
}
