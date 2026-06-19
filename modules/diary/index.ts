import "server-only";

/**
 * modules/diary — private text + voice journaling with transcription, weekly
 * summaries, and lightweight risk state. Diary rows carry author_user_id and
 * are restricted to the author even within a multi-user tenant.
 * Governance: services/diary.md, product/diary.md.
 *
 * We use the USER server client so the database RLS policies enforce
 * `tenant_id ∈ auth_tenant_ids()` AND `author_user_id = auth.uid()` for every
 * read and write. We still pass the explicit predicates for clarity and defence
 * in depth. Linking to Actions is done through source_references so provenance
 * stays visible without making diary entries public to the tenant.
 */

import {
  AppError,
  ValidationError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The lightweight, fixed vocabulary of entry types (ADR-041). One optional tag
 * per entry; defaults to "note". Kept in sync with the entry_type CHECK in
 * migration 20260613170000_diary_entry_type.sql.
 */
export const DIARY_ENTRY_TYPES = [
  "note",
  "decision",
  "action",
  "reflection",
  "meeting",
  "idea",
  "risk",
  "follow_up",
] as const;

export type DiaryEntryType = (typeof DIARY_ENTRY_TYPES)[number];

export const DEFAULT_DIARY_ENTRY_TYPE: DiaryEntryType = "note";

function isDiaryEntryType(value: string): value is DiaryEntryType {
  return (DIARY_ENTRY_TYPES as readonly string[]).includes(value);
}

/** Coerce arbitrary input to a valid entry type, falling back to the default. */
function normaliseEntryType(raw: string | undefined): DiaryEntryType {
  if (raw && isDiaryEntryType(raw)) return raw;
  return DEFAULT_DIARY_ENTRY_TYPE;
}

/** A single private diary entry, owned by its author within a tenant. */
export interface DiaryEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly authorUserId: string;
  readonly kind: "text" | "voice";
  readonly entryType: DiaryEntryType;
  readonly body: string | null;
  readonly transcript: string | null;
  readonly audioStoragePath: string | null;
  readonly audioMimeType: string | null;
  readonly audioDurationSeconds: number | null;
  readonly transcriptionStatus: "none" | "pending" | "done" | "failed";
  readonly riskStatus: "active" | "resolved" | null;
  readonly riskResolvedAt: string | null;
  readonly riskResolutionNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input to create a diary entry. */
export interface CreateDiaryEntryInput {
  readonly body: string;
  readonly entryType?: string;
  readonly kind?: "text" | "voice";
  readonly transcript?: string | null;
  readonly audioStoragePath?: string | null;
  readonly audioMimeType?: string | null;
  readonly audioDurationSeconds?: number | null;
  readonly transcriptionStatus?: "none" | "pending" | "done" | "failed";
}

/** Input to edit the body and/or type of an existing entry. */
export interface UpdateDiaryEntryInput {
  readonly id: string;
  readonly body: string;
  readonly entryType?: string;
  readonly transcript?: string | null;
}

export interface DiaryWeeklySummary {
  readonly id: string;
  readonly weekStartDate: string;
  readonly keyReflections: string[];
  readonly importantDecisions: string[];
  readonly notableRisks: string[];
  readonly followUpsCreated: string[];
  readonly recurringThemes: string[];
  readonly nextWeekAttention: string[];
  readonly entryCount: number;
  readonly generatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertWeeklySummaryInput {
  readonly weekStartDate: string;
  readonly keyReflections: string[];
  readonly importantDecisions: string[];
  readonly notableRisks: string[];
  readonly followUpsCreated: string[];
  readonly recurringThemes: string[];
  readonly nextWeekAttention: string[];
  readonly entryCount: number;
}

export interface DiaryService {
  /** The signed-in author's entries within the tenant, newest first. */
  list(ctx: TenantContext): Promise<Result<DiaryEntry[]>>;
  /** Latest author-owned weekly summaries, newest first. */
  listWeeklySummaries(ctx: TenantContext): Promise<Result<DiaryWeeklySummary[]>>;
  /** Active author-owned risk entries for the briefing. */
  listActiveRisks(ctx: TenantContext): Promise<Result<DiaryEntry[]>>;
  /** Create a timestamped text entry authored by the current user. */
  create(
    ctx: TenantContext,
    input: CreateDiaryEntryInput,
  ): Promise<Result<DiaryEntry>>;
  /** Edit the body of one of the author's own entries. */
  update(
    ctx: TenantContext,
    input: UpdateDiaryEntryInput,
  ): Promise<Result<DiaryEntry>>;
  /** Mark an author's risk entry resolved, preserving the historical entry. */
  resolveRisk(
    ctx: TenantContext,
    input: { id: string; note?: string },
  ): Promise<Result<DiaryEntry>>;
  /** Upsert the author's weekly summary for a week. */
  upsertWeeklySummary(
    ctx: TenantContext,
    input: UpsertWeeklySummaryInput,
  ): Promise<Result<DiaryWeeklySummary>>;
  /** Permanently delete one of the author's own entries. */
  delete(ctx: TenantContext, id: string): Promise<Result<void>>;
}

/** Columns selected for a DiaryEntry projection. */
const ENTRY_COLUMNS =
  "id, tenant_id, author_user_id, kind, entry_type, body, transcript, audio_storage_path, audio_mime_type, audio_duration_seconds, transcription_status, risk_status, risk_resolved_at, risk_resolution_note, created_at, updated_at";

const WEEKLY_SUMMARY_COLUMNS =
  "id, week_start_date, key_reflections, important_decisions, notable_risks, follow_ups_created, recurring_themes, next_week_attention, entry_count, generated_at, created_at, updated_at";

interface DiaryEntryRow {
  id: string;
  tenant_id: string;
  author_user_id: string;
  kind: "text" | "voice";
  entry_type: string;
  body: string | null;
  transcript: string | null;
  audio_storage_path: string | null;
  audio_mime_type: string | null;
  audio_duration_seconds: number | null;
  transcription_status: "none" | "pending" | "done" | "failed";
  risk_status: "active" | "resolved" | null;
  risk_resolved_at: string | null;
  risk_resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

interface DiaryWeeklySummaryRow {
  id: string;
  week_start_date: string;
  key_reflections: string[] | null;
  important_decisions: string[] | null;
  notable_risks: string[] | null;
  follow_ups_created: string[] | null;
  recurring_themes: string[] | null;
  next_week_attention: string[] | null;
  entry_count: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DiaryEntryRow): DiaryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    authorUserId: row.author_user_id,
    kind: row.kind,
    entryType: normaliseEntryType(row.entry_type),
    body: row.body,
    transcript: row.transcript,
    audioStoragePath: row.audio_storage_path,
    audioMimeType: row.audio_mime_type,
    audioDurationSeconds: row.audio_duration_seconds,
    transcriptionStatus: row.transcription_status ?? "none",
    riskStatus: row.risk_status,
    riskResolvedAt: row.risk_resolved_at,
    riskResolutionNote: row.risk_resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWeeklySummaryRow(row: DiaryWeeklySummaryRow): DiaryWeeklySummary {
  return {
    id: row.id,
    weekStartDate: row.week_start_date,
    keyReflections: row.key_reflections ?? [],
    importantDecisions: row.important_decisions ?? [],
    notableRisks: row.notable_risks ?? [],
    followUpsCreated: row.follow_ups_created ?? [],
    recurringThemes: row.recurring_themes ?? [],
    nextWeekAttention: row.next_week_attention ?? [],
    entryCount: row.entry_count,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trim and validate a free-text body; entries must carry something. */
function normaliseBody(raw: string): Result<string> {
  const body = raw.trim();
  if (body.length === 0) {
    return err(new ValidationError("A diary entry cannot be empty."));
  }
  if (body.length > 20_000) {
    return err(
      new ValidationError("A diary entry must be 20,000 characters or fewer."),
    );
  }
  return ok(body);
}

export const diaryService: DiaryService = {
  async list(ctx) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .select(ENTRY_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .order("created_at", { ascending: false });

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok((data as DiaryEntryRow[]).map(mapRow));
  },

  async listWeeklySummaries(ctx) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_weekly_summaries")
      .select(WEEKLY_SUMMARY_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .order("week_start_date", { ascending: false })
      .limit(8);

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok((data as DiaryWeeklySummaryRow[]).map(mapWeeklySummaryRow));
  },

  async listActiveRisks(ctx) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .select(ENTRY_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .eq("entry_type", "risk")
      .or("risk_status.is.null,risk_status.eq.active")
      .order("created_at", { ascending: false });

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok((data as DiaryEntryRow[]).map(mapRow));
  },

  async create(ctx, input) {
    const normalised = normaliseBody(input.body);
    if (!normalised.ok) return normalised;
    const entryType = normaliseEntryType(input.entryType);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .insert({
        tenant_id: ctx.tenantId,
        // Author scoping is non-negotiable: never trust client input here.
        author_user_id: ctx.userId,
        kind: input.kind ?? "text",
        entry_type: entryType,
        body: normalised.value,
        transcript: input.transcript ?? null,
        audio_storage_path: input.audioStoragePath ?? null,
        audio_mime_type: input.audioMimeType ?? null,
        audio_duration_seconds: input.audioDurationSeconds ?? null,
        transcription_status:
          input.transcriptionStatus ?? (input.transcript ? "done" : "none"),
        risk_status: entryType === "risk" ? "active" : null,
      })
      .select(ENTRY_COLUMNS)
      .single();

    if (error || !data) {
      return err(new AppError("internal", error?.message ?? "create_failed"));
    }
    return ok(mapRow(data as DiaryEntryRow));
  },

  async update(ctx, input) {
    const normalised = normaliseBody(input.body);
    if (!normalised.ok) return normalised;
    const entryType = normaliseEntryType(input.entryType);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .update({
        body: normalised.value,
        entry_type: entryType,
        transcript: input.transcript ?? null,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .select(ENTRY_COLUMNS)
      .maybeSingle();

    if (error) {
      return err(new AppError("internal", error.message));
    }
    if (!data) {
      return err(new AppError("not_found", "Diary entry not found."));
    }
    return ok(mapRow(data as DiaryEntryRow));
  },

  async resolveRisk(ctx, input) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .update({
        risk_status: "resolved",
        risk_resolved_at: new Date().toISOString(),
        risk_resolution_note: input.note?.trim() || null,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .eq("entry_type", "risk")
      .select(ENTRY_COLUMNS)
      .maybeSingle();

    if (error) {
      return err(new AppError("internal", error.message));
    }
    if (!data) {
      return err(new AppError("not_found", "Risk entry not found."));
    }
    return ok(mapRow(data as DiaryEntryRow));
  },

  async upsertWeeklySummary(ctx, input) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_weekly_summaries")
      .upsert(
        {
          tenant_id: ctx.tenantId,
          author_user_id: ctx.userId,
          week_start_date: input.weekStartDate,
          key_reflections: input.keyReflections,
          important_decisions: input.importantDecisions,
          notable_risks: input.notableRisks,
          follow_ups_created: input.followUpsCreated,
          recurring_themes: input.recurringThemes,
          next_week_attention: input.nextWeekAttention,
          entry_count: input.entryCount,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,author_user_id,week_start_date" },
      )
      .select(WEEKLY_SUMMARY_COLUMNS)
      .single();

    if (error || !data) {
      return err(new AppError("internal", error?.message ?? "summary_failed"));
    }
    return ok(mapWeeklySummaryRow(data as DiaryWeeklySummaryRow));
  },

  async delete(ctx, id) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .delete()
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("author_user_id", ctx.userId)
      .select("id");

    if (error) {
      return err(new AppError("internal", error.message));
    }
    if (!data || data.length === 0) {
      return err(new AppError("not_found", "Diary entry not found."));
    }
    return ok(undefined);
  },
};
