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
import { DiaryComposer, DiaryList, type DiaryEntryView } from "./diary-client";

export default async function DiaryPage() {
  const ctx = await requireTenantContext();
  const result = await diaryService.list(ctx);
  const entries: DiaryEntryView[] = result.ok
    ? result.value.map((entry) => ({
        id: entry.id,
        body: entry.body,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
    : [];

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Diary</p>
        <h1 className="page-head__title">Private diary</h1>
        <p className="page-head__lead">
          A private thinking space for decisions, rationale, and reflection.
          Entries are visible only to you and are never fed to the system&rsquo;s
          intelligence unless you explicitly opt in. They can be linked, by your
          choice, to a briefing insight or an action.
        </p>
      </div>

      <DiaryComposer />

      <div style={{ marginTop: "var(--space-xl)" }}>
        <p className="eyebrow">Timeline</p>
        {!result.ok ? (
          <p className="scaffold-note" style={{ marginTop: "var(--space-md)" }}>
            We couldn&rsquo;t load your entries just now. Please try again.
          </p>
        ) : (
          <DiaryList entries={entries} />
        )}
      </div>
    </main>
  );
}
