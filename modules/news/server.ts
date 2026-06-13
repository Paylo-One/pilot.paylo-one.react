import "server-only";

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";
import {
  ValidationError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import {
  type NewsAdminData,
  type NewsCategory,
  type NewsConfigAuditView,
  type NewsFeedbackSignal,
  type NewsIngestionRunView,
  type NewsItemDetail,
  type NewsItemView,
  type NewsProviderView,
} from "./index";
import { getNewsPreferences } from "./preferences";
import { getNewsProvider, implementedProviders } from "./providers";
import {
  NewsFeedbackSchema,
  NewsProviderConfigSchema,
} from "./validation";

interface ProviderRow {
  provider_key: string;
  name: string;
  tier: "production" | "development";
  enabled: boolean;
  capabilities: Record<string, boolean>;
  docs_url: string | null;
}

interface ProviderConfigRow {
  provider_key: string;
  enabled: boolean;
  feed_urls: string[];
  updated_at: string;
}

export interface TenantProviderRuntime {
  readonly key: string;
  readonly enabled: boolean;
  readonly feedUrls: readonly string[];
}

function canManage(ctx: TenantContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

/** List provider catalogue rows merged with this tenant's overrides. */
export async function listNewsProviders(
  ctx: TenantContext,
): Promise<NewsProviderView[]> {
  const supabase = await createSupabaseServerClient();
  const [providersResult, configsResult] = await Promise.all([
    supabase
      .from("news_provider")
      .select("provider_key, name, tier, enabled, capabilities, docs_url")
      .order("name"),
    supabase
      .from("news_source_config")
      .select("provider_key, enabled, feed_urls, updated_at")
      .eq("tenant_id", ctx.tenantId),
  ]);
  if (providersResult.error) throw new Error(providersResult.error.message);
  if (configsResult.error) throw new Error(configsResult.error.message);

  const configs = new Map(
    ((configsResult.data ?? []) as ProviderConfigRow[]).map((row) => [
      row.provider_key,
      row,
    ]),
  );
  const implemented = new Set(implementedProviders().map((provider) => provider.key));

  return ((providersResult.data ?? []) as ProviderRow[]).map((row) => {
    const config = configs.get(row.provider_key);
    const available = row.enabled && implemented.has(row.provider_key);
    return {
      key: row.provider_key,
      name: row.name,
      tier: row.tier,
      platformEnabled: row.enabled,
      implemented: implemented.has(row.provider_key),
      enabled: available && (config?.enabled ?? true),
      capabilities: {
        byCategory: Boolean(row.capabilities.byCategory),
        byKeyword: Boolean(row.capabilities.byKeyword),
        byRegion: Boolean(row.capabilities.byRegion),
        bySource: Boolean(row.capabilities.bySource),
      },
      docsUrl: row.docs_url,
      feedUrls: config?.feed_urls ?? [],
      updatedAt: config?.updated_at ?? null,
    };
  });
}

/** Secret-client equivalent used by background ingestion. */
export async function listTenantProviderRuntimes(
  tenantId: string,
): Promise<TenantProviderRuntime[]> {
  const secret = createSupabaseSecretClient();
  const [providersResult, configsResult] = await Promise.all([
    secret
      .from("news_provider")
      .select("provider_key, enabled, tier")
      .eq("enabled", true)
      .eq("tier", "production"),
    secret
      .from("news_source_config")
      .select("provider_key, enabled, feed_urls")
      .eq("tenant_id", tenantId),
  ]);
  if (providersResult.error) throw new Error(providersResult.error.message);
  if (configsResult.error) throw new Error(configsResult.error.message);

  const configs = new Map(
    ((configsResult.data ?? []) as Omit<ProviderConfigRow, "updated_at">[]).map(
      (row) => [row.provider_key, row],
    ),
  );
  const implemented = new Set(implementedProviders().map((provider) => provider.key));

  return (providersResult.data ?? [])
    .filter((row) => implemented.has(row.provider_key as string))
    .map((row) => {
      const key = row.provider_key as string;
      const config = configs.get(key);
      return {
        key,
        enabled: config?.enabled ?? true,
        feedUrls: config?.feed_urls ?? [],
      };
    });
}

export async function updateNewsProviderConfig(
  ctx: TenantContext,
  input: unknown,
): Promise<Result<NewsProviderView[]>> {
  if (!canManage(ctx)) {
    return err(new ValidationError("Only workspace owners and admins can configure News."));
  }
  const parsed = NewsProviderConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(new ValidationError("Invalid provider configuration."));
  }
  const secret = createSupabaseSecretClient();
  const { data: provider, error: providerError } = await secret
    .from("news_provider")
    .select("provider_key, enabled")
    .eq("provider_key", parsed.data.providerKey)
    .maybeSingle();
  if (providerError) return err(new ValidationError(providerError.message));
  if (!provider) return err(new ValidationError("Unknown news provider."));

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    provider_key: parsed.data.providerKey,
    updated_by: ctx.userId,
  };
  if (parsed.data.enabled !== undefined) row.enabled = parsed.data.enabled;
  if (parsed.data.feedUrls !== undefined) row.feed_urls = parsed.data.feedUrls;

  const { data: existing } = await secret
    .from("news_source_config")
    .select("provider_key, enabled, feed_urls")
    .eq("tenant_id", ctx.tenantId)
    .eq("provider_key", parsed.data.providerKey)
    .maybeSingle();
  if (!existing) row.created_by = ctx.userId;

  const { error } = await secret
    .from("news_source_config")
    .upsert(row, { onConflict: "tenant_id,provider_key" });
  if (error) return err(new ValidationError(error.message));

  const auditRows: Record<string, unknown>[] = [];
  if (
    parsed.data.enabled !== undefined &&
    parsed.data.enabled !== (existing?.enabled ?? true)
  ) {
    auditRows.push({
      tenant_id: ctx.tenantId,
      actor_user_id: ctx.userId,
      field: `provider.${parsed.data.providerKey}.enabled`,
      previous_value: existing?.enabled ?? true,
      new_value: parsed.data.enabled,
    });
  }
  if (
    parsed.data.feedUrls !== undefined &&
    JSON.stringify(parsed.data.feedUrls) !==
      JSON.stringify(existing?.feed_urls ?? [])
  ) {
    auditRows.push({
      tenant_id: ctx.tenantId,
      actor_user_id: ctx.userId,
      field: `provider.${parsed.data.providerKey}.feed_urls`,
      previous_value: existing?.feed_urls ?? [],
      new_value: parsed.data.feedUrls,
    });
  }
  if (auditRows.length > 0) {
    const { error: auditError } = await secret
      .from("news_config_audit")
      .insert(auditRows);
    if (auditError) return err(new ValidationError(auditError.message));
  }

  await auditService.record(ctx, {
    action: "news.provider.updated",
    target: parsed.data.providerKey,
    metadata: {
      enabled: parsed.data.enabled,
      feedCount: parsed.data.feedUrls?.length,
    },
  });
  return ok(await listNewsProviders(ctx));
}

