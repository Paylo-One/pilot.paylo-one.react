"use client";

/**
 * app/(app)/sources/sources-browser.tsx
 *
 * Client orchestrator for the Sources catalogue. Owns the search query and the
 * category/status filters; the server builds the SourceView list and hands it
 * down. Each result is a catalogue card linking to the dedicated source detail
 * view — no configuration state lives here.
 */

import { useMemo, useState } from "react";
import {
  SOURCE_CATEGORY_LABELS,
  type SourceCategory,
  type SourceStatus,
  type SourceView,
} from "@/modules/source-connection/source.types";
import { SourceCatalogueCard } from "@/components/sources/source-catalogue-card";
import { SourceSearch } from "@/components/sources/source-search";
import {
  SourceFilters,
  type CategoryFilter,
  type StatusFilter,
} from "@/components/sources/source-filters";

const CATEGORY_ORDER: readonly SourceCategory[] = [
  "communication",
  "engineering",
  "calendar",
  "knowledge",
  "files",
  "productivity",
  "enterprise",
];

const STATUS_ORDER: readonly SourceStatus[] = [
  "active",
  "connected",
  "available",
  "needs_attention",
  "paused",
  "error",
  "enterprise",
  "coming_soon",
];

export function SourcesBrowser({ views }: { views: readonly SourceView[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Category counts (from the full set), in a stable order.
  const categoryCounts = useMemo(() => {
    const counts = new Map<SourceCategory, number>();
    for (const v of views) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
      key: c,
      count: counts.get(c) ?? 0,
    }));
  }, [views]);

  const statusCounts = useMemo(() => {
    const counts = new Map<SourceStatus, number>();
    for (const v of views) counts.set(v.status, (counts.get(v.status) ?? 0) + 1);
    return STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({
      key: s,
      count: counts.get(s) ?? 0,
    }));
  }, [views]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return views.filter((v) => {
      if (category !== "all" && v.category !== category) return false;
      if (status !== "all" && v.status !== status) return false;
      if (q) {
        const hay = `${v.name} ${v.provider} ${v.description} ${SOURCE_CATEGORY_LABELS[v.category]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [views, query, category, status]);

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
        <div className="catalogue-grid">
          {filtered.map((view) => (
            <SourceCatalogueCard key={view.system} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
