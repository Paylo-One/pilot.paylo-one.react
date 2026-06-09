"use client";

/**
 * components/refinement/person-link-control.tsx
 *
 * Inline "linked person" control: shows the currently-linked person (or "link a
 * person") and lets the operator correct it — the core person-correlation
 * feedback. Scaffold: selection updates local state only; in MVP this would
 * write a CorrelationFeedback event + (optionally) a standing rule.
 */

import { useState } from "react";
import { MOCK_PEOPLE } from "@/modules/people/people-service";

export function PersonLinkControl({
  targetId,
  initialPersonId = null,
}: {
  targetId: string;
  initialPersonId?: string | null;
}) {
  const [personId, setPersonId] = useState<string | null>(initialPersonId);
  const [editing, setEditing] = useState(false);

  const person = MOCK_PEOPLE.find((p) => p.id === personId) ?? null;

  if (editing) {
    return (
      <span className="person-link" data-target-id={targetId}>
        <select
          className="input person-link__select"
          value={personId ?? ""}
          onChange={(e) => {
            setPersonId(e.target.value || null);
            setEditing(false);
          }}
          aria-label="Link to person"
        >
          <option value="">Unlinked</option>
          {MOCK_PEOPLE.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </span>
    );
  }

  return (
    <span className="person-link" data-target-id={targetId}>
      {person ? (
        <span className="chip chip--accent">Linked: {person.displayName}</span>
      ) : (
        <span className="chip">No linked person</span>
      )}
      <button type="button" className="feedback-chip" onClick={() => setEditing(true)}>
        {person ? "Wrong person?" : "Link to person"}
      </button>
    </span>
  );
}
