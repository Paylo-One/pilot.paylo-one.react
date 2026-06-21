"use client";

/**
 * components/people/person-detail.tsx
 *
 * The person page — who they are, why they matter, how they connect, and what
 * should happen next. Identity across sources, behavioural tags that change how
 * Pilot treats them, their company, their relationships, the activity attributed
 * to them, and the open actions that involve them. You stay in command: every
 * link and tag is yours to set, confirm, or clear.
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
  updatePersonAction,
  deletePersonAction,
  setPersonCompanyAction,
  setPersonSelfAction,
} from "@/app/(app)/people/actions";
import { PersonIdentityList } from "@/components/people/person-identity-list";
import { PersonSignalList } from "@/components/people/person-signal-list";
import { TagPicker } from "@/components/people/tag-picker";
import { RelationshipList } from "@/components/people/relationship-list";
import { ExplainabilityPanel } from "@/components/people/explainability-panel";

export function PersonDetail({
  person,
  relationships,
  companies,
}: {
  person: Person;
  relationships: readonly ResolvedRelationship[];
  companies: readonly Company[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main className="workspace__content person-page">
      <Link href="/people" className="back-link">
        ← People &amp; companies
      </Link>

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
        <div className="person-page__controls">
          <label className="person-page__field">
            <span className="person-page__field-label">Importance</span>
            <select
              className="input"
              value={person.importance}
              disabled={pending}
              onChange={(e) => {
                const importance = e.target.value as PersonImportanceLevel;
                startTransition(async () => {
                  const res = await updatePersonAction({ personId: person.id, patch: { importance } });
                  if (res.ok) router.refresh();
                });
              }}
            >
              {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
                <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`btn btn--sm ${person.isSelf ? "btn--accent-outline" : "btn--ghost"}`}
            disabled={pending}
            aria-pressed={person.isSelf}
            title={person.isSelf ? "This person is marked as you" : "Mark this person as yourself"}
            onClick={() => {
              startTransition(async () => {
                const res = await setPersonSelfAction({ personId: person.id, isSelf: !person.isSelf });
                if (res.ok) router.refresh();
              });
            }}
          >
            {person.isSelf ? "This is you" : "This is me"}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deletePersonAction({ personId: person.id });
                if (res.ok) router.push("/people");
              });
            }}
          >
            Delete
          </button>
        </div>
      </div>

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
            disabled={pending}
            onChange={(e) => {
              const companyId = e.target.value || null;
              startTransition(async () => {
                const res = await setPersonCompanyAction({ personId: person.id, companyId });
                if (res.ok) router.refresh();
              });
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
        <RelationshipList relationships={relationships} />
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
