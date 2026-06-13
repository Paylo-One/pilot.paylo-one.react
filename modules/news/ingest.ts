import "server-only";

/**
 * Tenant news ingestion:
 * fetch -> normalise -> deduplicate -> classify -> rank -> store -> candidate.
 *
 * Provider failures are isolated and persisted on news_ingestion_run. Database
 * failures still fail the run because silently losing tenant data is worse than
 * an honest failed status.
 */

import { createHash } from "node:crypto";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  CATEGORY_KEYWORDS,
  NEWS_CATEGORY_ORDER,
  type NewsCategory,
  type NewsFetchQuery,
  type NewsTenantPreferences,
  type NormalisedNewsItem,
} from "./index";
import { getNewsProvider } from "./providers";
import { getNewsPreferencesByTenant } from "./preferences";
import {
  getNewsFeedbackProfileByTenant,
  listTenantProviderRuntimes,
  type NewsFeedbackProfile,
} from "./server";

export interface IngestionRunResult {
  fetched: number;
  deduped: number;
  stored: number;
  candidates: number;
  providerErrors: { provider: string; error: string }[];
}

interface ExistingStory {
  readonly url_hash: string;
  readonly story_fingerprint: string | null;
  readonly title: string;
  readonly source_name: string;
  readonly published_at: string | null;
}

interface Classification {
  readonly category: NewsCategory | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly topicTags: string[];
  readonly matchedCompanies: string[];
  readonly matchedPeople: string[];
  readonly urgency: "now" | "today" | "this_week" | "none";
  readonly riskLevel: "high" | "medium" | "low" | "none";
  readonly sentiment: "positive" | "neutral" | "negative";
  readonly confidence: number;
}

