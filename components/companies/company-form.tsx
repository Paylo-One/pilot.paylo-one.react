"use client";

/**
 * components/companies/company-form.tsx
 *
 * Add or edit a company. Create mode persists via `createCompanyAction`
 * (company + domains + aliases + tags, RLS tenant-scoped); edit mode patches
 * core fields via `updateCompanyAction`. Domains are the matching anchor: once
 * a company has a domain, Pilot can propose links to the people who email from
 * it. Before creating, likely duplicates (matching name, alias, or domain) are
 * flagged and require an explicit "Save anyway".
 */

import { useState, useTransition } from "react";
import { IMPORTANCE_LABELS, type PersonImportanceLevel } from "@/modules/people/people.types";
import {
  COMPANY_RELATIONSHIP_LABELS,
  type Company,
  type CompanyRelationshipType,
} from "@/modules/companies/company.types";
import { createCompanyAction, updateCompanyAction } from "@/app/(app)/companies/actions";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-small)",
  color: "var(--colour-text-secondary)",
  marginBottom: "var(--space-xs)",
};

/** The little existing-record shape duplicate detection needs. */
export interface CompanyDuplicateCandidate {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly domains: readonly string[];
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findDuplicate(
  name: string,
  domains: readonly string[],
  existing: readonly CompanyDuplicateCandidate[],
): { match: CompanyDuplicateCandidate; reason: string } | null {
  const lowerName = name.toLowerCase();
  const lowerDomains = new Set(domains.map((d) => d.toLowerCase()));
  for (const candidate of existing) {
    if (candidate.name.trim().toLowerCase() === lowerName) {
      return { match: candidate, reason: "has the same name" };
    }
    if (candidate.aliases.some((a) => a.trim().toLowerCase() === lowerName)) {
      return { match: candidate, reason: `is also known as “${name}”` };
    }
    const sharedDomain = candidate.domains.find((d) => lowerDomains.has(d.toLowerCase()));
    if (sharedDomain) {
      return { match: candidate, reason: `already owns ${sharedDomain}` };
    }
  }
  return null;
}

export function CompanyForm({
  company,
  existingCompanies = [],
  onDone,
}: {
  /** When set, the form edits this company's core fields instead of creating. */
  company?: Company;
  /** Existing records to check for likely duplicates before creating. */
  existingCompanies?: readonly CompanyDuplicateCandidate[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = Boolean(company);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      setError("A company name is required.");
      return;
    }
    const domains = splitList(fd.get("domains"));

    // Warn once about a likely duplicate; a second submit saves anyway.
    if (!editing && !duplicateWarning) {
      const dup = findDuplicate(name, domains, existingCompanies);
      if (dup) {
        setDuplicateWarning(
          `This may be a duplicate: “${dup.match.name}” ${dup.reason}. Save anyway, or cancel and open the existing record.`,
        );
        return;
      }
    }

    setError(null);
    startTransition(async () => {
      const shared = {
        name,
        relationshipType: String(fd.get("rel") ?? "other") as CompanyRelationshipType,
        importance: String(fd.get("importance") ?? "normal") as PersonImportanceLevel,
        notes: String(fd.get("notes") ?? "").trim() || null,
      };
      const res = company
        ? await updateCompanyAction({ companyId: company.id, patch: shared })
        : await createCompanyAction({
            ...shared,
            domains,
            aliases: splitList(fd.get("aliases")),
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
          <p className="eyebrow">Companies</p>
          <h2 className="card__title">{editing ? `Edit ${company?.name}` : "Add a company"}</h2>
        </div>
      </div>

      <div className="grid grid--2">
        <div>
          <label htmlFor="cf-name" style={labelStyle}>Name</label>
          <input id="cf-name" name="name" className="input" placeholder="Acme Corp" required disabled={pending} defaultValue={company?.name ?? ""} />
        </div>
        <div>
          <label htmlFor="cf-rel" style={labelStyle}>Relationship</label>
          <select id="cf-rel" name="rel" className="input" defaultValue={company?.relationshipType ?? "other"} disabled={pending}>
            {(Object.keys(COMPANY_RELATIONSHIP_LABELS) as CompanyRelationshipType[]).map((r) => (
              <option key={r} value={r}>{COMPANY_RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-importance" style={labelStyle}>Importance</label>
          <select id="cf-importance" name="importance" className="input" defaultValue={company?.importance ?? "normal"} disabled={pending}>
            {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
              <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
            ))}
          </select>
        </div>
        {editing ? null : (
          <>
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
          </>
        )}
      </div>

      <div>
        <label htmlFor="cf-notes" style={labelStyle}>Notes</label>
        <textarea id="cf-notes" name="notes" className="textarea" rows={3} placeholder="Context worth remembering about this company…" disabled={pending} defaultValue={company?.notes ?? ""} />
      </div>

      {duplicateWarning ? (
        <p className="form-message form-message--warn" role="alert">{duplicateWarning}</p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? "Saving…" : duplicateWarning ? "Save anyway" : editing ? "Save changes" : "Save company"}
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
