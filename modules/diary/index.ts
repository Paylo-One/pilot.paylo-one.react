import "server-only";

/**
 * modules/diary — private text + voice journaling with transcription, private
 * by default and linkable by deliberate choice. Diary rows carry author_user_id
 * and are restricted to the author even within a multi-user tenant.
 * Governance: services/diary.md, product/diary.md.
 *
 * MVP scope (this pass): real text-entry CRUD scoped to author + tenant. We use
 * the USER server client so the database RLS policies (diary_author_*) enforce
 * `tenant_id ∈ auth_tenant_ids()` AND `author_user_id = auth.uid()` for every
 * read and write. We still pass the explicit predicates for clarity and defence
 * in depth. Voice notes, transcription, linking and the opt-in Reflection agent
 * are deliberately out of scope here (see services/diary.md "Future").
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

/** A single private diary entry, owned by its author within a tenant. */
export interface DiaryEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly authorUserId: string;
  readonly kind: "text" | "voice";
  readonly body: string | null;
  readonly transcript: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input to create a quick text entry (the only kind in this pass). */
export interface CreateDiaryEntryInput {
  readonly body: string;
}

/** Input to edit the body of an existing entry. */
export interface UpdateDiaryEntryInput {
  readonly id: string;
  readonly body: string;
}

export interface DiaryService {
  /** The signed-in author's entries within the tenant, newest first. */
  list(ctx: TenantContext): Promise<Result<DiaryEntry[]>>;
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
  /** Permanently delete one of the author's own entries. */
  delete(ctx: TenantContext, id: string): Promise<Result<void>>;
}

/** Columns selected for a DiaryEntry projection. */
const ENTRY_COLUMNS =
  "id, tenant_id, author_user_id, kind, body, transcript, created_at, updated_at";

interface DiaryEntryRow {
  id: string;
  tenant_id: string;
  author_user_id: string;
  kind: "text" | "voice";
  body: string | null;
  transcript: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DiaryEntryRow): DiaryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    authorUserId: row.author_user_id,
    kind: row.kind,
    body: row.body,
    transcript: row.transcript,
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

  async create(ctx, input) {
    const normalised = normaliseBody(input.body);
    if (!normalised.ok) return normalised;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .insert({
        tenant_id: ctx.tenantId,
        // Author scoping is non-negotiable: never trust client input here.
        author_user_id: ctx.userId,
        kind: "text",
        body: normalised.value,
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

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .update({ body: normalised.value })
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
