"use client";

/**
 * components/people/connection-suggestions.tsx
 *
 * Suggested connections, ranked by evidence. Each suggestion names both
 * parties, leads with a plain-language reason ("Exchanged 24 Teams messages"),
 * wears its strength as a word — Strong / Relevant / Possible — never a raw
 * similarity score, and unfolds to show the individual evidence behind it.
 * Strong and relevant connections show by default; possible ones wait behind
 * a single quiet reveal. Confirm keeps an edge; "Not right" retires it and
 * stops the pair being re-suggested. Pilot proposes; you decide.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ConnectionSuggestion } from "@/modules/people/people.types";
import { CONNECTION_TIER_LABELS } from "@/modules/people/connection-scoring";
import { confirmLinkAction, rejectLinkAction } from "@/app/(app)/people/actions";

function endpointHref(type: ConnectionSuggestion["aType"], id: string): string | null {
  if (type === "person") return `/people/${id}`;
  if (type === "company") return `/companies/${id}`;
  return null;
}

function Endpoint({ type, id, label }: { type: ConnectionSuggestion["aType"]; id: string; label: string }) {
  const href = endpointHref(type, id);
  if (!href) return <span className="connection-card__name">{label}</span>;
  return (
    <Link href={href} className="connection-card__name">
      {label}
    </Link>
  );
}

const STRENGTH_TONE: Record<ConnectionSuggestion["strength"], string> = {
  strong: "ok",
  relevant: "info",
  possible: "neutral",
};

function ConnectionCard({ suggestion }: { suggestion: ConnectionSuggestion }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"confirmed" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function act(kind: "confirmed" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "confirmed"
          ? await confirmLinkAction({ linkId: suggestion.id })
          : await rejectLinkAction({ linkId: suggestion.id });
      if (res.ok) {
        setDone(kind);
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  const hasEvidence = suggestion.evidenceSignals.length > 0;

  return (
    <article className={`connection-card connection-card--${suggestion.strength}`}>
      <div className="connection-card__head">
        <p className="connection-card__pair">
          <Endpoint type={suggestion.aType} id={suggestion.aId} label={suggestion.aLabel} />
          <span className="connection-card__tie" aria-hidden="true">
            ·
          </span>
          <span className="connection-card__kind">{suggestion.relationshipLabel.toLowerCase()}</span>
          <span className="connection-card__tie" aria-hidden="true">
            ·
          </span>
          <Endpoint type={suggestion.bType} id={suggestion.bId} label={suggestion.bLabel} />
        </p>
        <span className={`status status--${STRENGTH_TONE[suggestion.strength]}`}>
          {CONNECTION_TIER_LABELS[suggestion.strength]}
        </span>
      </div>

      {suggestion.headline ? (
        <p className="connection-card__reason">{suggestion.headline}</p>
      ) : null}

      {hasEvidence ? (
        <div className="connection-card__evidence">
          <button
            type="button"
            className="connection-card__why"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Hide evidence"
              : `Why? ${suggestion.evidenceCount > 0 ? `${suggestion.evidenceCount} piece${suggestion.evidenceCount === 1 ? "" : "s"} of evidence` : "See the evidence"}`}
          </button>
          {expanded ? (
            <ul className="connection-card__signals">
              {suggestion.evidenceSignals.map((signal) => (
                <li key={`${signal.kind}:${signal.detail}`} className="connection-card__signal">
                  <span>{signal.detail}</span>
                  {signal.sample ? (
                    <span className="connection-card__sample">“{signal.sample}”</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="form-message form-message--error">{error}</p> : null}

      <div className="connection-card__controls">
        {done ? (
          <span className={`status status--${done === "rejected" ? "neutral" : "ok"}`}>
            {done === "confirmed" ? "Connected" : "Dismissed — won't be suggested again"}
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

export function ConnectionSuggestions({
  suggestions,
}: {
  suggestions: readonly ConnectionSuggestion[];
}) {
  const [showPossible, setShowPossible] = useState(false);
  const { headline, possible } = useMemo(() => {
    return {
      headline: suggestions.filter((s) => s.strength !== "possible"),
      possible: suggestions.filter((s) => s.strength === "possible"),
    };
  }, [suggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div className="inbox__group">
      <p className="inbox__group-title">Suggested connections</p>
      <div className="stack gap-sm">
        {headline.map((s) => (
          <ConnectionCard key={s.id} suggestion={s} />
        ))}
        {headline.length === 0 && possible.length > 0 ? (
          <p className="people-empty-note">
            No strong connections waiting — only lower-confidence possibilities.
          </p>
        ) : null}
        {possible.length > 0 ? (
          showPossible ? (
            possible.map((s) => <ConnectionCard key={s.id} suggestion={s} />)
          ) : (
            <button
              type="button"
              className="connection-reveal"
              onClick={() => setShowPossible(true)}
            >
              Show {possible.length} possible connection{possible.length === 1 ? "" : "s"} with
              lighter evidence
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
