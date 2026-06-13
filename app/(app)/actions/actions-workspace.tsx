"use client";

import { useMemo, useState } from "react";
import type { SuggestedActionView } from "@/modules/action-extraction/server";
import { ActionControls } from "./action-controls";
import {
  PersonLinkControl,
  type PersonLinkOption,
} from "@/components/refinement/person-link-control";
import { RefinementActions } from "@/components/refinement/refinement-actions";
import { linkActionPerson } from "./actions";

type LiveView = "today" | "captured" | "reviewed" | "all";

interface ViewItem {
  readonly id: LiveView | string;
  readonly label: string;
  readonly count?: number;
  readonly availability: "available" | "planned";
}

const STATUS_META: Record<
  string,
  { label: string; tone: "ok" | "info" | "warn" | "risk" | "neutral" }
> = {
  suggested: { label: "Review required", tone: "warn" },
  approved: { label: "Confirmed", tone: "ok" },
  edited: { label: "Edited", tone: "ok" },
  deferred: { label: "Deferred", tone: "info" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

function confidenceFor(action: SuggestedActionView): number | null {
  const values = action.references
    .map((reference) => reference.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  return values.length > 0 ? Math.max(...values) : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function sourceLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function PlannedTag() {
  return <span className="actions-view__tag">Planned</span>;
}

function ActionRow({
  action,
  selected,
  onSelect,
}: {
  action: SuggestedActionView;
  selected: boolean;
  onSelect: () => void;
}) {
  const confidence = confidenceFor(action);
  const status = STATUS_META[action.status] ?? {
    label: action.status,
    tone: "neutral" as const,
  };

  return (
    <article className={`action-row${selected ? " action-row--selected" : ""}`}>
      <span
        className={`action-row__attention action-row__attention--${status.tone}`}
        aria-hidden="true"
      />
      <button type="button" className="action-row__select" onClick={onSelect}>
        <span className="action-row__title">{action.title}</span>
        <span className="action-row__context">
          <span>{action.status === "suggested" ? "System suggestion" : "Reviewed action"}</span>
          {action.dueAt ? <span>Due {formatDate(action.dueAt)}</span> : null}
          {action.references.length > 0 ? (
            <span>
              {action.references.length}{" "}
              {action.references.length === 1 ? "source" : "sources"}
            </span>
          ) : null}
          {confidence !== null ? (
            <span>{Math.round(confidence * 100)}% confidence</span>
          ) : null}
        </span>
        {action.rationale ? (
          <span className="action-row__rationale">{action.rationale}</span>
        ) : null}
      </button>
      <span className={`status status--${status.tone}`}>{status.label}</span>
    </article>
  );
}

function ActionInspector({
  action,
  people,
}: {
  action: SuggestedActionView | null;
  people: readonly PersonLinkOption[];
}) {
  if (!action) {
    return (
      <aside className="actions-inspector">
        <div className="actions-inspector__empty">
          <p className="eyebrow">Action context</p>
          <h2>Select an action</h2>
          <p>
            Its rationale, people, sources, review controls, and history will
            appear here.
          </p>
        </div>
      </aside>
    );
  }

  const confidence = confidenceFor(action);

  return (
    <aside className="actions-inspector" aria-label="Selected action details">
      <div className="actions-inspector__head">
        <div>
          <p className="eyebrow">Action context</p>
          <h2>{action.title}</h2>
        </div>
        <ActionControls actionId={action.id} status={action.status} />
      </div>

      {action.rationale ? (
        <section className="actions-inspector__section">
          <p className="actions-inspector__label">Why this was raised</p>
          <p className="actions-inspector__prose">{action.rationale}</p>
        </section>
      ) : null}

      <section className="actions-inspector__section">
        <div className="actions-inspector__section-head">
          <p className="actions-inspector__label">Commitment context</p>
          <PlannedTag />
        </div>
        <dl className="action-memory">
          <div>
            <dt>Direction</dt>
            <dd>What you owe or who you are waiting on</dd>
          </div>
          <div>
            <dt>Next attention</dt>
            <dd>{action.dueAt ? formatDate(action.dueAt) : "Follow-up date"}</dd>
          </div>
          <div>
            <dt>Topic</dt>
            <dd>Decision, project, or strategic area</dd>
          </div>
        </dl>
      </section>

      <section className="actions-inspector__section">
        <p className="actions-inspector__label">People</p>
        <PersonLinkControl
          key={action.id}
          targetId={action.id}
          people={people}
          initialPersonId={action.personId}
          onChange={(personId) => linkActionPerson(action.id, personId)}
        />
      </section>

      <section className="actions-inspector__section">
        <div className="actions-inspector__section-head">
          <p className="actions-inspector__label">Sources</p>
          {confidence !== null ? (
            <span className="mono actions-inspector__confidence">
              {Math.round(confidence * 100)}% confidence
            </span>
          ) : null}
        </div>
        {action.references.length === 0 ? (
          <p className="actions-inspector__muted">
            No source reference is attached to this action.
          </p>
        ) : (
          <div className="action-source-list">
            {action.references.map((reference) => (
              <div className="action-source" key={reference.id}>
                <div className="action-source__head">
                  <span className="source-ref__system">
                    {sourceLabel(reference.sourceSystem)}
                  </span>
                  {reference.itemTimestamp ? (
                    <time dateTime={reference.itemTimestamp}>
                      {formatDate(reference.itemTimestamp)}
                    </time>
                  ) : null}
                </div>
                {reference.excerptOrPointer ? (
                  <p>{reference.excerptOrPointer}</p>
                ) : (
                  <p>Source pointer retained for traceability.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="actions-inspector__section">
        <RefinementActions
          targetType="action"
          targetId={action.id}
          feedback={["not_relevant", "lower_priority", "do_not_show_again"]}
        />
      </section>

      <p className="actions-inspector__audit">
        Review decisions are recorded. Nothing is sent or scheduled on your
        behalf.
      </p>
    </aside>
  );
}

export function ActionsWorkspace({
  actions,
  people,
}: {
  actions: readonly SuggestedActionView[];
  people: readonly PersonLinkOption[];
}) {
  const [view, setView] = useState<LiveView>("today");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    actions.find((action) => action.status === "suggested")?.id ??
      actions[0]?.id ??
      null,
  );

  const suggestedCount = actions.filter(
    (action) => action.status === "suggested",
  ).length;
  const reviewedCount = actions.length - suggestedCount;

  const views: ViewItem[] = [
    { id: "today", label: "Today", count: suggestedCount, availability: "available" },
    {
      id: "follow-ups",
      label: "Follow-ups",
      availability: "planned",
    },
    {
      id: "waiting",
      label: "Waiting On",
      availability: "planned",
    },
    {
      id: "captured",
      label: "Captured",
      count: suggestedCount,
      availability: "available",
    },
    {
      id: "deadlines",
      label: "Deadlines",
      availability: "planned",
    },
    {
      id: "people",
      label: "By Person",
      availability: "planned",
    },
    {
      id: "topics",
      label: "By Topic",
      availability: "planned",
    },
    {
      id: "reviewed",
      label: "Reviewed",
      count: reviewedCount,
      availability: "available",
    },
    { id: "all", label: "All", count: actions.length, availability: "available" },
  ];

  const visibleActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((action) => {
      const inView =
        view === "all" ||
        ((view === "today" || view === "captured") &&
          action.status === "suggested") ||
        (view === "reviewed" && action.status !== "suggested");
      if (!inView) return false;
      if (!q) return true;
      const sourceText = action.references
        .map(
          (reference) =>
            `${reference.sourceSystem} ${reference.excerptOrPointer ?? ""}`,
        )
        .join(" ");
      return `${action.title} ${action.rationale ?? ""} ${sourceText}`
        .toLowerCase()
        .includes(q);
    });
  }, [actions, query, view]);

  const selected =
    visibleActions.find((action) => action.id === selectedId) ??
    visibleActions[0] ??
    null;

  const viewHeading =
    view === "today"
      ? "Needs your attention"
      : view === "captured"
        ? "Captured suggestions"
        : view === "reviewed"
          ? "Reviewed actions"
          : "All actions";

  return (
    <>
      <div className="page-head actions-page__head">
        <div>
          <p className="eyebrow">Actions</p>
          <h1 className="page-head__title">Commitments with context</h1>
          <p className="page-head__lead">
            Review what needs attention, keep the source and people behind each
            commitment, and build a trusted memory of what must happen next.
          </p>
        </div>
        <span className="status status--info">Private-beta foundation</span>
      </div>

      <section className="action-capture" aria-labelledby="capture-title">
        <div className="action-capture__prompt">
          <span className="action-capture__plus" aria-hidden="true">
            +
          </span>
          <div>
            <h2 id="capture-title">Capture an action</h2>
            <p>Type the commitment now. Add people, dates, and context later.</p>
          </div>
        </div>
        <div className="action-capture__control">
          <input
            className="input"
            type="text"
            disabled
            aria-describedby="capture-status"
            placeholder="Follow up with Priya next Thursday about audit evidence…"
          />
          <button className="btn btn--primary" type="button" disabled>
            Capture
          </button>
        </div>
        <span id="capture-status" className="action-capture__status mono">
          Planned · manual capture arrives with the full action lifecycle
        </span>
      </section>

      <div className="actions-shell">
        <nav className="actions-views" aria-label="Action views">
          <p className="actions-views__label">Views</p>
          {views.map((item) =>
            item.availability === "planned" ? (
              <div
                key={item.id}
                className="actions-view actions-view--planned"
                aria-disabled="true"
              >
                <span>{item.label}</span>
                <PlannedTag />
              </div>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`actions-view${
                  view === item.id ? " actions-view--active" : ""
                }`}
                aria-pressed={view === item.id}
                onClick={() => setView(item.id as LiveView)}
              >
                <span>{item.label}</span>
                <span className="actions-view__count mono">{item.count ?? 0}</span>
              </button>
            ),
          )}
        </nav>

        <section className="actions-working-set" aria-labelledby="working-set-title">
          <div className="actions-working-set__head">
            <div>
              <p className="eyebrow">Working set</p>
              <h2 id="working-set-title">{viewHeading}</h2>
            </div>
            <span className="badge">{visibleActions.length}</span>
          </div>

          <div className="source-search actions-search">
            <span className="source-search__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              type="search"
              className="input source-search__input"
              placeholder="Search actions, people, topics, or sources…"
              aria-label="Search actions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="source-search__count mono" aria-live="polite">
              {visibleActions.length} shown
            </span>
          </div>

          <div className="actions-working-set__summary">
            <span>
              {view === "today"
                ? "Source-backed candidates awaiting your judgement."
                : "A traceable record of action suggestions and decisions."}
            </span>
            <span className="mono">
              {suggestedCount} to review · {reviewedCount} reviewed
            </span>
          </div>

          {visibleActions.length === 0 ? (
            <div className="empty actions-empty">
              <p className="empty__title">
                {query ? "No actions match" : "Nothing needs attention here"}
              </p>
              <p className="empty__body">
                {query
                  ? "Try a different search or change the current view."
                  : "New source-backed suggestions will appear here for review."}
              </p>
            </div>
          ) : (
            <div className="action-list">
              {visibleActions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  selected={action.id === selected?.id}
                  onSelect={() => setSelectedId(action.id)}
                />
              ))}
            </div>
          )}
        </section>

        <ActionInspector action={selected} people={people} />
      </div>
    </>
  );
}
