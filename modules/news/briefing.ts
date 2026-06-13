import "server-only";

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/modules/shared";
import {
  NEWS_CATEGORY_LABELS,
  type ExternalSignalView,
  type NewsCategory,
  type NewsTenantPreferences,
} from "./index";
import {
  getNewsPreferences,
  getNewsPreferencesByTenant,
} from "./preferences";

interface CandidateRow {
  id: string;
  news_item_id: string;
  relevance_score: number;
  rank_reason: Record<string, unknown>;
  category: NewsCategory | null;
}

interface NewsRow {
  id: string;
  title: string;
  snippet: string | null;
  canonical_url: string;
  source_name: string;
  published_at: string | null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function whyItMatters(candidate: CandidateRow): string {
  const reason = candidate.rank_reason ?? {};
  const companies = stringArray(reason.matchedCompanies);
  const people = stringArray(reason.matchedPeople);
  const keywords = stringArray(reason.keywordHits);
  if (companies.length > 0) {
    return `Mentions ${companies.slice(0, 2).join(" and ")}, on your company monitoring list.`;
  }
  if (people.length > 0) {
    return `Mentions ${people.slice(0, 2).join(" and ")}, on your people monitoring list.`;
  }
  if (keywords.length > 0) {
    return `Matches your tracked topic${keywords.length === 1 ? "" : "s"}: ${keywords.slice(0, 3).join(", ")}.`;
  }
  if (candidate.category) {
    return `Matches your ${NEWS_CATEGORY_LABELS[candidate.category].toLowerCase()} briefing preferences.`;
  }
  return "Recent, credible external context above your relevance threshold.";
}

function mapSignals(
  candidates: CandidateRow[],
  items: NewsRow[],
): ExternalSignalView[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return candidates.flatMap((candidate) => {
    const item = itemById.get(candidate.news_item_id);
    if (!item) return [];
    return [
      {
        briefingItemId: candidate.id,
        newsItemId: item.id,
        headline: item.title,
        summary: item.snippet,
        whyItMatters: whyItMatters(candidate),
        sourceName: item.source_name,
        canonicalUrl: item.canonical_url,
        publishedAt: item.published_at,
        category: candidate.category,
        relevanceScore: Number(candidate.relevance_score),
      },
    ];
  });
}

async function userSignals(
  ctx: TenantContext,
  prefs: NewsTenantPreferences,
  briefingId?: string,
): Promise<ExternalSignalView[]> {
  if (!briefingId && (!prefs.enabled || !prefs.briefingEnabled)) return [];
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("news_briefing_item")
    .select("id, news_item_id, relevance_score, rank_reason, category")
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "suppressed")
    .order("relevance_score", { ascending: false })
    .limit(briefingId ? 25 : prefs.maxItemsPerBriefing);
  query = briefingId
    ? query.eq("included_in_briefing_id", briefingId)
    : query
        .eq("status", "candidate")
        .gte("relevance_score", prefs.minRelevanceScore);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const candidates = (data ?? []) as CandidateRow[];
  const itemIds = candidates.map((candidate) => candidate.news_item_id);
  if (itemIds.length === 0) return [];
  const { data: itemData, error: itemError } = await supabase
    .from("news_item")
    .select("id, title, snippet, canonical_url, source_name, published_at")
    .eq("tenant_id", ctx.tenantId)
    .in("id", itemIds);
  if (itemError) throw new Error(itemError.message);
  return mapSignals(candidates, (itemData ?? []) as NewsRow[]);
}

/** Preview currently eligible, not-yet-shown external signals. */
export async function buildExternalSignals(
  ctx: TenantContext,
): Promise<ExternalSignalView[]> {
  return userSignals(ctx, await getNewsPreferences(ctx));
}

/** Resolve the external signals attached to a specific persisted briefing. */
export async function getBriefingExternalSignals(
  ctx: TenantContext,
  briefingId: string,
): Promise<ExternalSignalView[]> {
  return userSignals(ctx, await getNewsPreferences(ctx), briefingId);
}

/**
 * Attach the top eligible candidates to a briefing and create provenance rows.
 * Called after the core memo is persisted. The caller deliberately catches
 * errors so News cannot break the main briefing.
 */
export async function appendExternalSignalsToBriefing(
  tenantId: string,
  briefingId: string,
  position: number,
): Promise<number> {
  const prefs = await getNewsPreferencesByTenant(tenantId);
  if (!prefs.enabled || !prefs.briefingEnabled) return 0;

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("news_briefing_item")
    .select("id, news_item_id, relevance_score, rank_reason, category")
    .eq("tenant_id", tenantId)
    .eq("status", "candidate")
    .gte("relevance_score", prefs.minRelevanceScore)
    .order("relevance_score", { ascending: false })
    .limit(prefs.maxItemsPerBriefing);
  if (error) throw new Error(error.message);
  const candidates = (data ?? []) as CandidateRow[];
  if (candidates.length === 0) return 0;

  const itemIds = candidates.map((candidate) => candidate.news_item_id);
  const { data: itemData, error: itemError } = await secret
    .from("news_item")
    .select("id, title, snippet, canonical_url, source_name, published_at")
    .eq("tenant_id", tenantId)
    .in("id", itemIds);
  if (itemError) throw new Error(itemError.message);
  const items = (itemData ?? []) as NewsRow[];
  const signals = mapSignals(candidates, items);
  if (signals.length === 0) return 0;

  const { data: section, error: sectionError } = await secret
    .from("briefing_sections")
    .insert({
      tenant_id: tenantId,
      briefing_id: briefingId,
      kind: "external_signals",
      position,
      title: "External Signals",
      body: `${signals.length} relevant external signal${signals.length === 1 ? "" : "s"} matched your News preferences.`,
    })
    .select("id")
    .single();
  if (sectionError || !section) {
    throw new Error(sectionError?.message ?? "external_signals_section_failed");
  }

  const references = signals.map((signal) => ({
    tenant_id: tenantId,
    briefing_section_id: section.id as string,
    news_item_id: signal.newsItemId,
    source_system: "news",
    item_timestamp: signal.publishedAt,
    confidence: signal.relevanceScore,
    excerpt_or_pointer: signal.canonicalUrl,
  }));
  const { error: referenceError } = await secret
    .from("source_references")
    .insert(references);
  if (referenceError) throw new Error(referenceError.message);

  const { error: updateError } = await secret
    .from("news_briefing_item")
    .update({
      status: "shown",
      shown_at: new Date().toISOString(),
      included_in_briefing_id: briefingId,
    })
    .eq("tenant_id", tenantId)
    .in(
      "id",
      candidates.map((candidate) => candidate.id),
    );
  if (updateError) throw new Error(updateError.message);
  return signals.length;
}
