"use server";

/**
 * Sources server actions. Mutations re-derive the trusted tenant context
 * server-side (never from client input) and delegate to the ingestion module.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { ingestPastedText } from "@/modules/ingestion/server";

export interface UploadResult {
  readonly ok: boolean;
  readonly message: string;
}

const ALLOWED_FILE = /\.(txt|md|markdown|text)$/i;

/**
 * Ingest a pasted note or an uploaded .txt/.md file as a file_upload source
 * item. Used with `useActionState` from the upload form.
 */
export async function uploadNoteAction(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const ctx = await requireTenantContext();

  const title = (formData.get("title") as string | null)?.trim() || null;
  let body = (formData.get("body") as string | null)?.trim() ?? "";

  const file = formData.get("file");
  if (body.length === 0 && file instanceof File && file.size > 0) {
    if (!ALLOWED_FILE.test(file.name)) {
      return { ok: false, message: "Only .txt or .md files are supported." };
    }
    if (file.size > 1_000_000) {
      return { ok: false, message: "File is too large (1 MB maximum)." };
    }
    body = (await file.text()).trim();
  }

  if (body.length === 0) {
    return { ok: false, message: "Paste some text or attach a .txt/.md file." };
  }

  try {
    await ingestPastedText(ctx, { title, body });
    revalidatePath("/sources");
    return { ok: true, message: "Saved to your workspace." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Upload failed.",
    };
  }
}
