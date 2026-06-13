"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  type NewsPreferencesPatch,
  type NewsProviderView,
  type NewsTenantPreferences,
} from "@/modules/news";
import { runNewsIngestion } from "@/modules/news/ingest";
import { updateNewsPreferences } from "@/modules/news/preferences";
import {
  recordNewsFeedback,
  testNewsProvider,
  updateNewsProviderConfig,
} from "@/modules/news/server";

function revalidateNews(): void {
  revalidatePath("/sources");
  revalidatePath("/sources/news");
  revalidatePath("/briefing");
}

export async function saveNewsPreferencesAction(
  patch: NewsPreferencesPatch,
): Promise<
  | { ok: true; preferences: NewsTenantPreferences }
  | { ok: false; error: string }
> {
  const ctx = await requireTenantContext();
  const result = await updateNewsPreferences(ctx, patch);
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidateNews();
  return { ok: true, preferences: result.value };
}

export async function saveNewsProviderAction(input: {
  providerKey: string;
  enabled?: boolean;
  feedUrls?: string[];
}): Promise<
  | { ok: true; providers: NewsProviderView[] }
  | { ok: false; error: string }
> {
  const ctx = await requireTenantContext();
  const result = await updateNewsProviderConfig(ctx, input);
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidateNews();
  return { ok: true, providers: result.value };
}

export async function testNewsProviderAction(input: {
  providerKey: string;
}): Promise<
  | { ok: true; reachable: boolean; detail: string }
  | { ok: false; error: string }
> {
  const ctx = await requireTenantContext();
  const result = await testNewsProvider(ctx, input.providerKey);
  if (!result.ok) return { ok: false, error: result.error.message };
  return {
    ok: true,
    reachable: result.value.ok,
    detail: result.value.detail,
  };
}

export async function runNewsIngestionAction(): Promise<
  | {
      ok: true;
      fetched: number;
      deduped: number;
      stored: number;
      candidates: number;
      providerErrors: { provider: string; error: string }[];
    }
  | { ok: false; error: string }
> {
  const ctx = await requireTenantContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { ok: false, error: "Only workspace owners and admins can fetch News." };
  }
  try {
    const result = await runNewsIngestion(ctx.tenantId);
    revalidateNews();
    return { ok: true, ...result };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "News ingestion failed.",
    };
  }
}

export async function submitNewsFeedbackAction(input: {
  newsItemId: string;
  signal:
    | "more_like_this"
    | "less_like_this"
    | "hide_source"
    | "follow_topic"
    | "unfollow_topic"
    | "important"
    | "not_relevant";
  topic?: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await requireTenantContext();
  const result = await recordNewsFeedback(ctx, input);
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidateNews();
  return { ok: true, error: null };
}
