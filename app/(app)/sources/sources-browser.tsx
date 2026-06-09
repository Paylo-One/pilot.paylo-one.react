"use client";

/**
 * app/(app)/sources/sources-browser.tsx
 *
 * Client orchestrator for the Connected Sources page. Owns the search query,
 * the category/status filters, and the per-source control state (active, Daily
 * Memo inclusion, storage policy). The server builds the SourceView list and
 * hands it down; this component makes the catalogue searchable, filterable, and
 * configurable.
 *
 * Scaffold: activation/policy state is local (not persisted). Real connect/
 * disconnect for GitHub + file upload happen through their own affordances.
 */

import { useMemo, useState } from "react";
import {
  SOURCE_CATEGORY_LABELS,
  type SourceCategory,
  type SourceStatus,
  type SourceStoragePolicy,
  type SourceType,
  type SourceView,
} from "@/modules/source-connection/source.types";
import { SourceCard, type SourceCardState } from "@/components/sources/source-card";
import { SourceSearch } from "@/components/sources/source-search";
import {
  SourceFilters,
  type CategoryFilter,
  type StatusFilter,
} from "@/components/sources/source-filters";

/** Initial control state for a source, seeded from its server-derived view. */
function seedState(view: SourceView): SourceCardState {
  return {
    active: view.status === "active",
    inMemo: view.inDailyMemo,
    storagePolicy: view.storagePolicy,
  };
}

/**
 * The status shown + filtered on. Scaffold sources reflect their local
 * activation toggle so the operator sees immediate feedback; wired/phased
 * sources keep their server-derived status.
 */
function effectiveStatus(view: SourceView, state: SourceCardState): SourceStatus {
  if (view.connect === "scaffold") return state.active ? "active" : "available";
  return view.status;
}

const CATEGORY_ORDER: readonly SourceCategory[] = [
  "communication",
  "engineering",
  "calendar",
  "knowledge",
  "files",
  "productivity",
  "enterprise",
];

export function SourcesBrowser({ views }: { views: readonly SourceView[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [stateBySystem, setStateBySystem] = useState<
    Record<SourceType, SourceCardState>
  >(() => {
    const seed = {} as Record<SourceType, SourceCardState>;
    for (const v of views) seed[v.system] = seedState(v);
    return seed;
  });

  function updateState(system: SourceType, patch: Partial<SourceCardState>) {
    setStateBySystem((prev) => ({
      ...prev,
      [system]: { ...prev[system], ...patch },
    }));
  }

  // Category counts (from the full set), in a stable order.
  const categoryCounts = useMemo(() => {
    const counts = new Map<SourceCategory, number>();
    for (const v of views) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
      key: c,
      count: counts.get(c) ?? 0,
    }));
  }, [views]);

  // Status counts use the effective (locally-toggled) status.
  const statusCounts = useMemo(() => {
    const counts = new Map<SourceStatus, number>();
    for (const v of views) {
      const s = effectiveStatus(v, stateBySystem[v.system] ?? seedState(v));
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const order: SourceStatus[] = [
      "active",
      "connected",
      "available",
      "needs_attention",
      "paused",
      "error",
      "enterprise",
      "coming_soon",
    ];
    return order
      .filter((s) => counts.has(s))
      .map((s) => ({ key: s, count: counts.get(s) ?? 0 }));
  }, [views, stateBySystem]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return views.filter((v) => {
      const st = stateBySystem[v.system] ?? seedState(v);
      const eff = effectiveStatus(v, st);
      if (category !== "all" && v.category !== category) return false;
      if (status !== "all" && eff !== status) return false;
      if (q) {
        const hay = `${v.name} ${v.provider} ${v.description} ${SOURCE_CATEGORY_LABELS[v.category]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [views, stateBySystem, query, category, status]);

  const hasActiveFilter = category !== "all" || status !== "all" || query.trim() !== "";

  return (
    <div className="sources-browser">
      <div className="sources-toolbar">
        <SourceSearch
          value={query}
          onChange={setQuery}
          resultCount={filtered.length}
        />
        <SourceFilters
          categories={categoryCounts}
          statuses={statusCounts}
          activeCategory={category}
          activeStatus={status}
          totalCount={views.length}
          onCategoryChange={setCategory}
          onStatusChange={setStatus}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No sources match your filters</p>
          <p className="empty__body">
            {hasActiveFilter
              ? "Clear the search or filters to see the full catalogue."
              : "No sources are available."}
          </p>
          {hasActiveFilter ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ marginTop: "var(--space-md)" }}
              onClick={() => {
                setQuery("");
                setCategory("all");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="integration-grid">
          {filtered.map((view) => {
            const st = stateBySystem[view.system] ?? seedState(view);
            const displayView: SourceView = {
              ...view,
              status: effectiveStatus(view, st),
            };
            return (
              <SourceCard
                key={view.system}
                view={displayView}
                state={st}
                onToggleActive={(next) => updateState(view.system, { active: next })}
                onToggleMemo={(next) => updateState(view.system, { inMemo: next })}
                onStoragePolicyChange={(next: SourceStoragePolicy) =>
                  updateState(view.system, { storagePolicy: next })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
