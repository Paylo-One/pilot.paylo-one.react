"use client";

/**
 * components/people/correlation-inbox.tsx
 *
 * Guided refinement, not data admin. One calm queue of things worth a glance:
 * possible "same person?" matches and records that may be duplicates. Every
 * item explains *why* it was surfaced, and you confirm, reject, or set it
 * aside. Pilot proposes; you decide. Nothing is ever merged or linked for you.
 *
 * Semantic relationship suggestions no longer live here — they have their own
 * curated Suggestions tab.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type PersonLinkSuggestion } from "@/modules/people/people.types";
import type { DuplicateSuggestion } from "@/modules/people/correlation";
import { PersonLinkSuggestionCard } from "@/components/people/person-link-suggestion";
import { runCorrelationAction } from "@/app/(app)/people/actions";

function DuplicateCard({ dup }: { dup: DuplicateSuggestion }) {
  return (
    <article className="link-suggestion">
      <div className="link-suggestion__main">
        <p className="memo-item__title">
          <Link href={`/people/${dup.personAId}`} className="relationship-list__link">
            {dup.personAName}
          </Link>{" "}
          and{" "}
          <Link href={`/people/${dup.personBId}`} className="relationship-list__link">
            {dup.personBName}
          </Link>{" "}
          may be the same person
        </p>
        <p className="action-card__rationale" style={{ marginTop: "var(--space-xs)" }}>
          {dup.reason}
        </p>
        <p className="repo-row__meta mono">{Math.round(dup.confidence * 100)}% confidence</p>
      </div>
      <div className="link-suggestion__controls">
        <span className="status status--info" title="Merging records is coming soon">
          Review
        </span>
      </div>
    </article>
  );
}

export function CorrelationInbox({
  identitySuggestions,
  duplicates,
  canManage,
}: {
  identitySuggestions: readonly PersonLinkSuggestion[];
  duplicates: readonly DuplicateSuggestion[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const total = identitySuggestions.length + duplicates.length;

  return (
    <section className="inbox card">
      <div className="card-head">
        <button
          type="button"
          className="inbox__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <p className="eyebrow">Needs review</p>
          {total > 0 ? <span className="badge">{total}</span> : null}
        </button>
        {canManage ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await runCorrelationAction();
                if (res.ok) router.refresh();
              })
            }
          >
            {pending ? "Reviewing your activity…" : "Run correlation"}
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="people-empty-note">
          Nothing to review. Run correlation to match recent activity to your
          people: confident matches attach quietly, and anything uncertain lands
          here for you to confirm.
        </p>
      ) : open ? (
        <div className="inbox__groups">
          {identitySuggestions.length > 0 ? (
            <div className="inbox__group">
              <p className="inbox__group-title">Possible person matches</p>
              <div className="stack gap-sm">
                {identitySuggestions.map((s) => (
                  <PersonLinkSuggestionCard key={s.id} suggestion={s} />
                ))}
              </div>
            </div>
          ) : null}

          {duplicates.length > 0 ? (
            <div className="inbox__group">
              <p className="inbox__group-title">Possible duplicates</p>
              <div className="stack gap-sm">
                {duplicates.map((d) => (
                  <DuplicateCard key={`${d.personAId}-${d.personBId}`} dup={d} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
