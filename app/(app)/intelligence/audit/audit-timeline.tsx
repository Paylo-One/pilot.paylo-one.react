"use client";

/**
 * The Intelligence audit timeline: every change to prompts, skills, and the
 * manifesto, in one place, filterable by area. Read-only evidence.
 */

import { useMemo, useState } from "react";

export interface AuditEntry {
  id: string;
  action: string;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

const LABELS: Record<string, string> = {
  "prompt.version.created": "Prompt draft saved",
  "prompt.version.activated": "Prompt version published",
  "prompt.version.archived": "Prompt version archived",
  "prompt.version.restored": "Prompt version restored",
  "prompt.updated": "Prompt details updated",
  "prompt.archived": "Prompt archived",
  "prompt.unarchived": "Prompt restored",
  "prompt.defaults.reset": "Prompt reset to default",
  "prompt.test.run": "Prompt tested",
  "prompt.evaluation.run": "Prompt evaluated",
  "prompt.skill.linked": "Skill applied to prompt",
  "prompt.skill.unlinked": "Skill removed from prompt",
  "custom_skill.created": "Skill created",
  "custom_skill.version.created": "Skill draft saved",
  "custom_skill.version.activated": "Skill version published",
  "custom_skill.version.restored": "Skill version restored",
  "custom_skill.updated": "Skill details updated",
  "custom_skill.archived": "Skill archived",
  "custom_skill.unarchived": "Skill restored",
  "manifesto.version.created": "Manifesto draft saved",
  "manifesto.version.activated": "Manifesto published",
  "manifesto.version.restored": "Manifesto restored",
};

type Area = "all" | "prompt" | "custom_skill" | "manifesto";

const AREA_TABS: Array<{ key: Area; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "prompt", label: "Prompts" },
  { key: "custom_skill", label: "Skills" },
  { key: "manifesto", label: "Manifesto" },
];

function areaOf(action: string): Area {
  if (action.startsWith("manifesto.")) return "manifesto";
  if (action.startsWith("custom_skill.")) return "custom_skill";
  return "prompt";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditTimeline({ entries }: { entries: readonly AuditEntry[] }) {
  const [area, setArea] = useState<Area>("all");

  const filtered = useMemo(
    () =>
      area === "all"
        ? entries
        : entries.filter((e) => areaOf(e.action) === area),
    [entries, area],
  );

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <p className="page-head__lead" style={{ marginTop: 0 }}>
        Every change to how Pilot works — who changed what, and when. Versioning
        means nothing is lost: anything here can be reviewed, and most can be
        rolled back.
      </p>

      <div className="filter-bar" role="group" aria-label="Filter history">
        {AREA_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-chip${area === t.key ? " filter-chip--active" : ""}`}
            onClick={() => setArea(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing here yet</p>
          <p className="empty__body">
            Changes will appear as you shape your prompts, skills, and
            manifesto.
          </p>
        </div>
      ) : (
        <section className="card">
          <ul className="stack" style={{ gap: "var(--space-sm)" }}>
            {filtered.map((event) => {
              const versionNumber = event.metadata?.versionNumber;
              return (
                <li
                  key={event.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "var(--space-md)",
                    paddingBottom: "var(--space-sm)",
                    borderBottom: "1px solid var(--colour-border)",
                  }}
                >
                  <span>
                    {LABELS[event.action] ?? event.action}
                    {typeof versionNumber === "number" ? (
                      <span
                        className="badge badge--plain"
                        style={{ marginLeft: "var(--space-sm)" }}
                      >
                        v{versionNumber}
                      </span>
                    ) : null}
                  </span>
                  <span className="mono text-tertiary">
                    {formatTimestamp(event.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