export async function testNewsProvider(
  ctx: TenantContext,
  providerKey: string,
): Promise<Result<{ ok: boolean; detail: string }>> {
  if (!canManage(ctx)) {
    return err(new ValidationError("Only workspace owners and admins can test providers."));
  }
  const adapter = getNewsProvider(providerKey);
  if (!adapter) return err(new ValidationError("This provider is not implemented yet."));
  const runtimes = await listTenantProviderRuntimes(ctx.tenantId);
  const runtime = runtimes.find((entry) => entry.key === providerKey);
  return ok(await adapter.test({ feedUrls: runtime?.feedUrls ?? [] }));
}

interface ItemRow {
  id: string;
  provider_key: string;
  title: string;
  snippet: string | null;
  canonical_url: string;
  source_name: string;
  language: string | null;
  published_at: string | null;
  fetched_at: string;
}

interface ClassificationRow {
  news_item_id: string;
  category: NewsCategory | null;
  country: string | null;
  urgency: string | null;
  risk_level: string | null;
  sentiment: string | null;
  confidence: number | null;
  topic_tags: string[];
}

interface BriefingItemRow {
  id: string;
  news_item_id: string;
  relevance_score: number;
  rank_reason: Record<string, unknown>;
  status: "candidate" | "shown" | "suppressed";
}

