/**
 * components/brand-mark.tsx
 *
 * The Paylo.one "Convergence" symbol — five weighted signals resolving to a
 * single teal point. Reproduced faithfully from the governance asset
 * (governance/design/logo/symbol/symbol-light.svg, viewBox 0 0 72 64).
 *
 * The strokes use `currentColor` so the mark adapts to its context — near-black
 * ink on light surfaces, light ink on the dark command layer — matching the
 * light/dark symbol variants. The focal point uses `--brand-accent` (deep teal
 * #157A86 by default; the command layer raises it to the lighter command accent
 * for contrast), matching the teal dot in the source asset.
 *
 * `size` sets the rendered height in px; width preserves the 72:64 aspect ratio.
 */

const STROKES = [
  { y1: 3, width: 1.5, opacity: 0.28 },
  { y1: 16, width: 2, opacity: 0.45 },
  { y1: 32, width: 2.5, opacity: 0.8 },
  { y1: 48, width: 2, opacity: 0.45 },
  { y1: 61, width: 1.5, opacity: 0.28 },
];

export function BrandMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const width = Math.round((size * 72) / 64);
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 72 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {STROKES.map((s, i) => (
        <line
          key={i}
          x1="0"
          y1={s.y1}
          x2="62"
          y2="32"
          stroke="currentColor"
          strokeWidth={s.width}
          strokeLinecap="round"
          opacity={s.opacity}
        />
      ))}
      {/* The focal point — the single resolved signal. */}
      <circle cx="68" cy="32" r="4" fill="var(--brand-accent, var(--colour-accent))" />
    </svg>
  );
}
