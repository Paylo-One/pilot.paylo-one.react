"use client";

/**
 * Custom skills library: a grid of the workspace's skills, filterable by source
 * (built-in vs custom) and status. Each card links to the skill's detail view.
 * Owners and admins can create a new skill from here.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CustomSkillSummary } from "@/modules/custom-skills";

type OriginFilter = "all" | "system_default" | "custom";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function SkillsBrowser({
  skills,
  canEdit,
}: {
  skills: readonly CustomSkillSummary[];
  canEdit: boolean;
}) {
  const [origin, setOrigin] = useState<OriginFilter>("all");

  const filtered = useMemo(
    () => skills.filter((s) => (origin === "all" ? true : s.origin === origin)),
    [skills, origin],
  );

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <p
          className="page-head__lead"
          style={{ marginTop: 0, maxWidth: "60ch" }}
        >
          Skills are reusable ways of working — how to summarise for an
          executive, how to spot a real risk — that you attach to a prompt.
          Build them once, apply them anywhere, and shape them as your judgement
          of good sharpens.
        </p>
        {canEdit ? (
          <Link
            href="/intelligence/skills/new"
            className="btn btn--primary btn--sm"
          >
            New skill
          </Link>
        ) : null}
      </div>

      <div className="filter-bar" role="group" aria-label="Filter skills">
        <button
          type="button"
          className={`filter-chip${origin === "all" ? " filter-chip--active" : ""}`}
          onClick={() => setOrigin("all")}
        >
          All <span className="filter-chip__count">{skills.length}</span>
        </button>
        <button
          type="button"
          className={`filter-chip${origin === "system_default" ? " filter-chip--active" : ""}`}
          onClick={() =>
            setOrigin(origin === "system_default" ? "all" : "system_default")
          }
        >
          Built-in
        </button>
        <button
          type="button"
          className={`filter-chip${origin === "custom" ? " filter-chip--active" : ""}`}
          onClick={() => setOrigin(origin === "custom" ? "all" : "custom")}
        >
          Custom
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No skills here yet</p>
          <p className="empty__body">
            {canEdit
              ? "Create your first skill, or clear the filter to see the built-in ones."
              : "Built-in skills will appear here once your workspace is set up."}
          </p>
        </div>
      ) : (
        <div className="catalogue-grid">
          {filtered.map((skill) => (
            <Link
              key={skill.id}
              href={`/intelligence/skills/${skill.id}`}
              className="catalogue-card"
            >
              <div className="catalogue-card__head">
                <div className="catalogue-card__id">
                  <p className="integration__name">{skill.name}</p>
                  <p className="integration__kind">
                    {skill.origin === "system_default" ? "Built-in" : "Custom"}
                  </p>
                </div>
                {skill.archivedAt ? (
                  <span className="status status--neutral">Archived</span>
                ) : skill.activeVersionNumber !== null ? (
                  <span className="status status--ok">
                    Active · v{skill.activeVersionNumber}
                  </span>
                ) : (
                  <span className="status status--warn">Draft</span>
                )}
              </div>
              <p className="catalogue-card__desc">{skill.purpose}</p>
              <div className="catalogue-card__footer">
                <span className="badge badge--plain">
                  {skill.linkedPromptCount} prompt
                  {skill.linkedPromptCount === 1 ? "" : "s"}
                </span>
                <span
                  className="mono text-tertiary"
                  style={{ fontSize: "var(--text-label)" }}
                >
                  Updated {formatDate(skill.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
