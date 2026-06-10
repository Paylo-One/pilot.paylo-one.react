/**
 * components/paylo-wordmark.tsx
 *
 * The Paylo.one wordmark. "Paylo" renders in the surrounding text colour
 * (currentColor) so it adapts to light surfaces and the dark command layer;
 * ".one" carries the brand teal. On dark backgrounds set
 * `--wordmark-accent: var(--colour-command-accent)` on a parent (the lighter
 * teal that keeps contrast on the command layer) — otherwise the standard
 * accent applies.
 */

export function PayloWordmark({
  size = 18,
  className,
}: {
  /** Rendered height in px; width scales with the 124:28 viewBox. */
  size?: number;
  className?: string;
}) {
  const width = Math.round((size * 124) / 28);
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 124 28"
      className={className}
      role="img"
      aria-label="Paylo.one"
      style={{ overflow: "visible", display: "block" }}
    >
      <text
        x="0"
        y="21.5"
        fontFamily="var(--font-heading, var(--font-body))"
        fontSize="22"
        fontWeight="650"
        letterSpacing="-0.02em"
        fill="currentColor"
      >
        Paylo
        <tspan fill="var(--wordmark-accent, var(--colour-accent))">.one</tspan>
      </text>
    </svg>
  );
}
