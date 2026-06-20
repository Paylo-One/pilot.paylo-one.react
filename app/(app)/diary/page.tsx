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
  DiaryCapture,
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
      <div className="diary">
        <header className="diary__masthead">
          <p className="eyebrow">Diary</p>
          <h1 className="diary__title">Your day, remembered clearly.</h1>
          <p className="diary__lead">
            Keep the decisions, risks, and moments that shouldn&rsquo;t slip.
            Write them or speak them — they stay private to you.
          </p>
          <p className="diary__statusline">
            <span className="dot dot--ready" aria-hidden="true" />
            Private to you · only you can read this
          </p>
        </header>

        <DiaryCapture />

        <WeeklyDiarySummary summaries={summaries} entryCount={entries.length} />

        {!result.ok ? (
          <div className="diary-empty">
            <p className="diary-empty__title">We couldn&rsquo;t load your record</p>
            <p className="diary-empty__body">
              Your entries are safe. Refresh the page to try again.
            </p>
          </div>
        ) : (
          <DiaryTimeline entries={entries} />
        )}
      </div>
    </main>
  );
}
