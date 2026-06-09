"use client";

/**
 * components/sources/source-filters.tsx
 *
 * Category and status filters for the Connected Sources page. Category is a
 * tab-like chip row; status is a second chip row. Both single-select with an
 * "All" reset. Counts are shown so the operator can see, at a glance, which
 * sources are active, available, need setup, or have errored.
 */

import {
  SOURCE_CATEGORY_LABELS,
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_TONE,
  type SourceCategory,
  type SourceStatus,
} from "@/modules/source-connection/source.types";

export type CategoryFilter = SourceCategory | "all";
export type StatusFilter = SourceStatus | "all";

export function SourceFilters({
  categories,
  statuses,
  activeCategory,
  activeStatus,
  totalCount,
  onCategoryChange,
  onStatusChange,
}: {
  /** Categories present in the catalogue, with counts. */
  categories: ReadonlyArray<{ key: SourceCategory; count: number }>;
  /** Statuses present, with counts. */
  statuses: ReadonlyArray<{ key: SourceStatus; count: number }>;
  activeCategory: CategoryFilter;
  activeStatus: StatusFilter;
  totalCount: number;
  onCategoryChange: (next: CategoryFilter) => void;
  onStatusChange: (next: StatusFilter) => void;
}) {
  return (
    <div className="source-filters">
      <div
        className="filter-bar"
        role="group"
        aria-label="Filter by category"
      >
        <button
          type="button"
          className={`filter-chip${activeCategory === "all" ? " filter-chip--active" : ""}`}
          aria-pressed={activeCategory === "all"}
          onClick={() => onCategoryChange("all")}
        >
          All categories
          <span className="filter-chip__count mono">{totalCount}</span>
        </button>
        {categories.map(({ key, count }) => (
          <button
            key={key}
            type="button"
            className={`filter-chip${activeCategory === key ? " filter-chip--active" : ""}`}
            aria-pressed={activeCategory === key}
            onClick={() => onCategoryChange(key)}
          >
            {SOURCE_CATEGORY_LABELS[key]}
            <span className="filter-chip__count mono">{count}</span>
          </button>
        ))}
      </div>

      <div
        className="filter-bar filter-bar--status"
        role="group"
        aria-label="Filter by status"
      >
        <button
          type="button"
          className={`filter-chip filter-chip--status${activeStatus === "all" ? " filter-chip--active" : ""}`}
          aria-pressed={activeStatus === "all"}
          onClick={() => onStatusChange("all")}
        >
          Any status
        </button>
        {statuses.map(({ key, count }) => (
          <button
            key={key}
            type="button"
            className={`filter-chip filter-chip--status${activeStatus === key ? " filter-chip--active" : ""}`}
            aria-pressed={activeStatus === key}
            onClick={() => onStatusChange(key)}
          >
            <span className={`status-dot status-dot--${SOURCE_STATUS_TONE[key]}`} aria-hidden="true" />
            {SOURCE_STATUS_LABELS[key]}
            <span className="filter-chip__count mono">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