interface RankResult {
  readonly score: number;
  readonly reason: Record<string, unknown>;
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const SOURCE_CREDIBILITY: Record<string, number> = {
  "reuters.com": 0.1,
  "ft.com": 0.1,
  "bbc.co.uk": 0.09,
  "bloomberg.com": 0.09,
  "theguardian.com": 0.08,
  "wsj.com": 0.09,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normaliseNewsUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const query = url.searchParams.toString();
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${path.toLowerCase()}${query ? `?${query}` : ""}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normaliseNewsTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function titleTokens(value: string): Set<string> {
  return new Set(normaliseNewsTitle(value).split(" ").filter(Boolean));
}

export function titleSimilarity(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function storyFingerprint(title: string): string {
  return hash([...titleTokens(title)].toSorted().join(" "));
}

function samePublishedWindow(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const delta = Math.abs(Date.parse(a) - Date.parse(b));
  return !Number.isNaN(delta) && delta <= 6 * 60 * 60 * 1000;
}

function isDuplicate(
  item: NormalisedNewsItem,
  urlHash: string,
  fingerprint: string,
  stories: readonly ExistingStory[],
): boolean {
  return stories.some((story) => {
    if (story.url_hash === urlHash) return true;
    if (story.story_fingerprint === fingerprint) return true;
    const similarity = titleSimilarity(item.title, story.title);
    if (similarity >= 0.84) return true;
    return (
      similarity >= 0.72 &&
      item.sourceName.toLowerCase() === story.source_name.toLowerCase() &&
      samePublishedWindow(item.publishedAt, story.published_at)
    );
  });
}

function itemText(item: NormalisedNewsItem): string {
  return `${item.title} ${item.snippet ?? ""}`.toLowerCase();
}

function credibility(sourceName: string): number {
  const source = sourceName.toLowerCase();
  const key = Object.keys(SOURCE_CREDIBILITY).find((host) => source.includes(host));
  return key ? SOURCE_CREDIBILITY[key]! : 0.03;
}

function recencyBoost(publishedAt: string | null): number {
  if (!publishedAt) return 0;
  const ageHours = (Date.now() - Date.parse(publishedAt)) / 3_600_000;
  if (Number.isNaN(ageHours) || ageHours < -1) return 0;
  if (ageHours <= 12) return 0.15;
  if (ageHours <= 36) return 0.1;
  if (ageHours <= 72) return 0.05;
  return 0;
}

function activeCategories(prefs: NewsTenantPreferences): readonly NewsCategory[] {
  const selected = new Set(prefs.categories);
  if (prefs.includeGlobalHeadlines) selected.add("world_geopolitics");
  if (prefs.includeMarketNews) selected.add("markets_macro");
  if (prefs.includeRegulatoryNews) selected.add("regulatory_compliance");
  if (prefs.includeAiNews) selected.add("ai_technology");
  return selected.size > 0 ? [...selected] : NEWS_CATEGORY_ORDER;
}

export function classifyNewsItem(
  item: NormalisedNewsItem,
  prefs: NewsTenantPreferences,
): Classification {
  const text = itemText(item);
  const candidates = activeCategories(prefs);
  let best: { category: NewsCategory; hits: number } | null = null;
  const topicTags: string[] = [];

  for (const category of candidates) {
    const matches = CATEGORY_KEYWORDS[category].filter((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    if (matches.length > 0) {
      topicTags.push(...matches.map((match) => match.toLowerCase()));
      if (!best || matches.length > best.hits) {
        best = { category, hits: matches.length };
      }
    }
  }

  const matchedCompanies = prefs.companiesToMonitor.filter(
    (company) => company && text.includes(company.toLowerCase()),
  );
  const matchedPeople = prefs.peopleToMonitor.filter(
    (person) => person && text.includes(person.toLowerCase()),
  );
  const country =
    item.country ??
    prefs.countries.find((entry) => text.includes(entry.toLowerCase())) ??
    null;
  const region =
    prefs.regions.find((entry) => text.includes(entry.toLowerCase())) ?? null;

  const highRisk = /war|invasion|default|bankruptcy|breach|fraud|sanction|ban\b/.test(
    text,
  );
  const mediumRisk =
    highRisk ||
    best?.category === "regulatory_compliance" ||
    /lawsuit|investigation|fine|layoff|outage/.test(text);
  const riskLevel: Classification["riskLevel"] = highRisk
    ? "high"
    : mediumRisk
      ? "medium"
      : "none";

  const urgency: Classification["urgency"] =
    recencyBoost(item.publishedAt) >= 0.1 &&
    matchedCompanies.length + matchedPeople.length > 0
      ? "today"
      : recencyBoost(item.publishedAt) > 0
        ? "this_week"
        : "none";
  const positive = /growth|approval|launch|partnership|funding|record high/.test(text);
  const negative = /decline|loss|fraud|breach|ban|sanction|layoff|crisis/.test(text);
  const sentiment: Classification["sentiment"] =
    positive === negative ? "neutral" : positive ? "positive" : "negative";

  const signals =
    topicTags.length + matchedCompanies.length * 2 + matchedPeople.length * 2;
  return {
    category: item.category ?? best?.category ?? null,
    region,
    country,
    topicTags: [...new Set(topicTags)],
    matchedCompanies,
    matchedPeople,
    urgency,
    riskLevel,
    sentiment,
    confidence: Math.min(1, 0.3 + signals * 0.15),
  };
}

export function rankNewsItem(
  item: NormalisedNewsItem,
  classification: Classification,
  prefs: NewsTenantPreferences,
  feedback: NewsFeedbackProfile,
  contextTerms: ReadonlySet<string> = new Set(),
): RankResult {
  const text = itemText(item);
  const factors: Record<string, number> = { base: 0.15 };
  if (
    classification.category &&
    activeCategories(prefs).includes(classification.category)
  ) {
    factors.category = 0.15;
  }

  const keywordHits = prefs.keywords.filter(
    (keyword) => keyword && text.includes(keyword.toLowerCase()),
  );
  if (keywordHits.length > 0) {
    factors.keywords = Math.min(0.3, keywordHits.length * 0.1);
  }
  if (classification.matchedCompanies.length > 0) factors.company = 0.25;
  if (classification.matchedPeople.length > 0) factors.person = 0.25;
  const contextHits = [...contextTerms].filter((term) => text.includes(term));
  if (contextHits.length > 0) {
    factors.workspaceContext = Math.min(0.1, contextHits.length * 0.025);
  }
  factors.credibility = credibility(`${item.sourceName} ${item.canonicalUrl}`);
  const recency = recencyBoost(item.publishedAt);
  if (recency > 0) factors.recency = recency;

  const sourceFeedback =
    feedback.sourceWeights.get(item.sourceName.toLowerCase()) ?? 0;
  const topicFeedback = [
    ...classification.topicTags.map(
      (topic) => feedback.topicWeights.get(topic.toLowerCase()) ?? 0,
    ),
    classification.category
      ? feedback.topicWeights.get(classification.category.toLowerCase()) ?? 0
      : 0,
  ].reduce(
    (strongest, value) =>
      Math.abs(value) > Math.abs(strongest) ? value : strongest,
    0,
  );
  if (sourceFeedback !== 0) factors.sourceFeedback = sourceFeedback;
  if (topicFeedback !== 0) factors.topicFeedback = topicFeedback;

  const score = Math.max(
    0,
    Math.min(1, Object.values(factors).reduce((sum, value) => sum + value, 0)),
  );
  return {
    score: Math.round(score * 1000) / 1000,
    reason: {
      factors,
      category: classification.category,
      matchedCompanies: classification.matchedCompanies,
      matchedPeople: classification.matchedPeople,
      keywordHits,
      topicTags: classification.topicTags,
      contextHits: contextHits.slice(0, 10),
    },
  };
}

async function getTenantContextTerms(tenantId: string): Promise<Set<string>> {
  const secret = createSupabaseSecretClient();
  const [sourcesResult, diaryResult] = await Promise.all([
    secret
      .from("source_items")
      .select("title, body")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(40),
    secret
      .from("diary_entries")
      .select("body, transcript")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  if (sourcesResult.error) throw new Error(sourcesResult.error.message);
  if (diaryResult.error) throw new Error(diaryResult.error.message);

  const counts = new Map<string, number>();
  const collect = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const token of normaliseNewsTitle(value).split(" ")) {
      if (token.length < 5) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  };
  for (const row of sourcesResult.data ?? []) {
    collect(row.title);
    collect(row.body);
  }
  for (const row of diaryResult.data ?? []) {
    collect(row.body);
    collect(row.transcript);
  }
  return new Set(
    [...counts.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 120)
      .map(([term]) => term),
  );
}

function buildQuery(prefs: NewsTenantPreferences): NewsFetchQuery {
  const keywords = [
    ...prefs.keywords,
    ...prefs.companiesToMonitor,
    ...prefs.peopleToMonitor,
    ...activeCategories(prefs).flatMap((category) =>
      CATEGORY_KEYWORDS[category].slice(0, 2),
    ),
  ].filter(Boolean);
  return {
    categories: activeCategories(prefs),
    keywords: [...new Set(keywords)].slice(0, 25),
    regions: prefs.regions,
    countries: prefs.countries,
    languages: prefs.languages,
    sources: prefs.preferredSources,
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    limit: 75,
  };
}

async function updateRun(
  tenantId: string,
  runId: string,
  result: IngestionRunResult,
  status: "completed" | "partial" | "failed",
  errorMessage: string | null,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret
    .from("news_ingestion_run")
    .update({
      status,
      fetched_count: result.fetched,
      deduped_count: result.deduped,
      stored_count: result.stored,
      candidate_count: result.candidates,
      provider_errors: result.providerErrors,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(error.message);
  await secret.from("audit_events").insert({
    tenant_id: tenantId,
    user_id: null,
    action: status === "failed" ? "news.ingestion.failed" : "news.ingested",
    target: runId,
    metadata: {
      status,
      fetched: result.fetched,
      deduped: result.deduped,
      stored: result.stored,
      candidates: result.candidates,
      providerErrors: result.providerErrors,
      errorMessage,
    },
  });
}

export async function runNewsIngestion(
  tenantId: string,
): Promise<IngestionRunResult> {
  const result: IngestionRunResult = {
    fetched: 0,
    deduped: 0,
    stored: 0,
    candidates: 0,
    providerErrors: [],
  };
  const prefs = await getNewsPreferencesByTenant(tenantId);
  if (!prefs.enabled) return result;

  const secret = createSupabaseSecretClient();
  const { data: run, error: runError } = await secret
    .from("news_ingestion_run")
    .insert({ tenant_id: tenantId, status: "running" })
    .select("id")
    .single();
  if (runError || !run) {
    throw new Error(runError?.message ?? "news_ingestion_run_create_failed");
  }
  const runId = run.id as string;

  try {
    const [runtimes, feedback, contextTerms] = await Promise.all([
      listTenantProviderRuntimes(tenantId),
      getNewsFeedbackProfileByTenant(tenantId),
      getTenantContextTerms(tenantId),
    ]);
    const query = buildQuery(prefs);
    const blocked = prefs.blockedSources.map((source) => source.toLowerCase());

    const fetched: NormalisedNewsItem[] = [];
    for (const runtime of runtimes) {
      if (!runtime.enabled) continue;
      const provider = getNewsProvider(runtime.key);
      if (!provider || provider.tier !== "production") continue;
      try {
        fetched.push(
          ...(await provider.fetchLatest(query, {
            feedUrls: runtime.feedUrls,
          })),
        );
      } catch (cause) {
        result.providerErrors.push({
          provider: runtime.key,
          error: cause instanceof Error ? cause.message : "fetch_failed",
        });
      }
    }
    result.fetched = fetched.length;

    const { data: existingRows, error: existingError } = await secret
      .from("news_item")
      .select("url_hash, story_fingerprint, title, source_name, published_at")
      .eq("tenant_id", tenantId)
      .gte(
        "fetched_at",
        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .limit(2000);
    if (existingError) throw new Error(existingError.message);

    const stories: ExistingStory[] = [
      ...((existingRows ?? []) as ExistingStory[]),
    ];
    const deduped: {
      item: NormalisedNewsItem;
      urlHash: string;
      titleHash: string;
      fingerprint: string;
    }[] = [];

    for (const item of fetched) {
      if (
        blocked.some((source) =>
          `${item.sourceName} ${item.canonicalUrl}`.toLowerCase().includes(source),
        )
      ) {
        result.deduped += 1;
        continue;
      }
      const canonicalUrl = normaliseNewsUrl(item.canonicalUrl);
      const currentUrlHash = hash(canonicalUrl);
      const currentTitleHash = hash(normaliseNewsTitle(item.title));
      const fingerprint = storyFingerprint(item.title);
      if (isDuplicate(item, currentUrlHash, fingerprint, stories)) {
        result.deduped += 1;
        continue;
      }
      deduped.push({
        item,
        urlHash: currentUrlHash,
        titleHash: currentTitleHash,
        fingerprint,
      });
      stories.push({
        url_hash: currentUrlHash,
        story_fingerprint: fingerprint,
        title: item.title,
        source_name: item.sourceName,
        published_at: item.publishedAt,
      });
    }

    if (deduped.length === 0) {
      await updateRun(
        tenantId,
        runId,
        result,
        result.providerErrors.length > 0 ? "partial" : "completed",
        null,
      );
      return result;
    }

    const { data: inserted, error: itemError } = await secret
      .from("news_item")
      .upsert(
        deduped.map(({ item, urlHash, titleHash, fingerprint }) => ({
          tenant_id: tenantId,
          provider_key: item.providerKey,
          external_id: item.externalId,
          canonical_url: item.canonicalUrl,
          url_hash: urlHash,
          title_hash: titleHash,
          story_fingerprint: fingerprint,
          title: item.title,
          snippet: item.snippet,
          source_name: item.sourceName,
          language: item.language,
          published_at: item.publishedAt,
          raw_payload: item.rawPayload ?? null,
        })),
        { onConflict: "tenant_id,url_hash", ignoreDuplicates: true },
      )
      .select("id, url_hash");
    if (itemError) throw new Error(itemError.message);

    const idByHash = new Map(
      (inserted ?? []).map((row) => [
        row.url_hash as string,
        row.id as string,
      ]),
    );
    result.stored = idByHash.size;

    const classifications: Record<string, unknown>[] = [];
    const entities: Record<string, unknown>[] = [];
    const candidates: Record<string, unknown>[] = [];

    for (const entry of deduped) {
      const newsItemId = idByHash.get(entry.urlHash);
      if (!newsItemId) continue;
      const classification = classifyNewsItem(entry.item, prefs);
      const ranked = rankNewsItem(
        entry.item,
        classification,
        prefs,
        feedback,
        contextTerms,
      );

      classifications.push({
        news_item_id: newsItemId,
        tenant_id: tenantId,
        category: classification.category,
        region: classification.region,
        country: classification.country,
        strategic_relevance: ranked.score,
        urgency: classification.urgency,
        risk_level: classification.riskLevel,
        sentiment: classification.sentiment,
        confidence: classification.confidence,
        topic_tags: classification.topicTags,
        method: "heuristic",
      });

      for (const company of classification.matchedCompanies) {
        entities.push({
          tenant_id: tenantId,
          news_item_id: newsItemId,
          entity_type: "company",
          value: company,
          matched_monitor: true,
          confidence: 0.8,
        });
      }
      for (const person of classification.matchedPeople) {
        entities.push({
          tenant_id: tenantId,
          news_item_id: newsItemId,
          entity_type: "person",
          value: person,
          matched_monitor: true,
          confidence: 0.8,
        });
      }
      for (const topic of classification.topicTags.slice(0, 5)) {
        entities.push({
          tenant_id: tenantId,
          news_item_id: newsItemId,
          entity_type: "topic",
          value: topic,
          matched_monitor: false,
          confidence: 0.5,
        });
      }
      for (const place of [classification.region, classification.country].filter(
        (value): value is string => Boolean(value),
      )) {
        entities.push({
          tenant_id: tenantId,
          news_item_id: newsItemId,
          entity_type: "place",
          value: place,
          matched_monitor: true,
          confidence: 0.7,
        });
      }

      if (ranked.score >= prefs.minRelevanceScore) {
        candidates.push({
          tenant_id: tenantId,
          news_item_id: newsItemId,
          relevance_score: ranked.score,
          rank_reason: ranked.reason,
          category: classification.category,
          status: "candidate",
        });
      }
    }

    if (classifications.length > 0) {
      const { error } = await secret
        .from("news_item_classification")
        .upsert(classifications, { onConflict: "news_item_id" });
      if (error) throw new Error(error.message);
    }
    if (entities.length > 0) {
      const { error } = await secret.from("news_item_entity").insert(entities);
      if (error) throw new Error(error.message);
    }
    if (candidates.length > 0) {
      const { error } = await secret
        .from("news_briefing_item")
        .upsert(candidates, {
          onConflict: "tenant_id,news_item_id",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(error.message);
      result.candidates = candidates.length;
    }

    await updateRun(
      tenantId,
      runId,
      result,
      result.providerErrors.length > 0 ? "partial" : "completed",
      null,
    );
    return result;
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "news_ingestion_failed";
    await updateRun(tenantId, runId, result, "failed", message);
    throw cause;
  }
}
