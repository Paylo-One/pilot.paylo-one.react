"use client";

/**
 * components/companies/company-form.tsx
 *
 * Add a company — persisted via `createCompanyAction` (company + domains +
 * aliases + tags, RLS tenant-scoped). Domains are the matching anchor: once a
 * company has a domain, Pilot can propose links to the people who email from it.
 */

import { useState, useTransition } from "react";
import { IMPORTANCE_LABELS, type PersonImportanceLevel } from "@/modules/people/people.types";
import {
  COMPANY_RELATIONSHIP_LABELS,
  type CompanyRelationshipType,
} from "@/modules/companies/company.types";
import { createCompanyAction } from "@/app/(app)/companies/actions";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-small)",
  color: "var(--colour-text-secondary)",
  marginBottom: "var(--space-xs)",
};

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CompanyForm({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      setError("A company name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createCompanyAction({
        name,
        relationshipType: String(fd.get("rel") ?? "other") as CompanyRelationshipType,
        importance: String(fd.get("importance") ?? "normal") as PersonImportanceLevel,
        notes: String(fd.get("notes") ?? "").trim() || null,
        domains: splitList(fd.get("domains")),
        aliases: splitList(fd.get("aliases")),
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
          <p className="eyebrow">Companies</p>
          <h2 className="card__title">Add a company</h2>
        </div>
      </div>

      <div className="grid grid--2">
        <div>
          <label htmlFor="cf-name" style={labelStyle}>Name</label>
          <input id="cf-name" name="name" className="input" placeholder="Acme Corp" required disabled={pending} />
        </div>
        <div>
          <label htmlFor="cf-rel" style={labelStyle}>Relationship</label>
          <select id="cf-rel" name="rel" className="input" defaultValue="other" disabled={pending}>
            {(Object.keys(COMPANY_RELATIONSHIP_LABELS) as CompanyRelationshipType[]).map((r) => (
              <option key={r} value={r}>{COMPANY_RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-importance" style={labelStyle}>Importance</label>
          <select id="cf-importance" name="importance" className="input" defaultValue="normal" disabled={pending}>
            {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
              <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-domains" style={labelStyle}>Domains (comma-separated)</label>
          <input id="cf-domains" name="domains" className="input" placeholder="acme.com, acme.io" disabled={pending} />
        </div>
        <div>
          <label htmlFor="cf-aliases" style={labelStyle}>Also known as</label>
          <input id="cf-aliases" name="aliases" className="input" placeholder="Acme, Acme Inc." disabled={pending} />
        </div>
        <div>
          <label htmlFor="cf-tags" style={labelStyle}>Tags (comma-separated)</label>
          <input id="cf-tags" name="tags" className="input" placeholder="Client, Strategic" disabled={pending} />
        </div>
      </div>

      <div>
        <label htmlFor="cf-notes" style={labelStyle}>Notes</label>
        <textarea id="cf-notes" name="notes" className="textarea" rows={3} placeholder="Context worth remembering about this company…" disabled={pending} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? "Saving…" : "Save company"}
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
