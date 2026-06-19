"use server";

/**
 * Server actions for the Diary surface.
 *
 * Every action re-derives the trusted tenant context server-side via
 * requireTenantContext() — the client never supplies tenant or author. Writes
 * go through diaryService (USER server client, RLS active + author-scoped).
 * Create and delete are recorded to the append-only audit trail.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import OpenAI from "openai";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { diaryService, type DiaryEntry } from "@/modules/diary";
import { auditService } from "@/modules/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { ActionPriority, ActionStatus } from "@/modules/action-extraction/server";

import type { DiaryFormState } from "./types";

export interface DiaryActionState {
  readonly ok: boolean;
  readonly error: string | null;
  readonly transcript?: string;
}

function excerpt(text: string | null | undefined, max = 180): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function actionTitleFromEntry(entry: DiaryEntry, fallback: string): string {
  const source = excerpt(entry.transcript || entry.body, 72);
  return source || fallback;
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

async function linkDiaryAction(
  diaryEntry: DiaryEntry,
  actionId: string,
  linkType: "follow_up" | "risk",
) {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("source_references").insert({
    tenant_id: diaryEntry.tenantId,
    suggested_action_id: actionId,
    diary_entry_id: diaryEntry.id,
    source_system: "diary",
    item_timestamp: diaryEntry.createdAt,
    confidence: 1,
    excerpt_or_pointer: `diary:${diaryEntry.id} · ${linkType} · ${excerpt(
      diaryEntry.transcript || diaryEntry.body,
    )}`,
  });
  if (error) throw new Error(error.message);
}

async function hasDiaryActionLink(
  tenantId: string,
  diaryEntryId: string,
  linkType: "follow_up" | "risk",
): Promise<boolean> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_references")
    .select("id, excerpt_or_pointer")
    .eq("tenant_id", tenantId)
    .eq("diary_entry_id", diaryEntryId)
    .eq("source_system", "diary");
  if (error) throw new Error(error.message);
  return (data ?? []).some((row) =>
    String(row.excerpt_or_pointer ?? "").includes(`· ${linkType} ·`),
  );
}

async function createActionForDiaryEntry(input: {
  diaryEntry: DiaryEntry;
  title: string;
  description?: string;
  linkType: "follow_up" | "risk";
  priority?: ActionPriority;
  status?: ActionStatus;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggested_actions")
    .insert({
      tenant_id: input.diaryEntry.tenantId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? "inbox",
      priority: input.priority ?? "normal",
      topics: input.linkType === "risk" ? ["risk"] : ["follow-up"],
      rationale: `Created from a private diary ${input.linkType.replace("_", "-")}. ${excerpt(
        input.diaryEntry.transcript || input.diaryEntry.body,
      )}`,
      created_by: input.diaryEntry.authorUserId,
      created_from: "diary",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create the action.");
  }

  await linkDiaryAction(input.diaryEntry, data.id, input.linkType);
  return data.id as string;
}

async function ensureRiskAction(entry: DiaryEntry) {
  if (entry.entryType !== "risk") return;
  if (await hasDiaryActionLink(entry.tenantId, entry.id, "risk")) return;
  await createActionForDiaryEntry({
    diaryEntry: entry,
    linkType: "risk",
    title: `Resolve risk: ${actionTitleFromEntry(entry, "Diary risk")}`,
    description: entry.transcript || entry.body || undefined,
    priority: "high",
    status: "planned",
  });
}

async function completeRiskActions(entry: DiaryEntry, note?: string) {
  const secret = createSupabaseSecretClient();
  const { data: refs, error: refError } = await secret
    .from("source_references")
    .select("suggested_action_id, excerpt_or_pointer")
    .eq("tenant_id", entry.tenantId)
    .eq("diary_entry_id", entry.id)
    .eq("source_system", "diary");
  if (refError) throw new Error(refError.message);

  const actionIds = (refs ?? [])
    .filter((ref) => String(ref.excerpt_or_pointer ?? "").includes("· risk ·"))
    .map((ref) => ref.suggested_action_id)
    .filter(Boolean);
  if (actionIds.length === 0) return;

  const { error } = await secret
    .from("suggested_actions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completion_metadata: {
        completed_from: "diary_risk_resolved",
        note: note?.trim() || null,
      },
    })
    .in("id", actionIds);
  if (error) throw new Error(error.message);
}

export async function createEntryAction(
  _prev: DiaryFormState,
  formData: FormData,
): Promise<DiaryFormState> {
  const ctx = await requireTenantContext();
  const body = String(formData.get("body") ?? "");
  const entryType = String(formData.get("entryType") ?? "");

  const result = await diaryService.create(ctx, { body, entryType });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  if (result.value.entryType === "risk") {
    try {
      await ensureRiskAction(result.value);
    } catch (cause) {
      return {
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : "Saved the risk, but could not add it to Actions.",
      };
    }
  }

  await auditService.record(ctx, {
    action: "diary.created",
    target: result.value.id,
    metadata: { entryType: result.value.entryType },
  });

  revalidatePath("/diary");
  return { ok: true, error: null };
}

export async function updateEntryAction(
  _prev: DiaryFormState,
  formData: FormData,
): Promise<DiaryFormState> {
  const ctx = await requireTenantContext();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "");
  const entryType = String(formData.get("entryType") ?? "");
  const prevEntryType = String(formData.get("prevEntryType") ?? "");

  if (!id) {
    return { ok: false, error: "Missing entry reference." };
  }

  const result = await diaryService.update(ctx, { id, body, entryType });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  if (result.value.entryType === "risk") {
    try {
      await ensureRiskAction(result.value);
    } catch (cause) {
      return {
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : "Saved the risk, but could not add it to Actions.",
      };
    }
  }

  // Record only a meaningful reclassification, not every text edit.
  if (result.value.entryType !== prevEntryType) {
    await auditService.record(ctx, {
      action: "diary.updated",
      target: result.value.id,
      metadata: { entryType: result.value.entryType },
    });
  }

  revalidatePath("/diary");
  return { ok: true, error: null };
}

export async function transcribeVoiceNoteAction(
  formData: FormData,
): Promise<DiaryActionState> {
  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return { ok: false, error: "Record a voice note before transcribing." };
  }
  if (audio.size > 25 * 1024 * 1024) {
    return { ok: false, error: "Keep voice notes under 25 MB." };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Transcription is not configured yet. You can still type a note and save it.",
    };
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
    });
    const transcript = String(response.text ?? "").trim();
    if (!transcript) {
      return {
        ok: false,
        error: "The recording was transcribed, but no words were detected.",
      };
    }
    return { ok: true, error: null, transcript };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error
          ? cause.message
          : "Could not transcribe this recording.",
    };
  }
}

export async function createVoiceEntryAction(
  _prev: DiaryFormState,
  formData: FormData,
): Promise<DiaryFormState> {
  const ctx = await requireTenantContext();
  const audio = formData.get("audio");
  const transcript = String(formData.get("transcript") ?? "").trim();
  const body = transcript || String(formData.get("body") ?? "").trim();
  const entryType = String(formData.get("entryType") ?? "note");
  const duration = Number(formData.get("durationSeconds") ?? 0);

  if (!(audio instanceof File) || audio.size === 0) {
    return { ok: false, error: "Record a voice note before saving." };
  }
  if (!body) {
    return {
      ok: false,
      error: "Add or transcribe a few words before saving the voice note.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const extension = audioExtension(audio.type || "audio/webm");
  const storagePath = `${ctx.tenantId}/${ctx.userId}/diary/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("voice-notes")
    .upload(storagePath, audio, {
      contentType: audio.type || "audio/webm",
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const result = await diaryService.create(ctx, {
    body,
    entryType,
    kind: "voice",
    transcript: transcript || null,
    audioStoragePath: storagePath,
    audioMimeType: audio.type || "audio/webm",
    audioDurationSeconds: Number.isFinite(duration)
      ? Math.max(0, Math.round(duration))
      : null,
    transcriptionStatus: transcript ? "done" : "failed",
  });
  if (!result.ok) {
    await supabase.storage.from("voice-notes").remove([storagePath]);
    return { ok: false, error: result.error.message };
  }

  if (result.value.entryType === "risk") {
    try {
      await ensureRiskAction(result.value);
    } catch (cause) {
      return {
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : "Saved the voice note, but could not add the risk to Actions.",
      };
    }
  }

  await auditService.record(ctx, {
    action: "diary.voice.created",
    target: result.value.id,
    metadata: {
      entryType: result.value.entryType,
      audioMimeType: result.value.audioMimeType,
      transcriptionStatus: result.value.transcriptionStatus,
    },
  });

  revalidatePath("/diary");
  revalidatePath("/actions");
  revalidatePath("/briefing");
  return { ok: true, error: null };
}

export async function createDiaryFollowUpAction(
  formData: FormData,
): Promise<DiaryActionState> {
  const ctx = await requireTenantContext();
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id || !title) {
    return { ok: false, error: "Add a short action title before creating it." };
  }

  const list = await diaryService.list(ctx);
  if (!list.ok) return { ok: false, error: list.error.message };
  const entry = list.value.find((candidate) => candidate.id === id);
  if (!entry) return { ok: false, error: "Diary entry not found." };

  try {
    const actionId = await createActionForDiaryEntry({
      diaryEntry: entry,
      linkType: "follow_up",
      title,
      description: entry.transcript || entry.body || undefined,
      priority: "normal",
      status: "inbox",
    });
    await auditService.record(ctx, {
      action: "diary.follow_up.action_created",
      target: entry.id,
      metadata: { actionId },
    });
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error ? cause.message : "Could not create the action.",
    };
  }

  revalidatePath("/diary");
  revalidatePath("/actions");
  revalidatePath("/briefing");
  return { ok: true, error: null };
}

export async function resolveRiskEntryAction(
  formData: FormData,
): Promise<DiaryActionState> {
  const ctx = await requireTenantContext();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "Missing risk reference." };

  const result = await diaryService.resolveRisk(ctx, { id, note });
  if (!result.ok) return { ok: false, error: result.error.message };

  try {
    await completeRiskActions(result.value, note);
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error
          ? cause.message
          : "Resolved the risk, but could not update Actions.",
    };
  }

  await auditService.record(ctx, {
    action: "diary.risk.resolved",
    target: id,
    metadata: { note: note || null },
  });

  revalidatePath("/diary");
  revalidatePath("/actions");
  revalidatePath("/briefing");
  return { ok: true, error: null };
}

function startOfWeekIso(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function normaliseSummaryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

interface WeeklySummaryDraft {
  keyReflections: string[];
  importantDecisions: string[];
  notableRisks: string[];
  followUpsCreated: string[];
  recurringThemes: string[];
  nextWeekAttention: string[];
}

function fallbackWeeklySummary(entries: DiaryEntry[]): WeeklySummaryDraft {
  const textFor = (entry: DiaryEntry) => excerpt(entry.transcript || entry.body, 140);
  return {
    keyReflections: entries
      .filter((entry) => entry.entryType === "reflection" || entry.entryType === "note")
      .map(textFor)
      .filter(Boolean)
      .slice(0, 4),
    importantDecisions: entries
      .filter((entry) => entry.entryType === "decision")
      .map(textFor)
      .filter(Boolean)
      .slice(0, 4),
    notableRisks: entries
      .filter((entry) => entry.entryType === "risk")
      .map(textFor)
      .filter(Boolean)
      .slice(0, 4),
    followUpsCreated: entries
      .filter((entry) => entry.entryType === "follow_up" || entry.entryType === "action")
      .map(textFor)
      .filter(Boolean)
      .slice(0, 4),
    recurringThemes: [],
    nextWeekAttention: entries
      .filter((entry) => entry.entryType === "risk" || entry.entryType === "follow_up")
      .map(textFor)
      .filter(Boolean)
      .slice(0, 4),
  };
}

export async function generateWeeklySummaryAction(): Promise<DiaryActionState> {
  const ctx = await requireTenantContext();
  const list = await diaryService.list(ctx);
  if (!list.ok) return { ok: false, error: list.error.message };

  const weekStartDate = startOfWeekIso();
  const weekStart = new Date(`${weekStartDate}T00:00:00.000Z`);
  const entries = list.value.filter(
    (entry) => new Date(entry.createdAt).getTime() >= weekStart.getTime(),
  );
  if (entries.length === 0) {
    return {
      ok: false,
      error: "Capture a few diary entries before preparing a weekly summary.",
    };
  }

  let summary = fallbackWeeklySummary(entries);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) {
    try {
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Summarise a private operator diary for a weekly review. Keep it calm, concise, and useful. Do not invent facts. Return JSON with arrays: keyReflections, importantDecisions, notableRisks, followUpsCreated, recurringThemes, nextWeekAttention.",
          },
          {
            role: "user",
            content: entries
              .map(
                (entry, index) =>
                  `${index + 1}. [${entry.entryType}] ${entry.createdAt}: ${
                    entry.transcript || entry.body || ""
                  }`,
              )
              .join("\n"),
          },
        ],
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
      summary = {
        keyReflections: normaliseSummaryList(parsed.keyReflections),
        importantDecisions: normaliseSummaryList(parsed.importantDecisions),
        notableRisks: normaliseSummaryList(parsed.notableRisks),
        followUpsCreated: normaliseSummaryList(parsed.followUpsCreated),
        recurringThemes: normaliseSummaryList(parsed.recurringThemes),
        nextWeekAttention: normaliseSummaryList(parsed.nextWeekAttention),
      };
    } catch (cause) {
      console.warn("Weekly diary summary fell back to deterministic grouping:", cause);
    }
  }

  const result = await diaryService.upsertWeeklySummary(ctx, {
    weekStartDate,
    entryCount: entries.length,
    ...summary,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  await auditService.record(ctx, {
    action: "diary.weekly_summary.generated",
    target: result.value.id,
    metadata: { weekStartDate, entryCount: entries.length },
  });

  revalidatePath("/diary");
  return { ok: true, error: null };
}

export async function deleteEntryAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const result = await diaryService.delete(ctx, id);
  if (result.ok) {
    await auditService.record(ctx, { action: "diary.deleted", target: id });
    revalidatePath("/diary");
  }
}
