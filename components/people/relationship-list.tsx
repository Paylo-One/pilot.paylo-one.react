"use client";

/**
 * components/people/relationship-list.tsx
 *
 * The relationships around a person or company, drawn from the relationship
 * graph (entity_links). Every edge is explainable: it shows the relationship
 * kind, the other party, whether you confirmed it or Pilot inferred it, its
 * strength as a word (never a raw score), and — where the scoring pipeline
 * recorded them — the individual pieces of evidence, one click away.
 */

import { useState } from "react";
import Link from "next/link";
import { ENTITY_TYPE_LABELS, type ResolvedRelationship } from "@/modules/people/people.types";
import {
  CONNECTION_TIER_LABELS,
  tierForConfidence,
} from "@/modules/people/connection-scoring";

function hrefFor(rel: ResolvedRelationship): string | null {
  if (rel.otherType === "person") return `/people/${rel.otherId}`;
  if (rel.otherType === "company") return `/companies/${rel.otherId}`;
  return null;
}

function badgeFor(rel: ResolvedRelationship): { label: string; tone: string; title: string } {
  if (rel.origin === "user") {
    return { label: "Confirmed by you", tone: "ok", title: "You recorded this relationship." };
  }
  if (rel.status === "confirmed") {
    return {
      label: "Confirmed",
      tone: "ok",
      title: "Proposed by Pilot from your activity; confirmed by you.",
    };
  }
  const tier = tierForConfidence(rel.confidence);
  const label = tier === "hidden" ? "Possible" : CONNECTION_TIER_LABELS[tier];
  return {
    label: `Suggested · ${label}`,
    tone: tier === "strong" ? "info" : "neutral",
    title: "Inferred by Pilot from your activity — confirm or dismiss it in Needs review.",
  };
}

function RelationshipRow({ rel }: { rel: ResolvedRelationship }) {
  const [expanded, setExpanded] = useState(false);
  const href = hrefFor(rel);
  const badge = badgeFor(rel);
  const label = (
    <>
      <span className="relationship-list__kind">{rel.relationshipLabel}</span>
      <span className="relationship-list__other">{rel.otherLabel}</span>
      <span className="relationship-list__type mono">{ENTITY_TYPE_LABELS[rel.otherType]}</span>
    </>
  );

  return (
    <li className="relationship-list__item">
      <div className="relationship-list__main">
        {href ? (
          <Link href={href} className="relationship-list__link">
            {label}
          </Link>
        ) : (
          <span className="relationship-list__link">{label}</span>
        )}
        {rel.evidenceSummary ? (
          <p className="relationship-list__evidence">{rel.evidenceSummary}</p>
        ) : null}
        {rel.evidenceSignals.length > 0 ? (
          <>
            <button
              type="button"
              className="connection-card__why"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide evidence" : "Why?"}
            </button>
            {expanded ? (
              <ul className="connection-card__signals">
                {rel.evidenceSignals.map((signal) => (
                  <li key={`${signal.kind}:${signal.detail}`} className="connection-card__signal">
                    <span>{signal.detail}</span>
                    {signal.sample ? (
                      <span className="connection-card__sample">“{signal.sample}”</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
      <span className={`status status--${badge.tone}`} title={badge.title}>
        {badge.label}
      </span>
    </li>
  );
}

export function RelationshipList({ relationships }: { relationships: readonly ResolvedRelationship[] }) {
  if (relationships.length === 0) {
    return (
      <p className="people-empty-note">
        No connections yet. Link a company, or run correlation to surface
        relationship suggestions from recent activity.
      </p>
    );
  }
  return (
    <ul className="relationship-list">
      {relationships.map((rel) => (
        <RelationshipRow key={rel.id} rel={rel} />
      ))}
    </ul>
  );
}
