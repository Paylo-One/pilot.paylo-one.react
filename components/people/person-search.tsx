"use client";

/**
 * components/people/person-search.tsx
 *
 * Search the People directory by name, role, organisation, tag, or identity.
 * Controlled; the browser owns the query.
 */

export function PersonSearch({
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
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
      </span>
      <input
        type="search"
        className="input source-search__input"
        placeholder="Search people, roles, tags, identities…"
        value={value}
        aria-label="Search people"
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="source-search__count mono" aria-live="polite">
        {resultCount} {resultCount === 1 ? "person" : "people"}
      </span>
    </div>
  );
}
