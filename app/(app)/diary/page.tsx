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
  WeeklyDiarySummary,
  type DiaryEntryView,
  type DiaryWeeklySummaryView,
} from "./diary-client";

export default async function DiaryPage() {
  const ctx = await requireTenantContext();
  const [result, summariesResult] = await Promise.all([
    diaryService.list(ctx),
    diaryService.listWeeklySummaries(ctx),
  ]);
  const entries: DiaryEntryView[] = result.ok
    ? result.value.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        entryType: entry.entryType,
        body: entry.body,
        transcript: entry.transcript,
        audioStoragePath: entry.audioStoragePath,
        audioMimeType: entry.audioMimeType,
        audioDurationSeconds: entry.audioDurationSeconds,
        transcriptionStatus: entry.transcriptionStatus,
        riskStatus: entry.riskStatus,
        riskResolvedAt: entry.riskResolvedAt,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
    : [];
  const summaries: DiaryWeeklySummaryView[] = summariesResult.ok
    ? summariesResult.value.map((summary) => ({
        id: summary.id,
        weekStartDate: summary.weekStartDate,
        keyReflections: summary.keyReflections,
        importantDecisions: summary.importantDecisions,
        notableRisks: summary.notableRisks,
        followUpsCreated: summary.followUpsCreated,
        recurringThemes: summary.recurringThemes,
        nextWeekAttention: summary.nextWeekAttention,
        entryCount: summary.entryCount,
        generatedAt: summary.generatedAt,
      }))
    : [];

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Diary</p>
        <h1 className="page-head__title">Your Private Diary</h1>
        <p className="page-head__lead">
          Capture what happened, what matters, what needs attention, and what
          should be remembered. Private to you unless you choose to turn a note
          into an action.
        </p>
      </div>

      <DiaryComposer />

      <WeeklyDiarySummary summaries={summaries} entryCount={entries.length} />

      <div style={{ marginTop: "var(--space-xl)" }}>
        {!result.ok ? (
          <>
            <p className="eyebrow">Daily record</p>
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
