"use client";

/**
 * components/people/person-detail.tsx
 *
 * The person page — who they are, why they matter, how they connect, and what
 * should happen next. Identity across sources, behavioural tags that change how
 * Pilot treats them, their company, their relationships (add / re-classify /
 * remove), the activity attributed to them, and the open actions that involve
 * them. Every edit gives explicit feedback; removal archives by default
 * (restorable), and permanent deletion is a privileged, confirmed act.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IMPORTANCE_LABELS,
  RELATIONSHIP_LABELS,
  type Person,
  type PersonImportanceLevel,
  type ResolvedRelationship,
} from "@/modules/people/people.types";
import type { Company } from "@/modules/companies/company.types";
import {
  deletePersonAction,
  setPersonArchivedAction,
  updatePersonAction,
  setPersonCompanyAction,
  setPersonSelfAction,
} from "@/app/(app)/people/actions";
import { PersonForm } from "@/components/people/person-form";
import { PersonIdentityList } from "@/components/people/person-identity-list";
import { PersonSignalList } from "@/components/people/person-signal-list";
import { TagPicker } from "@/components/people/tag-picker";
import { RelationshipManager, type LinkTarget } from "@/components/people/relationship-manager";
import { ExplainabilityPanel } from "@/components/people/explainability-panel";

export function PersonDetail({
  person,
  relationships,
  companies,
  people,
  canManage,
  canDelete,
}: {
  person: Person;
  relationships: readonly ResolvedRelationship[];
  companies: readonly Company[];
  people: readonly Person[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const archived = Boolean(person.archivedAt);

  function run(fn: () => Promise<{ ok: boolean; error: string | null }>, okText: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setFeedback({ tone: "ok", text: okText });
        router.refresh();
      } else {
        setFeedback({ tone: "error", text: res.error ?? "Something went wrong." });
      }
    });
  }

  const linkTargets: LinkTarget[] = [
    ...people
      .filter((p) => p.id !== person.id)
      .map((p) => ({ type: "person" as const, id: p.id, label: p.displayName })),
    ...companies.map((c) => ({ type: "company" as const, id: c.id, label: c.name })),
  ];

  return (
    <main className="workspace__content person-page">
      <Link href="/people" className="back-link">
        ← People &amp; companies
      </Link>

      {archived ? (
        <div className="archived-banner" role="status">
          <span>
            This person was archived{person.archivedAt ? ` on ${person.archivedAt.slice(0, 10)}` : ""}. They are
            hidden from the directory, suggestions, and the network.
          </span>
          {canManage ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending}
              onClick={() =>
                run(() => setPersonArchivedAction({ personId: person.id, archived: false }), "Person restored.")
              }
            >
              Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="person-page__head">
        <div>
          <p className="eyebrow">{person.isSelf ? "You" : "Person"}</p>
          <h1 className="page-head__title">
            {person.displayName}
            {person.isSelf ? <span className="self-badge">You</span> : null}
          </h1>
          <p className="integration__kind">
            {RELATIONSHIP_LABELS[person.relationshipType]}
            {person.roleTitle ? ` · ${person.roleTitle}` : ""}
            {person.companyName ? (
              <>
                {" · "}
                {person.companyId ? (
                  <Link href={`/companies/${person.companyId}`} className="relationship-list__link">
                    {person.companyName}
                  </Link>
                ) : (
                  person.companyName
                )}
              </>
            ) : person.organisation ? (
              ` · ${person.organisation}`
            ) : null}
          </p>
        </div>
        {canManage ? (
          <div className="person-page__controls">
            <label className="person-page__field">
              <span className="person-page__field-label">Importance</span>
              <select
                className="input"
                value={person.importance}
                disabled={pending}
                onChange={(e) => {
                  const importance = e.target.value as PersonImportanceLevel;
                  run(
                    () => updatePersonAction({ personId: person.id, patch: { importance } }),
                    `Importance set to ${IMPORTANCE_LABELS[importance]}.`,
                  );
                }}
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
            <button
              type="button"
              className={`btn btn--sm ${person.isSelf ? "btn--accent-outline" : "btn--ghost"}`}
              disabled={pending}
              aria-pressed={person.isSelf}
              title={person.isSelf ? "This person is marked as you" : "Mark this person as yourself"}
              onClick={() =>
                run(
                  () => setPersonSelfAction({ personId: person.id, isSelf: !person.isSelf }),
                  person.isSelf ? "No longer marked as you." : "Marked as you.",
                )
              }
            >
              {person.isSelf ? "This is you" : "This is me"}
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
                        () => setPersonArchivedAction({ personId: person.id, archived: true }),
                        "Person archived. Restore them any time from the Archived tab.",
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
                        const res = await deletePersonAction({ personId: person.id });
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
          <PersonForm
            person={person}
            onDone={() => {
              setEditing(false);
              setFeedback({ tone: "ok", text: "Details saved." });
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {person.notes ? <p className="person-page__notes">{person.notes}</p> : null}

      <ExplainabilityPanel person={person} relationships={relationships} />

      <div className="person-page__grid">
        <section className="person-section">
          <p className="eyebrow">Refine this person</p>
          <p className="person-section__lead">
            Tags here change how Pilot treats this person. Each one explains what
            it does.
          </p>
          <TagPicker entity="person" entityId={person.id} tags={person.tags} />
        </section>

        <section className="person-section">
          <p className="eyebrow">Company</p>
          <p className="person-section__lead">
            The organisation behind this person. Linking records a connection in
            your relationship graph.
          </p>
          <select
            className="input"
            value={person.companyId ?? ""}
            disabled={pending || !canManage}
            onChange={(e) => {
              const companyId = e.target.value || null;
              run(
                () => setPersonCompanyAction({ personId: person.id, companyId }),
                companyId ? "Company linked." : "Company link cleared.",
              );
            }}
          >
            <option value="">No company linked</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </section>
      </div>

      <section className="person-section">
        <p className="eyebrow">Identity across sources</p>
        <PersonIdentityList person={person} />
      </section>

      <section className="person-section">
        <p className="eyebrow">Connections</p>
        <RelationshipManager
          entityType="person"
          entityId={person.id}
          relationships={relationships}
          targets={linkTargets}
          canManage={canManage}
        />
      </section>

      <section className="person-section">
        <p className="eyebrow">Recent activity</p>
        <PersonSignalList signals={person.signals} />
      </section>

      <section className="person-section">
        <p className="eyebrow">Linked actions</p>
        {person.linkedActions.length === 0 ? (
          <p className="people-empty-note">
            No actions involve this person yet. Tag them “Follow-up required” to
            propose one.
          </p>
        ) : (
          <ul className="stack gap-xs">
            {person.linkedActions.map((a) => (
              <li key={a.id} className="meta-row">
                <span className="meta-row__key">{a.title}</span>
                <span className="badge">{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
