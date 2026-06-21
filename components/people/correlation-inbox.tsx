"use client";

/**
 * components/people/correlation-inbox.tsx
 *
 * Guided refinement, not data admin. One calm queue of things worth a glance:
 * possible "same person?" matches, semantic/relationship links Pilot proposed
 * from your activity, and records that may be duplicates. Every item explains
 * *why* it was surfaced, and you confirm, reject, or set it aside. Pilot
 * proposes; you decide.
 * Nothing is ever merged or linked for you.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ENTITY_TYPE_LABELS,
  type PersonLinkSuggestion,
  type ResolvedRelationship,
} from "@/modules/people/people.types";
import type { DuplicateSuggestion } from "@/modules/people/correlation";
import { PersonLinkSuggestionCard } from "@/components/people/person-link-suggestion";
import {
  runCorrelationAction,
  confirmLinkAction,
  rejectLinkAction,
} from "@/app/(app)/people/actions";

function SuggestedLinkCard({ link }: { link: ResolvedRelationship }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"confirmed" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(kind: "confirmed" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "confirmed"
          ? await confirmLinkAction({ linkId: link.id })
          : await rejectLinkAction({ linkId: link.id });
      if (res.ok) {
        setDone(kind);
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  return (
    <article className="link-suggestion">
      <div className="link-suggestion__main">
        <p className="memo-item__title">
          {link.relationshipLabel} {link.otherLabel}{" "}
          <span className="mono">· {ENTITY_TYPE_LABELS[link.otherType]}</span>
        </p>
        {link.evidenceSummary ? (
          <p className="action-card__rationale" style={{ marginTop: "var(--space-xs)" }}>
            {link.evidenceSummary}
          </p>
        ) : null}
        <p className="repo-row__meta mono">{Math.round(link.confidence * 100)}% confidence</p>
        {error ? <p className="form-message form-message--error">{error}</p> : null}
      </div>
      <div className="link-suggestion__controls">
        {done ? (
          <span className={`status status--${done === "rejected" ? "neutral" : "ok"}`}>
            {done === "confirmed" ? "Linked" : "Dismissed"}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--accent-outline btn--sm"
              disabled={pending}
              onClick={() => act("confirmed")}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={pending}
              onClick={() => act("rejected")}
            >
              Not right
            </button>
          </>
        )}
      </div>
    </article>
  );
}

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
  suggestedLinks,
  duplicates,
}: {
  identitySuggestions: readonly PersonLinkSuggestion[];
  suggestedLinks: readonly ResolvedRelationship[];
  duplicates: readonly DuplicateSuggestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const total = identitySuggestions.length + suggestedLinks.length + duplicates.length;

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

          {suggestedLinks.length > 0 ? (
            <div className="inbox__group">
              <p className="inbox__group-title">Possible semantic connections</p>
              <div className="stack gap-sm">
                {suggestedLinks.map((l) => (
                  <SuggestedLinkCard key={l.id} link={l} />
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
