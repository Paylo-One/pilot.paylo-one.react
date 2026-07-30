"use client";

/**
 * components/people/person-form.tsx
 *
 * Add or edit a person. Create mode persists via `createPersonAction` (people +
 * email/phone identities + tags, RLS tenant-scoped); edit mode patches core
 * fields via `updatePersonAction`. Before creating, likely duplicates (matching
 * name or email among existing people) are flagged and require an explicit
 * "Save anyway", so near-duplicates are caught before they exist.
 */

import { useState, useTransition } from "react";
import {
  IMPORTANCE_LABELS,
  RELATIONSHIP_LABELS,
  type Person,
  type PersonImportanceLevel,
  type RelationshipType,
} from "@/modules/people/people.types";
import { createPersonAction, updatePersonAction } from "@/app/(app)/people/actions";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-small)",
  color: "var(--colour-text-secondary)",
  marginBottom: "var(--space-xs)",
};

/** The little existing-record shape duplicate detection needs. */
export interface PersonDuplicateCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly emails: readonly string[];
}

/** Split a comma/newline-separated field into a trimmed list. */
function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findDuplicate(
  name: string,
  emails: readonly string[],
  existing: readonly PersonDuplicateCandidate[],
): { match: PersonDuplicateCandidate; reason: string } | null {
  const lowerName = name.toLowerCase();
  const lowerEmails = new Set(emails.map((e) => e.toLowerCase()));
  for (const candidate of existing) {
    if (candidate.displayName.trim().toLowerCase() === lowerName) {
      return { match: candidate, reason: "has the same name" };
    }
    const sharedEmail = candidate.emails.find((e) => lowerEmails.has(e.toLowerCase()));
    if (sharedEmail) {
      return { match: candidate, reason: `already uses ${sharedEmail}` };
    }
  }
  return null;
}

export function PersonForm({
  person,
  existingPeople = [],
  onDone,
}: {
  /** When set, the form edits this person's core fields instead of creating. */
  person?: Person;
  /** Existing records to check for likely duplicates before creating. */
  existingPeople?: readonly PersonDuplicateCandidate[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = Boolean(person);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const displayName = String(fd.get("name") ?? "").trim();
    if (!displayName) {
      setError("A name is required.");
      return;
    }
    const emails = splitList(fd.get("emails"));

    // Warn once about a likely duplicate; a second submit saves anyway.
    if (!editing && !duplicateWarning) {
      const dup = findDuplicate(displayName, emails, existingPeople);
      if (dup) {
        setDuplicateWarning(
          `This may be a duplicate: “${dup.match.displayName}” ${dup.reason}. Save anyway, or cancel and open the existing record.`,
        );
        return;
      }
    }

    setError(null);
    startTransition(async () => {
      const shared = {
        displayName,
        roleTitle: String(fd.get("role") ?? "").trim() || null,
        organisation: String(fd.get("org") ?? "").trim() || null,
        relationshipType: String(fd.get("rel") ?? "peer") as RelationshipType,
        importance: String(fd.get("importance") ?? "normal") as PersonImportanceLevel,
        notes: String(fd.get("notes") ?? "").trim() || null,
      };
      const res = person
        ? await updatePersonAction({ personId: person.id, patch: shared })
        : await createPersonAction({
            ...shared,
            emails,
            phones: splitList(fd.get("phones")),
            tags: splitList(fd.get("tags")),
          });
      if (res.ok) onDone();
      else setError(res.error ?? "Save failed.");
    });
  }

  return (
    <form
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
      onSubmit={handleSubmit}
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">People</p>
          <h2 className="card__title">{editing ? `Edit ${person?.displayName}` : "Add a person"}</h2>
        </div>
      </div>

      <div className="grid grid--2">
        <div>
          <label htmlFor="pf-name" style={labelStyle}>Name</label>
          <input id="pf-name" name="name" className="input" placeholder="Jacques Becker" required disabled={pending} defaultValue={person?.displayName ?? ""} />
        </div>
        <div>
          <label htmlFor="pf-role" style={labelStyle}>Role / title</label>
          <input id="pf-role" name="role" className="input" placeholder="Head of Platform" disabled={pending} defaultValue={person?.roleTitle ?? ""} />
        </div>
        <div>
          <label htmlFor="pf-org" style={labelStyle}>Organisation</label>
          <input id="pf-org" name="org" className="input" placeholder="Paytec Global" disabled={pending} defaultValue={person?.organisation ?? ""} />
        </div>
        <div>
          <label htmlFor="pf-rel" style={labelStyle}>Relationship</label>
          <select id="pf-rel" name="rel" className="input" defaultValue={person?.relationshipType ?? "peer"} disabled={pending}>
            {(Object.keys(RELATIONSHIP_LABELS) as RelationshipType[]).map((r) => (
              <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-importance" style={labelStyle}>Importance</label>
          <select id="pf-importance" name="importance" className="input" defaultValue={person?.importance ?? "normal"} disabled={pending}>
            {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
              <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
            ))}
          </select>
        </div>
        {editing ? null : (
          <>
            <div>
              <label htmlFor="pf-tags" style={labelStyle}>Tags (comma-separated)</label>
              <input id="pf-tags" name="tags" className="input" placeholder="DevOps, Platform" disabled={pending} />
            </div>
            <div>
              <label htmlFor="pf-emails" style={labelStyle}>Email addresses</label>
              <input id="pf-emails" name="emails" className="input" placeholder="jacques@company.com" disabled={pending} />
            </div>
            <div>
              <label htmlFor="pf-phones" style={labelStyle}>Phone numbers</label>
              <input id="pf-phones" name="phones" className="input" placeholder="+27 82 555 0102" disabled={pending} />
            </div>
          </>
        )}
      </div>

      <div>
        <label htmlFor="pf-notes" style={labelStyle}>Notes</label>
        <textarea id="pf-notes" name="notes" className="textarea" rows={3} placeholder="Context worth remembering about this person…" disabled={pending} defaultValue={person?.notes ?? ""} />
      </div>

      {duplicateWarning ? (
        <p className="form-message form-message--warn" role="alert">{duplicateWarning}</p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? "Saving…" : duplicateWarning ? "Save anyway" : editing ? "Save changes" : "Save person"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        {error ? (
          <span role="status" style={{ fontSize: "var(--text-small)", color: "var(--colour-danger)" }}>{error}</span>
        ) : null}
      </div>
    </form>
  );
}
