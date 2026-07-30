"use client";

/**
 * components/people/relationship-manager.tsx
 *
 * The editable "Connections" section on person and company profiles. Shows the
 * record's relationships with their evidence (like the read-only
 * RelationshipList) and — for members — lets you add a connection to any
 * person or company, re-classify an edge's kind, confirm or dismiss a
 * suggestion, and remove an edge behind an inline confirm. Every change writes
 * to `entity_links`, so the Connections network reflects it immediately.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ENTITY_TYPE_LABELS,
  RELATIONSHIP_KIND_LABELS,
  type EntityType,
  type RelationshipKind,
  type ResolvedRelationship,
} from "@/modules/people/people.types";
import {
  confirmLinkAction,
  rejectLinkAction,
  createLinkAction,
  updateLinkAction,
  deleteLinkAction,
} from "@/app/(app)/people/actions";

export interface LinkTarget {
  readonly type: "person" | "company";
  readonly id: string;
  readonly label: string;
}

function hrefFor(rel: ResolvedRelationship): string | null {
  if (rel.otherType === "person") return `/people/${rel.otherId}`;
  if (rel.otherType === "company") return `/companies/${rel.otherId}`;
  return null;
}

export function RelationshipManager({
  entityType,
  entityId,
  relationships,
  targets,
  canManage,
}: {
  entityType: "person" | "company";
  entityId: string;
  relationships: readonly ResolvedRelationship[];
  /** People + companies this record can be linked to. */
  targets: readonly LinkTarget[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [targetQuery, setTargetQuery] = useState("");
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [kind, setKind] = useState<string>("collaborates_with");

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

  const matches = targetQuery.trim()
    ? targets
        .filter(
          (t) =>
            !(t.type === entityType && t.id === entityId) &&
            t.label.toLowerCase().includes(targetQuery.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];

  return (
    <div className="stack gap-sm">
      {feedback ? (
        <p
          className={`form-message${feedback.tone === "error" ? " form-message--error" : " form-message--success"}`}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}

      {relationships.length === 0 ? (
        <p className="people-empty-note">
          No connections yet.{canManage ? " Add one below, or run correlation to surface suggestions from recent activity." : ""}
        </p>
      ) : (
        <ul className="relationship-list">
          {relationships.map((rel) => {
            const href = hrefFor(rel);
            return (
              <li key={rel.id} className="relationship-list__item">
                <div className="relationship-list__main">
                  <span>
                    {canManage && rel.status === "confirmed" ? (
                      <select
                        className="input input--compact"
                        value={rel.relationshipType}
                        disabled={pending}
                        aria-label={`Relationship kind with ${rel.otherLabel}`}
                        onChange={(e) =>
                          run(
                            () => updateLinkAction({ linkId: rel.id, relationshipType: e.target.value }),
                            "Relationship updated.",
                          )
                        }
                      >
                        {!(rel.relationshipType in RELATIONSHIP_KIND_LABELS) ? (
                          <option value={rel.relationshipType}>{rel.relationshipLabel}</option>
                        ) : null}
                        {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((k) => (
                          <option key={k} value={k}>
                            {RELATIONSHIP_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="relationship-list__kind">{rel.relationshipLabel}</span>
                    )}{" "}
                    {href ? (
                      <Link href={href} className="relationship-list__link">
                        {rel.otherLabel}
                      </Link>
                    ) : (
                      <span className="relationship-list__other">{rel.otherLabel}</span>
                    )}{" "}
                    <span className="relationship-list__type mono">{ENTITY_TYPE_LABELS[rel.otherType]}</span>
                  </span>
                  {rel.evidenceSummary ? (
                    <p className="relationship-list__evidence">{rel.evidenceSummary}</p>
                  ) : null}
                </div>

                <span className="relationship-list__controls">
                  {rel.status === "suggested" && canManage ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--accent-outline btn--sm"
                        disabled={pending}
                        onClick={() => run(() => confirmLinkAction({ linkId: rel.id }), "Connection confirmed.")}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={pending}
                        onClick={() => run(() => rejectLinkAction({ linkId: rel.id }), "Suggestion dismissed.")}
                      >
                        Not right
                      </button>
                    </>
                  ) : (
                    <span
                      className={`status status--${rel.origin === "user" ? "ok" : "info"}`}
                      title={rel.origin === "user" ? "Confirmed by you" : "Proposed by Pilot from your activity"}
                    >
                      {rel.status === "suggested" ? "Suggested" : "Confirmed"} · {Math.round(rel.confidence * 100)}%
                    </span>
                  )}
                  {canManage && rel.status === "confirmed" ? (
                    confirmRemove === rel.id ? (
                      <span className="confirm-inline">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm btn--danger"
                          disabled={pending}
                          onClick={() => {
                            setConfirmRemove(null);
                            run(() => deleteLinkAction({ linkId: rel.id }), "Connection removed.");
                          }}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        aria-label={`Remove connection with ${rel.otherLabel}`}
                        disabled={pending}
                        onClick={() => setConfirmRemove(rel.id)}
                      >
                        ×
                      </button>
                    )
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        adding ? (
          <div className="relationship-add">
            {target ? (
              <div className="connections__add-chosen">
                <span className="chip">{target.label}</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTarget(null)}>
                  Change
                </button>
              </div>
            ) : (
              <div className="connections__search">
                <input
                  type="search"
                  className="input"
                  placeholder="Search people & companies"
                  value={targetQuery}
                  disabled={pending}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  aria-label="Search for a record to connect"
                />
                {matches.length > 0 ? (
                  <ul className="connections__search-results">
                    {matches.map((t) => (
                      <li key={`${t.type}:${t.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setTarget(t);
                            setTargetQuery("");
                          }}
                        >
                          {t.label}
                          <span className="mono"> · {t.type === "person" ? "Person" : "Company"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
            <div className="connections__add-row">
              <select
                className="input"
                value={kind}
                disabled={pending}
                onChange={(e) => setKind(e.target.value)}
                aria-label="Relationship kind"
              >
                {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((k) => (
                  <option key={k} value={k}>
                    {RELATIONSHIP_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={pending || !target}
                onClick={() => {
                  if (!target) return;
                  run(
                    () =>
                      createLinkAction({
                        sourceType: entityType as EntityType,
                        sourceId: entityId,
                        targetType: target.type as EntityType,
                        targetId: target.id,
                        relationshipType: kind,
                      }),
                    `Connected to ${target.label}.`,
                  );
                  setTarget(null);
                  setAdding(false);
                }}
              >
                {pending ? "Saving…" : "Connect"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  setTarget(null);
                  setTargetQuery("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding(true)}>
            Add connection
          </button>
        )
      ) : null}
    </div>
  );
}