function mapItems(
  items: ItemRow[],
  classifications: ClassificationRow[],
  ranked: BriefingItemRow[],
): NewsItemView[] {
  const classificationById = new Map(
    classifications.map((row) => [row.news_item_id, row]),
  );
  const rankedById = new Map(ranked.map((row) => [row.news_item_id, row]));
  return items.map((item) => {
    const classification = classificationById.get(item.id);
    const candidate = rankedById.get(item.id);
    return {
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      canonicalUrl: item.canonical_url,
      sourceName: item.source_name,
      providerKey: item.provider_key,
      publishedAt: item.published_at,
      fetchedAt: item.fetched_at,
      category: classification?.category ?? null,
      country: classification?.country ?? null,
      topicTags: classification?.topic_tags ?? [],
      relevanceScore: candidate ? Number(candidate.relevance_score) : null,
      rankReason: candidate?.rank_reason ?? null,
      status: candidate?.status ?? null,
    };
  });
}

export async function listNewsItems(
  ctx: TenantContext,
  limit = 30,
): Promise<NewsItemView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("news_item")
    .select(
      "id, provider_key, title, snippet, canonical_url, source_name, language, published_at, fetched_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(error.message);
  const items = (data ?? []) as ItemRow[];
  const ids = items.map((item) => item.id);
  if (ids.length === 0) return [];

  const [classificationsResult, rankedResult] = await Promise.all([
    supabase
      .from("news_item_classification")
      .select(
        "news_item_id, category, country, urgency, risk_level, sentiment, confidence, topic_tags",
      )
      .eq("tenant_id", ctx.tenantId)
      .in("news_item_id", ids),
    supabase
      .from("news_briefing_item")
      .select("id, news_item_id, relevance_score, rank_reason, status")
      .eq("tenant_id", ctx.tenantId)
      .in("news_item_id", ids),
  ]);
  if (classificationsResult.error) {
    throw new Error(classificationsResult.error.message);
  }
  if (rankedResult.error) throw new Error(rankedResult.error.message);
  return mapItems(
    items,
    (classificationsResult.data ?? []) as ClassificationRow[],
    (rankedResult.data ?? []) as BriefingItemRow[],
  );
}

export async function getNewsItem(
  ctx: TenantContext,
  id: string,
): Promise<NewsItemDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [itemResult, classificationResult, rankedResult, entitiesResult] =
    await Promise.all([
    supabase
      .from("news_item")
      .select(
        "id, provider_key, title, snippet, canonical_url, source_name, language, published_at, fetched_at",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("news_item_classification")
      .select(
        "category, country, urgency, risk_level, sentiment, confidence, topic_tags",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("news_item_id", id)
      .maybeSingle(),
    supabase
      .from("news_briefing_item")
      .select("id, relevance_score, rank_reason, status")
      .eq("tenant_id", ctx.tenantId)
      .eq("news_item_id", id)
      .maybeSingle(),
    supabase
      .from("news_item_entity")
      .select("entity_type, value, matched_monitor, confidence")
      .eq("tenant_id", ctx.tenantId)
      .eq("news_item_id", id),
  ]);
  if (itemResult.error) throw new Error(itemResult.error.message);
  if (!itemResult.data) return null;
  if (classificationResult.error) throw new Error(classificationResult.error.message);
  if (rankedResult.error) throw new Error(rankedResult.error.message);
  if (entitiesResult.error) throw new Error(entitiesResult.error.message);

  const item = itemResult.data;
  const classification = classificationResult.data;
  const ranked = rankedResult.data;
  return {
    id: item.id as string,
    title: item.title as string,
    snippet: (item.snippet as string | null) ?? null,
    canonicalUrl: item.canonical_url as string,
    sourceName: item.source_name as string,
    providerKey: item.provider_key as string,
    publishedAt: (item.published_at as string | null) ?? null,
    fetchedAt: item.fetched_at as string,
    category: (classification?.category as NewsCategory | null) ?? null,
    country: (classification?.country as string | null) ?? null,
    topicTags: (classification?.topic_tags as string[] | null) ?? [],
    relevanceScore:
      ranked?.relevance_score === null || ranked?.relevance_score === undefined
        ? null
        : Number(ranked.relevance_score),
    rankReason:
      (ranked?.rank_reason as Record<string, unknown> | null) ?? null,
    status:
      (ranked?.status as "candidate" | "shown" | "suppressed" | null) ?? null,
    language: (item.language as string | null) ?? null,
    urgency: (classification?.urgency as string | null) ?? null,
    riskLevel: (classification?.risk_level as string | null) ?? null,
    sentiment: (classification?.sentiment as string | null) ?? null,
    confidence:
      classification?.confidence === null ||
      classification?.confidence === undefined
        ? null
        : Number(classification.confidence),
    entities: (entitiesResult.data ?? []).map((row) => ({
      type: row.entity_type as "company" | "person" | "topic" | "place",
      value: row.value as string,
      matchedMonitor: Boolean(row.matched_monitor),
      confidence: Number(row.confidence),
    })),
  };
}

export async function listNewsAudit(
  ctx: TenantContext,
  limit = 20,
): Promise<NewsConfigAuditView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("news_config_audit")
    .select("id, actor_user_id, field, previous_value, new_value, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    actorUserId: (row.actor_user_id as string | null) ?? null,
    field: row.field as string,
    previousValue: row.previous_value,
    newValue: row.new_value,
    createdAt: row.created_at as string,
  }));
}

