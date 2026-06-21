"use client";

/**
 * Prompt library browser, grouped by purpose. Filter by purpose, status, and
 * provenance; each card links to the prompt's detail view, where editing,
 * versions, testing, and audit live.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  PROMPT_PROVENANCE_LABELS,
  PROMPT_PURPOSE_ORDER,
  PROMPT_PURPOSE_SUMMARY,
  derivePromptProvenance,
  type PromptProvenance,
  type PromptPurpose,
  type PromptTemplateKey,
  type TenantPromptSummary,
} from "@/modules/prompt-versioning";

type StatusKey = "active" | "needs_attention" | "archived";
type StatusFilter = StatusKey | "all";
type PurposeFilter = PromptPurpose | "all";
type ProvenanceFilter = PromptProvenance | "all";

function promptStatus(prompt: TenantPromptSummary): StatusKey {
  if (prompt.archivedAt) return "archived";
  return prompt.activeVersionNumber !== null ? "active" : "needs_attention";
}

const STATUS_LABELS: Record<StatusKey, string> = {
  active: "Active",
  needs_attention: "Needs a version",
  archived: "Archived",
};

const STATUS_TONE: Record<StatusKey, string> = {
  active: "ok",
  needs_attention: "warn",
  archived: "neutral",
};

const PROVENANCE_TONE: Record<PromptProvenance, string> = {
  system_default: "neutral",
  tenant_default: "info",
  custom: "info",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function IntelligencePromptsBrowser({
  prompts,
}: {
  prompts: readonly TenantPromptSummary[];
}) {
  const [purpose, setPurpose] = useState<PurposeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [provenance, setProvenance] = useState<ProvenanceFilter>("all");

  const filtered = useMemo(
    () =>
      prompts.filter((p) => {
        if (purpose !== "all" && (p.purpose as PromptPurpose) !== purpose)
          return false;
        if (status !== "all" && promptStatus(p) !== status) return false;
        if (
          provenance !== "all" &&
          derivePromptProvenance(p.activeVersionNumber) !== provenance
        )
          return false;
        return true;
      }),
    [prompts, purpose, status, provenance],
  );

  const purposesPresent = useMemo(
    () =>
      PROMPT_PURPOSE_ORDER.filter((g) => prompts.some((p) => p.purpose === g)),
    [prompts],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TenantPromptSummary[]>();
    for (const p of filtered) {
      const key = p.purpose;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return PROMPT_PURPOSE_ORDER.filter((g) => map.has(g)).map((g) => ({
      purpose: g,
      items: map.get(g)!,
    }));
  }, [filtered]);

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <p className="page-head__lead" style={{ marginTop: 0 }}>
        These are the instructions behind every judgement Pilot makes. Each one
        is private to your workspace and versioned: edits never overwrite, every
        change is kept on record, and you can test a draft against real
        information before it goes live.
      </p>

      <div className="sources-toolbar">
        <div className="filter-bar" role="group" aria-label="Filter by purpose">
          <button
            type="button"
            className={`filter-chip${purpose === "all" ? " filter-chip--active" : ""}`}
            onClick={() => setPurpose("all")}
          >
            All purposes{" "}
            <span className="filter-chip__count">{prompts.length}</span>
          </button>
          {purposesPresent.map((g) => (
            <button
              key={g}
              type="button"
              className={`filter-chip${purpose === g ? " filter-chip--active" : ""}`}
              onClick={() => setPurpose(purpose === g ? "all" : g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="filter-bar" role="group" aria-label="Filter by source">
          {(["system_default", "custom"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`filter-chip${provenance === key ? " filter-chip--active" : ""}`}
              onClick={() => setProvenance(provenance === key ? "all" : key)}
            >
              {PROMPT_PROVENANCE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing matches these filters</p>
          <p className="empty__body">
            Clear the filters to see the full library.
          </p>
        </div>
      ) : (
        grouped.map(({ purpose: g, items }) => (
          <section key={g} className="stack" style={{ gap: "var(--space-sm)" }}>
            <h2 className="card__title" style={{ marginBottom: 0 }}>
              {g}
            </h2>
            <div className="catalogue-grid">
              {items.map((prompt) => {
                const s = promptStatus(prompt);
                const prov = derivePromptProvenance(prompt.activeVersionNumber);
                return (
                  <Link
                    key={prompt.id}
                    href={`/intelligence/prompts/${prompt.id}`}
                    className="catalogue-card"
                  >
                    <div className="catalogue-card__head">
                      <div className="catalogue-card__id">
                        <p className="integration__name">{prompt.name}</p>
                        <p className="integration__kind">
                          {PROMPT_PURPOSE_SUMMARY[
                            prompt.templateKey as PromptTemplateKey
                          ] ?? prompt.workflow}
                        </p>
                      </div>
                      <span className={`status status--${STATUS_TONE[s]}`}>
                        {s === "active"
                          ? `Active · v${prompt.activeVersionNumber}`
                          : STATUS_LABELS[s]}
                      </span>
                    </div>

                    {prompt.description ? (
                      <p className="catalogue-card__desc">
                        {prompt.description}
                      </p>
                    ) : null}

                    <div className="catalogue-card__footer">
                      <span
                        className={`status status--${PROVENANCE_TONE[prov]}`}
                      >
                        {PROMPT_PROVENANCE_LABELS[prov]}
                      </span>
                      <span
                        className="mono text-tertiary"
                        style={{ fontSize: "var(--text-label)" }}
                      >
                        Updated {formatDate(prompt.updatedAt)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
