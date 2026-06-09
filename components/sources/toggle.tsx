"use client";

/**
 * components/sources/toggle.tsx
 *
 * A small accessible switch (pill track + thumb) used for activate/deactivate
 * affordances on the Connected Sources screen. Flat, hairline-led, teal when on
 * — consistent with the design system (globals.css).
 */

export function Toggle({
  pressed,
  onChange,
  label,
  disabled = false,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  /** Accessible label (visually hidden). */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      className={`switch${pressed ? " switch--on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}
