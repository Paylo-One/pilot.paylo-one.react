"use client";

/**
 * components/people/relationship-list.tsx
 *
 * The confirmed relationships around a person or company, drawn from the
 * relationship graph (entity_links). Every edge is explainable: it shows the
 * relationship kind, the other party, confidence, whether you confirmed it or
 * Pilot proposed it, and the evidence behind it. People and companies link
 * through to their own pages.
 */

import Link from "next/link";
import { ENTITY_TYPE_LABELS, type ResolvedRelationship } from "@/modules/people/people.types";

function hrefFor(rel: ResolvedRelationship): string | null {
  if (rel.otherType === "person") return `/people/${rel.otherId}`;
  if (rel.otherType === "company") return `/companies/${rel.otherId}`;
  return null;
}

export function RelationshipList({ relationships }: { relationships: readonly ResolvedRelationship[] }) {
  if (relationships.length === 0) {
    return (
      <p className="people-empty-note">
        No connections yet. Link a company, or run correlation to surface
        semantic relationship suggestions from recent activity.
      </p>
    );
  }
  return (
    <ul className="relationship-list">
      {relationships.map((rel) => {
        const href = hrefFor(rel);
        const label = (
          <>
            <span className="relationship-list__kind">{rel.relationshipLabel}</span>
            <span className="relationship-list__other">{rel.otherLabel}</span>
            <span className="relationship-list__type mono">
              {ENTITY_TYPE_LABELS[rel.otherType]}
            </span>
          </>
        );
        return (
          <li key={rel.id} className="relationship-list__item">
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
            </div>
            <span
              className={`status status--${rel.origin === "user" ? "ok" : "info"}`}
              title={
                rel.origin === "user"
                  ? "Confirmed by you"
                  : "Proposed by Pilot from your activity"
              }
            >
              {rel.origin === "user" ? "Confirmed" : "Suggested"} ·{" "}
              {Math.round(rel.confidence * 100)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
