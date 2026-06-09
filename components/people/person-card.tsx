"use client";

/**
 * components/people/person-card.tsx
 *
 * A single person in the People directory. Shows identity, relationship,
 * importance, tags, and a quick count of mapped source identities + recent
 * signals. Selecting it opens the person detail. Presentational; data is mock.
 */

import {
  IMPORTANCE_LABELS,
  IMPORTANCE_TONE,
  RELATIONSHIP_LABELS,
  type Person,
} from "@/modules/people/people.types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function PersonCard({
  person,
  selected,
  onSelect,
}: {
  person: Person;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`person-card${selected ? " person-card--selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="person-card__head">
        <span className="person-card__avatar" aria-hidden="true">
          {initials(person.displayName)}
        </span>
        <div className="person-card__id">
          <p className="person-card__name">{person.displayName}</p>
          <p className="integration__kind">
            {person.roleTitle ?? "—"}
            {person.organisation ? ` · ${person.organisation}` : ""}
          </p>
        </div>
        <span className={`status status--${IMPORTANCE_TONE[person.importance]}`}>
          {IMPORTANCE_LABELS[person.importance]}
        </span>
      </div>

      {person.tags.length > 0 ? (
        <div className="person-card__tags">
          {person.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <p className="person-card__meta mono">
        {RELATIONSHIP_LABELS[person.relationshipType]} ·{" "}
        {person.identities.length} identit
        {person.identities.length === 1 ? "y" : "ies"} ·{" "}
        {person.signals.length} signal{person.signals.length === 1 ? "" : "s"}
      </p>
    </button>
  );
}
