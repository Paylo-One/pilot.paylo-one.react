/**
 * components/sources/source-catalogue-card.tsx
 *
 * One source in the Sources catalogue. Deliberately quiet: identity, a short
 * description, category, connection status, and a single primary action. All
 * setup and adaptor-specific configuration lives on the dedicated source
 * detail view (/sources/<system>) this card links to — the catalogue never
 * carries forms or technical controls.
 */

import Link from "next/link";
import { SourceIcon } from "./source-icon";
import {
  SOURCE_CATEGORY_LABELS,
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_TONE,
  type SourceStatus,
  type SourceView,
} from "@/modules/source-connection/source.types";

/** Label for the card's single action; the destination is always the detail view. */
function primaryActionLabel(view: SourceView): string {
  switch (view.status as SourceStatus) {
    case "active":
    case "connected":
    case "paused":
      return "Configure";
    case "needs_attention":
    case "error":
      return "Reconnect";
    case "enterprise":
    case "coming_soon":
      return "View";
    default:
      return view.connect === "scaffold" || view.connect === "phased"
        ? "View"
        : "Connect";
  }
}

export function SourceCatalogueCard({ view }: { view: SourceView }) {
  const tone = SOURCE_STATUS_TONE[view.status];

  return (
    <Link href={`/sources/${view.system}`} className="catalogue-card">
      <div className="catalogue-card__head">
        <SourceIcon system={view.system} />
        <div className="catalogue-card__id">
          <p className="integration__name">{view.name}</p>
          <p className="integration__kind">{view.provider}</p>
        </div>
        <span className={`status status--${tone}`}>
          {SOURCE_STATUS_LABELS[view.status]}
        </span>
      </div>

      <p className="catalogue-card__desc">{view.description}</p>

      <div className="catalogue-card__footer">
        <span className="badge badge--plain">
          {SOURCE_CATEGORY_LABELS[view.category]}
        </span>
        <span className="catalogue-card__action">
          {primaryActionLabel(view)}
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
}
