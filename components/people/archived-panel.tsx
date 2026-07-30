"use client";

/**
 * components/people/archived-panel.tsx
 *
 * The Archived tab — every archived person and company, restorable in one
 * click. Archiving is the default "remove" across People & Companies (safe,
 * reversible); permanent deletion lives here behind a confirmation and is
 * limited to privileged roles.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Person } from "@/modules/people/people.types";
import type { Company } from "@/modules/companies/company.types";
import { setPersonArchivedAction, deletePersonAction } from "@/app/(app)/people/actions";
import { setCompanyArchivedAction, deleteCompanyAction } from "@/app/(app)/companies/actions";

interface ArchivedRecord {
  readonly id: string;
  readonly kind: "person" | "company";
  readonly label: string;
  readonly sub: string | null;
  readonly archivedAt: string | null;
}

function ArchivedRow({
  record,
  canManage,
  canDelete,
}: {
  record: ArchivedRecord;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "Something went wrong.");
    });
  }

  const href = record.kind === "person" ? `/people/${record.id}` : `/companies/${record.id}`;

  return (
    <li className="archived-row">
      <div className="archived-row__main">
        <Link href={href} className="relationship-list__link">
          {record.label}
        </Link>
        <span className="repo-row__meta mono">
          {record.kind === "person" ? "Person" : "Company"}
          {record.sub ? ` · ${record.sub}` : ""}
          {record.archivedAt ? ` · archived ${record.archivedAt.slice(0, 10)}` : ""}
        </span>
        {error ? <p className="form-message form-message--error">{error}</p> : null}
      </div>
      <div className="archived-row__controls">
        {canManage ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={pending}
            onClick={() =>
              run(() =>
                record.kind === "person"
                  ? setPersonArchivedAction({ personId: record.id, archived: false })
                  : setCompanyArchivedAction({ companyId: record.id, archived: false }),
              )
            }
          >
            Restore
          </button>
        ) : null}
        {canDelete ? (
          confirmingDelete ? (
            <span className="confirm-inline">
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--danger"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    record.kind === "person"
                      ? deletePersonAction({ personId: record.id })
                      : deleteCompanyAction({ companyId: record.id }),
                  )
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
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete…
            </button>
          )
        ) : null}
      </div>
    </li>
  );
}

export function ArchivedPanel({
  people,
  companies,
  canManage,
  canDelete,
}: {
  people: readonly Person[];
  companies: readonly Company[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const records: ArchivedRecord[] = [
    ...people.map((p) => ({
      id: p.id,
      kind: "person" as const,
      label: p.displayName,
      sub: p.roleTitle ?? p.companyName,
      archivedAt: p.archivedAt,
    })),
    ...companies.map((c) => ({
      id: c.id,
      kind: "company" as const,
      label: c.name,
      sub: c.domains[0]?.domain ?? null,
      archivedAt: c.archivedAt,
    })),
  ].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));

  if (records.length === 0) {
    return (
      <div className="people-empty people-empty--dashed">
        <p className="people-empty__title">Nothing archived</p>
        <p className="people-empty__body">
          When you archive a person or company it moves here instead of being
          deleted, so you can always restore it — identities, tags, and
          connections included.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <p className="eyebrow">Archived records</p>
          <p className="person-section__lead">
            Archived records are hidden from the directory, suggestions, and the
            network. Restore brings everything back exactly as it was.
            {canDelete ? " Permanent deletion cannot be undone." : ""}
          </p>
        </div>
        <span className="badge">{records.length}</span>
      </div>
      <ul className="stack gap-xs">
        {records.map((r) => (
          <ArchivedRow key={`${r.kind}:${r.id}`} record={r} canManage={canManage} canDelete={canDelete} />
        ))}
      </ul>
    </div>
  );
}
