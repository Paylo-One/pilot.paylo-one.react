"use client";

/**
 * app/(app)/prompts/prompts-browser.tsx
 *
 * Client orchestrator for the prompt library: workflow + status filter chips
 * over the server-loaded prompt summaries. Each card links to the dedicated
 * prompt detail view — editing, versions, audit, and testing live there.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  PROMPT_WORKFLOW_LABELS,
  type PromptTemplateKey,
  type TenantPromptSummary,
} from "@/modules/prompt-versioning";

type StatusKey = "active" | "needs_attention" | "archived";
type StatusFilter = StatusKey | "all";
type WorkflowFilter = PromptTemplateKey | "all";

function promptStatus(prompt: TenantPromptSummary): StatusKey {
  if (prompt.archivedAt) return "archived";
  return prompt.activeVersionNumber !== null ? "active" : "needs_attention";
}

const STATUS_LABELS: Record<StatusKey, string> = {
  active: "Active",
  needs_attention: "No active version",
  archived: "Archived",
};

const STATUS_TONE: Record<StatusKey, string> = {
  active: "ok",
  needs_attention: "warn",
  archived: "neutral",
};

const WORKFLOW_ORDER: readonly PromptTemplateKey[] = [
  "daily_memo",
  "signal_classification",
  "signal_ranking",
  "signal_triage",
];

export function PromptsBrowser({ prompts }: { prompts: readonly TenantPromptSummary[] }) {
  const [workflow, setWorkflow] = useState<WorkflowFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(
    () =>
      prompts.filter((p) => {
        if (workflow !== "all" && p.templateKey !== workflow) return false;
        if (status !== "all" && promptStatus(p) !== status) return false;
        return true;
      }),
    [prompts, workflow, status],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<StatusKey, number>();
    for (const p of prompts) {
      const s = promptStatus(p);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  }, [prompts]);

  return (
    <div className="sources-browser">
      <div className="sources-toolbar">
        <div className="filter-bar" role="group" aria-label="Filter by workflow">
          <button
            type="button"
            className={`filter-chip${workflow === "all" ? " filter-chip--active" : ""}`}
            onClick={() => setWorkflow("all")}
          >
            All <span className="filter-chip__count">{prompts.length}</span>
          </button>
          {WORKFLOW_ORDER.filter((key) => prompts.some((p) => p.templateKey === key)).map(
            (key) => (
              <button
                key={key}
                type="button"
                className={`filter-chip${workflow === key ? " filter-chip--active" : ""}`}
                onClick={() => setWorkflow(workflow === key ? "all" : key)}
              >
                {PROMPT_WORKFLOW_LABELS[key]}
              </button>
            ),
          )}
        </div>
        <div className="filter-bar" role="group" aria-label="Filter by status">
          {(["active", "needs_attention", "archived"] as const)
            .filter((key) => (statusCounts.get(key) ?? 0) > 0)
            .map((key) => (
              <button
                key={key}
                type="button"
                className={`filter-chip${status === key ? " filter-chip--active" : ""}`}
                onClick={() => setStatus(status === key ? "all" : key)}
              >
                {STATUS_LABELS[key]}{" "}
                <span className="filter-chip__count">{statusCounts.get(key)}</span>
              </button>
            ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No prompts match your filters</p>
          <p className="empty__body">Clear the filters to see the full library.</p>
        </div>
      ) : (
        <div className="catalogue-grid">
          {filtered.map((prompt) => {
            const s = promptStatus(prompt);
            return (
              <Link
                key={prompt.id}
                href={`/prompts/${prompt.id}`}
                className="catalogue-card"
              >
                <div className="catalogue-card__head">
                  <div className="catalogue-card__id">
                    <p className="integration__name">{prompt.name}</p>
                    <p className="integration__kind">
                      {PROMPT_WORKFLOW_LABELS[prompt.templateKey]}
                    </p>
                  </div>
                  <span className={`status status--${STATUS_TONE[s]}`}>
                    {s === "active"
                      ? `Active · v${prompt.activeVersionNumber}`
                      : STATUS_LABELS[s]}
                  </span>
                </div>

                <p className="catalogue-card__desc">{prompt.description}</p>

                <div className="catalogue-card__footer">
                  <span className="badge badge--plain">
                    {prompt.versionCount} version{prompt.versionCount === 1 ? "" : "s"}
                  </span>
                  <span className="catalogue-card__action">
                    Configure
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
