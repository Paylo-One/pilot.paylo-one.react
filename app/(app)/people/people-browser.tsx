"use client";

/**
 * app/(app)/people/people-browser.tsx
 *
 * Client orchestrator for the People surface. Search the directory, add a
 * person, review unresolved "is this the same person?" suggestions, and open a
 * person to see their cross-source identities, correlated signals, linked
 * actions, and refinement controls. Scaffold: mock data, no persistence.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IMPORTANCE_LABELS,
  RELATIONSHIP_LABELS,
  type Person,
  type PersonImportanceLevel,
  type PersonLinkSuggestion,
} from "@/modules/people/people.types";
import { updatePersonAction, deletePersonAction } from "./actions";
import { PersonSearch } from "@/components/people/person-search";
import { PersonCard } from "@/components/people/person-card";
import { PersonForm } from "@/components/people/person-form";
import { PersonIdentityList } from "@/components/people/person-identity-list";
import { PersonSignalList } from "@/components/people/person-signal-list";
import { PersonLinkSuggestionCard } from "@/components/people/person-link-suggestion";
import { FeedbackChip } from "@/components/refinement/feedback-chip";

export function PeopleBrowser({
  people,
  suggestions,
}: {
  people: readonly Person[];
  suggestions: readonly PersonLinkSuggestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(people[0]?.id ?? null);
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const hay = `${p.displayName} ${p.roleTitle ?? ""} ${p.organisation ?? ""} ${p.tags.join(" ")} ${p.emails.join(" ")} ${p.identities.map((i) => i.identityValue).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, query]);

  const selected = people.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="people">
      <div className="sources-toolbar">
        <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <PersonSearch value={query} onChange={setQuery} resultCount={filtered.length} />
          </div>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "Add person"}
          </button>
        </div>
      </div>

      {showForm ? (
        <div style={{ marginBottom: "var(--space-lg)" }}>
          <PersonForm
            onCreated={() => {
              setShowForm(false);
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <section style={{ marginBottom: "var(--space-xl)" }}>
          <div className="card-head">
            <p className="eyebrow">Is this the same person?</p>
            <span className="badge">{suggestions.length}</span>
          </div>
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {suggestions.map((s) => (
              <PersonLinkSuggestionCard key={s.id} suggestion={s} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="people__layout">
        <div className="people__list">
          {filtered.length === 0 ? (
            <div className="empty">
              <p className="empty__title">No people match</p>
              <p className="empty__body">Try a different search, or add a person.</p>
            </div>
          ) : (
            filtered.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                selected={person.id === selectedId}
                onSelect={() => setSelectedId(person.id)}
              />
            ))
          )}
        </div>

        {selected ? (
          <aside className="people__detail card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Person</p>
                <h2 className="card__title">{selected.displayName}</h2>
                <p className="integration__kind">
                  {RELATIONSHIP_LABELS[selected.relationshipType]}
                  {selected.roleTitle ? ` · ${selected.roleTitle}` : ""}
                  {selected.organisation ? ` · ${selected.organisation}` : ""}
                </p>
              </div>
              <span className="person-link">
                <select
                  className="input person-link__select"
                  aria-label="Importance"
                  value={selected.importance}
                  disabled={pending}
                  onChange={(e) => {
                    const importance = e.target.value as PersonImportanceLevel;
                    startTransition(async () => {
                      const res = await updatePersonAction({ personId: selected.id, patch: { importance } });
                      if (res.ok) router.refresh();
                    });
                  }}
                >
                  {(Object.keys(IMPORTANCE_LABELS) as PersonImportanceLevel[]).map((i) => (
                    <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="feedback-chip"
                  disabled={pending}
                  title="Delete this person"
                  onClick={() => {
                    startTransition(async () => {
                      const res = await deletePersonAction({ personId: selected.id });
                      if (res.ok) {
                        setSelectedId(null);
                        router.refresh();
                      }
                    });
                  }}
                >
                  Delete
                </button>
              </span>
            </div>

            {selected.tags.length > 0 ? (
              <div className="person-card__tags" style={{ marginBottom: "var(--space-md)" }}>
                {selected.tags.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            ) : null}

            {selected.notes ? (
              <p className="action-card__rationale" style={{ marginTop: 0 }}>{selected.notes}</p>
            ) : null}

            <p className="eyebrow" style={{ margin: "var(--space-md) 0 var(--space-sm)" }}>
              Source identities
            </p>
            <PersonIdentityList person={selected} />

            {selected.relationships.length > 0 ? (
              <>
                <p className="eyebrow" style={{ margin: "var(--space-lg) 0 var(--space-sm)" }}>
                  Projects &amp; topics
                </p>
                <div className="person-card__tags">
                  {selected.relationships.map((r) => (
                    <span key={r.id} className="chip chip--accent">{r.relatedLabel}</span>
                  ))}
                </div>
              </>
            ) : null}

            <p className="eyebrow" style={{ margin: "var(--space-lg) 0 var(--space-sm)" }}>
              Recent correlated signals
            </p>
            <PersonSignalList signals={selected.signals} />

            {selected.linkedActions.length > 0 ? (
              <>
                <p className="eyebrow" style={{ margin: "var(--space-lg) 0 var(--space-sm)" }}>
                  Linked actions
                </p>
                <ul className="stack" style={{ gap: "var(--space-xs)" }}>
                  {selected.linkedActions.map((a) => (
                    <li key={a.id} className="meta-row">
                      <span className="meta-row__key">{a.title}</span>
                      <span className="badge">{a.status}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="integration__detail-block">
              <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>Refine this person</p>
              <div className="refinement-actions">
                <FeedbackChip feedback="raise_priority" targetType="person" targetId={selected.id} label="Always high priority" />
                <FeedbackChip feedback="lower_priority" targetType="person" targetId={selected.id} />
                <FeedbackChip feedback="link_topic" targetType="person" targetId={selected.id} />
                <FeedbackChip feedback="do_not_show_again" targetType="person" targetId={selected.id} label="Mute" />
              </div>
              <p className="segmented__hint">
                Refinements become explicit, inspectable tenant rules — not hidden model learning.
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