export async function getLatestNewsIngestionRun(
  ctx: TenantContext,
): Promise<NewsIngestionRunView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("news_ingestion_run")
    .select(
      "id, status, fetched_count, deduped_count, stored_count, candidate_count, provider_errors, error_message, started_at, completed_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as NewsIngestionRunView["status"],
    fetched: Number(data.fetched_count),
    deduped: Number(data.deduped_count),
    stored: Number(data.stored_count),
    candidates: Number(data.candidate_count),
    providerErrors: (data.provider_errors ??
      []) as { provider: string; error: string }[],
    errorMessage: (data.error_message as string | null) ?? null,
    startedAt: data.started_at as string,
    completedAt: (data.completed_at as string | null) ?? null,
  };
}

export interface NewsFeedbackProfile {
  readonly sourceWeights: ReadonlyMap<string, number>;
  readonly topicWeights: ReadonlyMap<string, number>;
}

/** Aggregate prior feedback into bounded source/topic rank adjustments. */
export async function getNewsFeedbackProfileByTenant(
  tenantId: string,
): Promise<NewsFeedbackProfile> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("news_feedback")
    .select("source_name, topic, signal")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const sourceWeights = new Map<string, number>();
  const topicWeights = new Map<string, number>();
  const delta: Record<NewsFeedbackSignal, number> = {
    more_like_this: 0.05,
    less_like_this: -0.05,
    hide_source: -1,
    follow_topic: 0.1,
    unfollow_topic: -0.1,
    important: 0.08,
    not_relevant: -0.12,
  };
  const add = (map: Map<string, number>, key: string, amount: number) => {
    const next = Math.max(-1, Math.min(0.25, (map.get(key) ?? 0) + amount));
    map.set(key, next);
  };
  for (const row of data ?? []) {
    const amount = delta[row.signal as NewsFeedbackSignal] ?? 0;
    if (row.source_name) add(sourceWeights, String(row.source_name).toLowerCase(), amount);
    if (row.topic) add(topicWeights, String(row.topic).toLowerCase(), amount);
  }
  return { sourceWeights, topicWeights };
}

