"use client";

/**
 * components/sources/storage-policy-selector.tsx
 *
 * Segmented selector for a source's storage policy. Surfaces the four policy
 * options (raw_and_summaries · summaries_only · no_raw · disabled) with a short
 * rationale, so the operator can set retention *before* ingestion. In this
 * scaffold the change is local (not persisted); the control demonstrates the
 * intended per-source control surface (source-integration-strategy.md §6).
 */

import {
  STORAGE_POLICY_HINTS,
  STORAGE_POLICY_LABELS,
  type SourceStoragePolicy,
} from "@/modules/source-connection/source.types";

const ORDER: readonly SourceStoragePolicy[] = [
  "raw_and_summaries",
  "summaries_only",
  "no_raw",
  "disabled",
];

export function StoragePolicySelector({
  value,
  onChange,
  disabled = false,
  idPrefix = "storage-policy",
}: {
  value: SourceStoragePolicy;
  onChange: (next: SourceStoragePolicy) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <div>
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Storage policy"
      >
        {ORDER.map((policy) => {
          const active = policy === value;
          return (
            <button
              key={policy}
              type="button"
              role="radio"
              aria-checked={active}
              id={`${idPrefix}-${policy}`}
              className={`segmented__option${active ? " segmented__option--active" : ""}`}
              disabled={disabled}
              onClick={() => onChange(policy)}
            >
              {STORAGE_POLICY_LABELS[policy]}
            </button>
          );
        })}
      </div>
      <p className="segmented__hint">{STORAGE_POLICY_HINTS[value]}</p>
    </div>
  );
}
