"use client";

/**
 * components/people/person-form.tsx
 *
 * Add a person — persisted via `createPersonAction` (people + email/phone
 * identities + tags, RLS tenant-scoped). Emails/phones are stored as `generic`
 * identities so correlation can match on them later.
 */

import { useState, useTransition } from "react";
import {
  IMPORTANCE_LABELS,
  RELATIONSHIP_LABELS,
  type PersonImportanceLevel,
  type RelationshipType,
} from "@/modules/people/people.types";
import { createPersonAction } from "@/app/(app)/people/actions";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-small)",
  color: "var(--colour-text-secondary)",
  marginBottom: "var(--space-xs)",
};

/** Split a comma/newline-separated field into a trimmed list. */
function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function PersonForm({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const displayName = String(fd.get("name") ?? "").trim();
    if (!displayName) {
      setError("A name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createPersonAction({
        displayName,
        roleTitle: String(fd.get("role") ?? "").trim() || null,
        organisation: String(fd.get("org") ?? "").trim() || null,
        relationshipType: (String(fd.get("rel") ?? "peer") as RelationshipType),
        importance: (String(fd.get("importance") ?? "normal") as PersonImportanceLevel),
        notes: String(fd.get("notes") ?? "").trim() || null,
        emails: splitList(fd.get("emails")),
        phones: splitList(fd.get("phones")),
        tags: splitList(fd.get("tags")),
      });
      if (res.ok) onCreated();
      else setError(res.error ?? "Create failed.");
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
          <h2 className="card__title">Add a person</h2>
        </div>
      </div>

      <div className="grid grid--2">
        <div>
          <label htmlFor="pf-name" style={labelStyle}>Name</label>
          <input id="pf-name" name="name" className="input" placeholder="Jacques Becker" required disabled={pending} />
        </div>
        <div>
          <label htmlFor="pf-role" style={labelStyle}>Role / title</label>
          <input id="pf-role" name="role" className="input" placeholder="Head of Platform" disabled={pending} />
        </div>
        <div>
          <label htmlFor="pf-org" style={labelStyle}>Organisation</label>
          <input id="pf-org" name="org" className="input" placeholder="Paytec Global" disabled={pending} />
        </div>
        <div>
          <label htmlFor="pf-rel" style={labelStyle}>Relationship</label>
          <select id="pf-rel" name="rel" className="input" defaultValue="peer" disabled={pending}>
            {(Object.keys(RELATIONSHIP_LABELS) as RelationshipType[]).map((r) => (
              <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-importance" style={labelStyle}>Importance</label>
          <select id="pf-importance" name="importance" className="input" defaultValue="normal" disabled={pending}>
            {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
              <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
            ))}
          </select>
        </div>
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
      </div>

      <div>
        <label htmlFor="pf-notes" style={labelStyle}>Notes</label>
        <textarea id="pf-notes" name="notes" className="textarea" rows={3} placeholder="Context worth remembering about this person…" disabled={pending} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? "Saving…" : "Save person"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCreated} disabled={pending}>
          Cancel
        </button>
        {error ? (
          <span role="status" style={{ fontSize: "var(--text-small)", color: "var(--colour-danger)" }}>{error}</span>
        ) : null}
      </div>
    </form>
  );
}