export async function recordNewsFeedback(
  ctx: TenantContext,
  input: unknown,
): Promise<Result<void>> {
  const parsed = NewsFeedbackSchema.safeParse(input);
  if (!parsed.success) return err(new ValidationError("Invalid News feedback."));

  const secret = createSupabaseSecretClient();
  const [itemResult, classificationResult] = await Promise.all([
    secret
      .from("news_item")
      .select("id, source_name")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", parsed.data.newsItemId)
      .maybeSingle(),
    secret
      .from("news_item_classification")
      .select("category")
      .eq("tenant_id", ctx.tenantId)
      .eq("news_item_id", parsed.data.newsItemId)
      .maybeSingle(),
  ]);
  if (itemResult.error) return err(new ValidationError(itemResult.error.message));
  if (!itemResult.data) return err(new ValidationError("News item not found."));
  const sourceName = itemResult.data.source_name as string;
  const topic =
    parsed.data.topic ??
    ((classificationResult.data?.category as string | null) ?? undefined);

  const { error: insertError } = await secret.from("news_feedback").insert({
    tenant_id: ctx.tenantId,
    news_item_id: parsed.data.newsItemId,
    source_name: sourceName,
    topic: topic ?? null,
    signal: parsed.data.signal,
    created_by: ctx.userId,
  });
  if (insertError) return err(new ValidationError(insertError.message));

  // Immediate item effect; aggregate feedback also influences future ingestion.
  const { data: candidate } = await secret
    .from("news_briefing_item")
    .select("id, relevance_score")
    .eq("tenant_id", ctx.tenantId)
    .eq("news_item_id", parsed.data.newsItemId)
    .maybeSingle();
  if (candidate) {
    const current = Number(candidate.relevance_score);
    const scoreDelta =
      parsed.data.signal === "important" || parsed.data.signal === "more_like_this"
        ? 0.1
        : parsed.data.signal === "less_like_this" ||
            parsed.data.signal === "not_relevant"
          ? -0.15
          : 0;
    const candidatePatch: Record<string, unknown> = {
      relevance_score: Math.max(0, Math.min(1, current + scoreDelta)),
    };
    if (
      parsed.data.signal === "not_relevant" ||
      parsed.data.signal === "hide_source"
    ) {
      candidatePatch.status = "suppressed";
    }
    await secret
      .from("news_briefing_item")
      .update(candidatePatch)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", candidate.id);
  }

  // Explicit source/topic commands also update the durable tenant preferences.
  if (
    parsed.data.signal === "hide_source" ||
    parsed.data.signal === "follow_topic" ||
    parsed.data.signal === "unfollow_topic"
  ) {
    const prefs = await getNewsPreferences(ctx);
    const patch: Record<string, unknown> = {
      tenant_id: ctx.tenantId,
      updated_by: ctx.userId,
    };
    const auditRows: Record<string, unknown>[] = [];
    if (parsed.data.signal === "hide_source") {
      const next = [...new Set([...prefs.blockedSources, sourceName])];
      patch.blocked_sources = next;
      auditRows.push({
        tenant_id: ctx.tenantId,
        actor_user_id: ctx.userId,
        field: "blocked_sources",
        previous_value: prefs.blockedSources,
        new_value: next,
      });
      const { data: sourceItems } = await secret
        .from("news_item")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("source_name", sourceName);
      const sourceIds = (sourceItems ?? []).map((row) => row.id as string);
      if (sourceIds.length > 0) {
        await secret
          .from("news_briefing_item")
          .update({ status: "suppressed" })
          .eq("tenant_id", ctx.tenantId)
          .in("news_item_id", sourceIds);
      }
    } else if (topic) {
      const next =
        parsed.data.signal === "follow_topic"
          ? [...new Set([...prefs.keywords, topic])]
          : prefs.keywords.filter(
              (keyword) => keyword.toLowerCase() !== topic.toLowerCase(),
            );
      patch.keywords = next;
      auditRows.push({
        tenant_id: ctx.tenantId,
        actor_user_id: ctx.userId,
        field: "keywords",
        previous_value: prefs.keywords,
        new_value: next,
      });
    }
    const { error: prefsError } = await secret
      .from("news_tenant_preferences")
      .upsert(patch, { onConflict: "tenant_id" });
    if (prefsError) return err(new ValidationError(prefsError.message));
    if (auditRows.length > 0) {
      await secret.from("news_config_audit").insert(auditRows);
    }
  }

  await auditService.record(ctx, {
    action: "news.feedback.recorded",
    target: parsed.data.newsItemId,
    metadata: { signal: parsed.data.signal, sourceName, topic: topic ?? null },
  });
  return ok(undefined);
}

export async function getNewsAdminData(
  ctx: TenantContext,
): Promise<NewsAdminData> {
  const [preferences, providers, recentItems, recentAudit, latestRun] =
    await Promise.all([
      getNewsPreferences(ctx),
      listNewsProviders(ctx),
      listNewsItems(ctx, 20),
      listNewsAudit(ctx, 12),
      getLatestNewsIngestionRun(ctx),
    ]);
  return { preferences, providers, recentItems, recentAudit, latestRun };
}

/** Enabled tenant ids for the scheduled/manual internal ingestion endpoint. */
export async function listEnabledNewsTenantIds(limit = 100): Promise<string[]> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("news_tenant_preferences")
    .select("tenant_id")
    .eq("enabled", true)
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.tenant_id as string);
}
