"use server";

/**
 * Server actions for the Diary surface.
 *
 * Every action re-derives the trusted tenant context server-side via
 * requireTenantContext() — the client never supplies tenant or author. Writes
 * go through diaryService (USER server client, RLS active + author-scoped).
 * Create and delete are recorded to the append-only audit trail.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { diaryService } from "@/modules/diary";
import { auditService } from "@/modules/audit";

import type { DiaryFormState } from "./types";

export async function createEntryAction(
  _prev: DiaryFormState,
  formData: FormData,
): Promise<DiaryFormState> {
  const ctx = await requireTenantContext();
  const body = String(formData.get("body") ?? "");

  const result = await diaryService.create(ctx, { body });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  await auditService.record(ctx, {
    action: "diary.created",
    target: result.value.id,
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

  if (!id) {
    return { ok: false, error: "Missing entry reference." };
  }

  const result = await diaryService.update(ctx, { id, body });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

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
