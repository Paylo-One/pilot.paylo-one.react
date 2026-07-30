"use client";

/**
 * components/companies/company-detail.tsx
 *
 * The company page — the organisation behind the activity. Relationship and
 * importance, the domains and aliases that let Pilot resolve activity to it,
 * the people linked to it, its connections (add / re-classify / remove), and
 * recent activity from its domains. Every edit gives explicit feedback;
 * removal archives by default (restorable), and permanent deletion is a
 * privileged, confirmed act.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IMPORTANCE_LABELS,
  type Person,
  type PersonImportanceLevel,
} from "@/modules/people/people.types";
import {
  COMPANY_RELATIONSHIP_LABELS,
  type Company,
  type CompanyDetail as CompanyDetailModel,
  type CompanyRelationshipType,
} from "@/modules/companies/company.types";
import {
  updateCompanyAction,
  deleteCompanyAction,
  setCompanyArchivedAction,
  addCompanyDomainAction,
  removeCompanyDomainAction,
  addCompanyAliasAction,
  removeCompanyAliasAction,
} from "@/app/(app)/companies/actions";
import { CompanyForm } from "@/components/companies/company-form";
import { TagPicker } from "@/components/people/tag-picker";
import { RelationshipManager, type LinkTarget } from "@/components/people/relationship-manager";

export function CompanyDetail({
  company,
  people,
  companies,
  canManage,
  canDelete,
}: {
  company: CompanyDetailModel;
  people: readonly Person[];
  companies: readonly Company[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [alias, setAlias] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const archived = Boolean(company.archivedAt);

  function run(fn: () => Promise<{ ok: boolean; error: string | null }>, okText?: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (okText) setFeedback({ tone: "ok", text: okText });
        router.refresh();
      } else {
        setFeedback({ tone: "error", text: res.error ?? "Something went wrong." });
      }
    });
  }

  const linkTargets: LinkTarget[] = [
    ...people.map((p) => ({ type: "person" as const, id: p.id, label: p.displayName })),
    ...companies
      .filter((c) => c.id !== company.id)
      .map((c) => ({ type: "company" as const, id: c.id, label: c.name })),
  ];

  return (
    <main className="workspace__content person-page">
      <Link href="/people?tab=companies" className="back-link">
        ← People &amp; companies
      </Link>

      {archived ? (
        <div className="archived-banner" role="status">
          <span>
            This company was archived{company.archivedAt ? ` on ${company.archivedAt.slice(0, 10)}` : ""}. It is
            hidden from the directory, suggestions, and the network.
          </span>
          {canManage ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending}
              onClick={() =>
                run(() => setCompanyArchivedAction({ companyId: company.id, archived: false }), "Company restored.")
              }
            >
              Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="person-page__head">
        <div>
          <p className="eyebrow">Company</p>
          <h1 className="page-head__title">{company.name}</h1>
          <p className="integration__kind">
            {COMPANY_RELATIONSHIP_LABELS[company.relationshipType]} ·{" "}
            {company.relatedPeopleCount} {company.relatedPeopleCount === 1 ? "person" : "people"}
          </p>
        </div>
        {canManage ? (
          <div className="person-page__controls">
            <label className="person-page__field">
              <span className="person-page__field-label">Relationship</span>
              <select
                className="input"
                value={company.relationshipType}
                disabled={pending}
                onChange={(e) =>
                  run(
                    () =>
                      updateCompanyAction({
                        companyId: company.id,
                        patch: { relationshipType: e.target.value as CompanyRelationshipType },
                      }),
                    "Relationship updated.",
                  )
                }
              >
                {(Object.keys(COMPANY_RELATIONSHIP_LABELS) as CompanyRelationshipType[]).map((r) => (
                  <option key={r} value={r}>{COMPANY_RELATIONSHIP_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="person-page__field">
              <span className="person-page__field-label">Importance</span>
              <select
                className="input"
                value={company.importance}
                disabled={pending}
                onChange={(e) =>
                  run(
                    () =>
                      updateCompanyAction({
                        companyId: company.id,
                        patch: { importance: e.target.value as PersonImportanceLevel },
                      }),
                    "Importance updated.",
                  )
                }
              >
                {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
                  <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Close editor" : "Edit details"}
            </button>
            {!archived ? (
              confirmingArchive ? (
                <span className="confirm-inline">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--danger"
                    disabled={pending}
                    onClick={() => {
                      setConfirmingArchive(false);
                      run(
                        () => setCompanyArchivedAction({ companyId: company.id, archived: true }),
                        "Company archived. Restore it any time from the Archived tab.",
                      );
                    }}
                  >
                    Confirm archive
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={pending}
                    onClick={() => setConfirmingArchive(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={pending}
                  title="Archiving hides the record but keeps everything for restore"
                  onClick={() => setConfirmingArchive(true)}
                >
                  Archive
                </button>
              )
            ) : null}
            {archived && canDelete ? (
              confirmingDelete ? (
                <span className="confirm-inline">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--danger"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteCompanyAction({ companyId: company.id });
                        if (res.ok) router.push("/people?tab=archived");
                        else setFeedback({ tone: "error", text: res.error ?? "Delete failed." });
                      })
                    }
                  >
                    Delete forever
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={pending}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete permanently…
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {feedback ? (
        <p
          className={`form-message${feedback.tone === "error" ? " form-message--error" : " form-message--success"}`}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}

      {editing && canManage ? (
        <div className="mb-lg">
          <CompanyForm
            company={company}
            onDone={() => {
              setEditing(false);
              setFeedback({ tone: "ok", text: "Details saved." });
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {company.notes ? <p className="person-page__notes">{company.notes}</p> : null}

      <div className="person-page__grid">
        <section className="person-section">
          <p className="eyebrow">Tags</p>
          <TagPicker entity="company" entityId={company.id} tags={company.tags} />
        </section>

        <section className="person-section">
          <p className="eyebrow">Domains</p>
          <p className="person-section__lead">
            Email and source domains that belong to this company. Pilot uses them
            to propose links to the people who use them.
          </p>
          <div className="chip-row">
            {company.domains.map((d) => (
              <span key={d.id} className="chip">
                {d.domain}
                {canManage ? (
                  <button
                    type="button"
                    className="tag-chip__remove"
                    aria-label={`Remove ${d.domain}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => removeCompanyDomainAction({ companyId: company.id, domainId: d.id }), "Domain removed.")
                    }
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {canManage ? (
            <div className="inline-add">
              <input
                className="input"
                placeholder="acme.com"
                value={domain}
                disabled={pending}
                onChange={(e) => setDomain(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pending || !domain.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await addCompanyDomainAction({ companyId: company.id, domain: domain.trim() });
                    if (res.ok) setDomain("");
                    return res;
                  }, "Domain added.")
                }
              >
                Add domain
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <section className="person-section">
        <p className="eyebrow">Also known as</p>
        <div className="chip-row">
          {company.aliases.length === 0 ? (
            <span className="tag-picker__none">No aliases yet.</span>
          ) : (
            company.aliases.map((a) => (
              <span key={a.id} className="chip">
                {a.alias}
                {canManage ? (
                  <button
                    type="button"
                    className="tag-chip__remove"
                    aria-label={`Remove ${a.alias}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => removeCompanyAliasAction({ companyId: company.id, aliasId: a.id }), "Alias removed.")
                    }
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))
          )}
        </div>
        {canManage ? (
          <div className="inline-add">
            <input
              className="input"
              placeholder="Acme Inc."
              value={alias}
              disabled={pending}
              onChange={(e) => setAlias(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending || !alias.trim()}
              onClick={() =>
                run(async () => {
                  const res = await addCompanyAliasAction({ companyId: company.id, alias: alias.trim() });
                  if (res.ok) setAlias("");
                  return res;
                }, "Alias added.")
              }
            >
              Add alias
            </button>
          </div>
        ) : null}
      </section>

      <section className="person-section">
        <p className="eyebrow">People</p>
        {company.relatedPeople.length === 0 ? (
          <p className="people-empty-note">
            No people linked yet. Open a person and set their company, or run
            correlation to propose links from matching email domains.
          </p>
        ) : (
          <ul className="stack gap-xs">
            {company.relatedPeople.map((p) => (
              <li key={p.id} className="meta-row">
                <Link href={`/people/${p.id}`} className="relationship-list__link">
                  {p.displayName}
                </Link>
                {p.roleTitle ? <span className="meta-row__value mono">{p.roleTitle}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="person-section">
        <p className="eyebrow">Connections</p>
        <RelationshipManager
          entityType="company"
          entityId={company.id}
          relationships={company.relationships}
          targets={linkTargets}
          canManage={canManage}
        />
      </section>

      <section className="person-section">
        <p className="eyebrow">Recent activity</p>
        {company.recentActivity.length === 0 ? (
          <p className="people-empty-note">
            No recent activity from this company’s domains. Activity appears as
            sources sync and domains match.
          </p>
        ) : (
          <ul className="stack gap-xs">
            {company.recentActivity.map((a) => (
              <li key={a.id} className="meta-row">
                <span className="meta-row__key">{a.title}</span>
                <span className="meta-row__value mono">{a.system}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
