"use client";

/**
 * components/sources/source-search.tsx
 *
 * Search input for the Connected Sources page. Controlled; filters source types
 * by name/provider/description. Purely presentational — the browser owns the
 * query state and the filtering.
 */

export function SourceSearch({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (next: string) => void;
  resultCount: number;
}) {
  return (
    <div className="source-search">
      <span className="source-search__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
      </span>
      <input
        type="search"
        className="input source-search__input"
        placeholder="Search connected source types…"
        value={value}
        aria-label="Search connected source types"
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="source-search__count mono" aria-live="polite">
        {resultCount} source{resultCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
