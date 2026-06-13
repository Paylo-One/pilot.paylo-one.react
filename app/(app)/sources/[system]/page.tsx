/**
 * app/(app)/sources/[system]/page.tsx
 *
 * Dedicated setup/detail view for one source. The Sources tab is a clean
 * catalogue; everything adaptor-specific — connect/disconnect, scope
 * selection, storage policy, Daily Memo inclusion, uploads, the WhatsApp
 * session — happens here. A back link returns to the catalogue.
 *
 * Server Component: re-derives the SourceView for this system with the same
 * builder the catalogue uses, so status can never disagree between the two.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_TONE,
  SOURCE_CATEGORY_LABELS,
  MVP_STATUS_LABELS,
} from "@/modules/source-connection/source.types";
import { SourceIcon } from "@/components/sources/source-icon";
import { buildSourceViews } from "../source-views";
import { SourceDetail } from "./source-detail";
import { getNewsAdminData } from "@/modules/news/server";

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ system: string }>;
}) {
  const ctx = await requireTenantContext();
  const { system } = await params;

  const [views, newsData] = await Promise.all([
    buildSourceViews(ctx),
    system === "news" ? getNewsAdminData(ctx) : Promise.resolve(null),
  ]);
  const view = views.find((v) => v.system === system);
  if (!view) notFound();

  return (
    <main className="workspace__content workspace__content--narrow">
      <Link href="/sources" className="back-link">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All sources
      </Link>

      <div className="page-head">
        <div className="source-head">
          <SourceIcon system={view.system} className="source-head__glyph" size={22} />
          <div className="source-head__id">
            <h1 className="page-head__title" style={{ marginTop: 0 }}>
              {view.name}
            </h1>
            <p className="integration__kind">{view.provider}</p>
          </div>
          <span className={`status status--${SOURCE_STATUS_TONE[view.status]}`}>
            {SOURCE_STATUS_LABELS[view.status]}
          </span>
        </div>
        <p className="page-head__lead">{view.description}</p>
        <div className="source-head__badges">
          <span className="badge badge--plain">
            {SOURCE_CATEGORY_LABELS[view.category]}
          </span>
          <span className="badge">{MVP_STATUS_LABELS[view.mvpStatus]}</span>
        </div>
      </div>

      <SourceDetail view={view} newsData={newsData} />
    </main>
  );
}
