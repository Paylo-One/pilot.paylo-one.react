/**
 * Diary — Screen 3, private reflections. product/diary.md, services/diary.md.
 *
 * Server component: resolves the trusted tenant context, lists the signed-in
 * author's entries (newest first) via diaryService (RLS active + author-scoped),
 * and renders the client composer + timeline. Private by default — entries are
 * visible only to their author and are not fed to any agent this pass. The
 * Diary is part of the leadership memory system, not a generic journal.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { diaryService } from "@/modules/diary";
import {
  DiaryComposer,
  DiaryTimeline,
  type DiaryEntryView,
} from "./diary-client";

export default async function DiaryPage() {
  const ctx = await requireTenantContext();
  const result = await diaryService.list(ctx);
  const entries: DiaryEntryView[] = result.ok
    ? result.value.map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        body: entry.body,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
    : [];

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Diary</p>
        <h1 className="page-head__title">Your private diary</h1>
        <p className="page-head__lead">
          A quiet place to capture your day &mdash; what you decided, what
          you&rsquo;re acting on, and what&rsquo;s still open. Private to you, and
          never used by the system unless you choose.
        </p>
      </div>

      <DiaryComposer />

      <div style={{ marginTop: "var(--space-xl)" }}>
        {!result.ok ? (
          <>
            <p className="eyebrow">Timeline</p>
            <p className="scaffold-note" style={{ marginTop: "var(--space-md)" }}>
              We couldn&rsquo;t load your entries just now. Please try again.
            </p>
          </>
        ) : (
          <DiaryTimeline entries={entries} />
        )}
      </div>
    </main>
  );
}
