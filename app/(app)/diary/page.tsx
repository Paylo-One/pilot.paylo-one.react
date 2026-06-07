/**
 * Diary — Screen 3, private reflections. product/diary.md, services/diary.md.
 *
 * Server component: resolves the trusted tenant context, lists the signed-in
 * author's entries (newest first) via diaryService (RLS active + author-scoped),
 * and renders the client composer + list. Private by default — entries are
 * visible only to their author and are not fed to any agent this pass.
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
    <main className="app-main">
      <p className="eyebrow">Diary</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>
        Private diary
      </h1>
      <p
        style={{
          color: "var(--colour-text-secondary)",
          marginBottom: "var(--space-lg)",
          maxWidth: "60ch",
        }}
      >
        A private thinking space for reflections, decisions, and rationale.
        Entries are visible only to you and are never fed to the system&rsquo;s
        intelligence unless you explicitly opt in.
      </p>

      <DiaryComposer />

      {!result.ok ? (
        <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
          We couldn&rsquo;t load your entries just now. Please try again.
        </p>
      ) : (
        <DiaryList entries={entries} />
      )}
    </main>
  );
}
