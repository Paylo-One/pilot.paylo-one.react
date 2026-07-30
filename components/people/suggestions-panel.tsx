"use client";

/**
 * components/people/suggestions-panel.tsx
 *
 * The Suggestions tab — a curated, calm alternative to the old exhaustive
 * semantic-connections list. Two scannable sections (People, Companies) lead
 * with a handful of high-confidence suggestions, each explained in plain
 * language. Everything else — the long tail, low-confidence matches, and
 * non-people edges — stays behind "View more", where lightweight search and
 * filters support deeper exploration. Add, dismiss, or inspect; nothing is
 * ever linked for you.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ENTITY_TYPE_LABELS,
  RELATIONSHIP_KIND_LABELS,
  type RelationshipKind,
} from "@/modules/people/people.types";
import type {
  CuratedSuggestions,
  SuggestedConnection,
} from "@/modules/people/relationships";
import {
  confirmLinkAction,
  rejectLinkAction,
  searchSuggestedConnectionsAction,
} from "@/app/(app)/people/actions";

function profileHref(type: string, id: string): string | null {
  if (type === "person") return `/people/${id}`;
  if (type === "company") return `/companies/${id}`;
  return null;
}

function SuggestionCard({
  suggestion,
  canManage,
}: {
  suggestion: SuggestedConnection;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"confirmed" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const inspect =
    profileHref(suggestion.sourceType, suggestion.sourceId) ??
    profileHref(suggestion.targetType, suggestion.targetId);

  return (
    <article className="link-suggestion">
      <div className="link-suggestion__main">
        <p className="memo-item__title">
          {suggestion.sourceLabel}{" "}
          <span className="suggestion-kind">{suggestion.relationshipLabel.toLowerCase()}</span>{" "}
          {suggestion.targetLabel}{" "}
          <span className="mono">· {ENTITY_TYPE_LABELS[suggestion.targetType]}</span>
        </p>
        {suggestion.evidenceSummary ? (
          <p className="action-card__rationale" style={{ marginTop: "var(--space-xs)" }}>
            {suggestion.evidenceSummary}
          </p>
        ) : null}
        <p className="repo-row__meta mono">{Math.round(suggestion.confidence * 100)}% confidence</p>
        {error ? <p className="form-message form-message--error">{error}</p> : null}
      </div>
      <div className="link-suggestion__controls">
        {done ? (
          <span className={`status status--${done === "rejected" ? "neutral" : "ok"}`}>
            {done === "confirmed" ? "Added" : "Dismissed"}
          </span>
        ) : (
          <>
            {canManage ? (
              <>
                <button
                  type="button"
                  className="btn btn--accent-outline btn--sm"
                  disabled={pending}
                  onClick={() => act("confirmed")}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={pending}
                  onClick={() => act("rejected")}
                >
                  Dismiss
                </button>
              </>
            ) : null}
            {inspect ? (
              <Link href={inspect} className="btn btn--ghost btn--sm">
                Inspect
              </Link>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

function CuratedSection({
  title,
  lead,
  items,
  total,
  bucket,
  canManage,
}: {
  title: string;
  lead: string;
  items: readonly SuggestedConnection[];
  total: number;
  bucket: "people" | "companies";
  canManage: boolean;
}) {
  const [exploring, setExploring] = useState(false);
  const hiddenCount = Math.max(0, total - items.length);

  return (
    <section className="card suggestions-section">
      <div className="card-head">
        <div>
          <p className="eyebrow">{title}</p>
          <p className="person-section__lead">{lead}</p>
        </div>
        {total > 0 ? <span className="badge">{total}</span> : null}
      </div>

      {items.length === 0 ? (
        <p className="people-empty-note">
          Nothing to suggest right now. Suggestions appear as Pilot correlates
          your recent activity — run correlation from the People tab to refresh.
        </p>
      ) : (
        <div className="stack gap-sm">
          {items.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} canManage={canManage} />
          ))}
        </div>
      )}

      {!exploring && hiddenCount > 0 ? (
        <button
          type="button"
          className="btn btn--secondary btn--sm suggestions-section__more"
          onClick={() => setExploring(true)}
        >
          View more ({hiddenCount} more, incl. lower confidence)
        </button>
      ) : null}
      {exploring ? <SuggestionExplorer bucket={bucket} canManage={canManage} /> : null}
    </section>
  );
}

const EXPLORER_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * "View more" — the deeper exploration surface. Server-backed search and
 * filtering over the full (capped) suggestion backlog for one bucket.
 */
function SuggestionExplorer({
  bucket,
  canManage,
}: {
  bucket: "people" | "companies";
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("");
  const [items, setItems] = useState<SuggestedConnection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  async function load(offset: number, append: boolean) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const res = await searchSuggestedConnectionsAction({
      bucket,
      query: query.trim() || undefined,
      relationshipType: kind || undefined,
      offset,
      limit: EXPLORER_PAGE_SIZE,
    });
    if (seq !== requestSeq.current) return; // superseded by a newer search
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Search failed.");
      return;
    }
    setTotal(res.total);
    setItems((prev) => {
      if (!append) return res.items;
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
    });
  }

  // Initial load + debounced reload on filter changes.
  useEffect(() => {
    const t = setTimeout(() => void load(0, false), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, bucket]);

  return (
    <div className="suggestion-explorer">
      <div className="suggestion-explorer__filters">
        <input
          type="search"
          className="input"
          placeholder="Search suggestions by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search suggestions"
        />
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filter by relationship kind"
        >
          <option value="">All relationship kinds</option>
          {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((k) => (
            <option key={k} value={k}>
              {RELATIONSHIP_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="form-message form-message--error">{error}</p> : null}
      {loading && items.length === 0 ? (
        <p className="people-empty-note">Loading suggestions…</p>
      ) : items.length === 0 ? (
        <p className="people-empty-note">No suggestions match.</p>
      ) : (
        <div className="stack gap-sm">
          {items.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} canManage={canManage} />
          ))}
        </div>
      )}

      {items.length < total ? (
        <div className="suggestion-explorer__foot">
          <span className="repo-row__meta mono">
            Showing {items.length} of {total}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={loading}
            onClick={() => void load(items.length, true)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SuggestionsPanel({
  suggestions,
  canManage,
}: {
  suggestions: CuratedSuggestions;
  canManage: boolean;
}) {
  return (
    <div className="stack gap-lg">
      <CuratedSection
        title="Suggested people connections"
        lead="High-confidence connections Pilot found between your people, with the evidence behind each one."
        items={suggestions.people}
        total={suggestions.totals.people}
        bucket="people"
        canManage={canManage}
      />
      <CuratedSection
        title="Suggested company connections"
        lead="Likely links between people and the companies behind them — shared domains, projects, and mentions."
        items={suggestions.companies}
        total={suggestions.totals.companies}
        bucket="companies"
        canManage={canManage}
      />
      <p className="scaffold-note">
        Only the strongest matches are shown here. Low-confidence and technical
        semantic matches stay out of the way until you open View more. Adding a
        suggestion records a confirmed connection on both profiles; dismissing
        it teaches Pilot not to propose it again.
      </p>
    </div>
  );
}
