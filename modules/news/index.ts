/**
 * modules/news — optional, tenant-scoped News Briefing (ADR-039).
 *
 * News is an external-signal source: off by default, per-tenant, relevance-
 * filtered. Items run the standard signal pipeline (fetch → normalise → dedupe
 * → classify → rank → store → brief). This file holds the PURE types + display
 * metadata + the provider interface — importable by both server (pipeline) and
 * client (admin UI). Secrets, DB access, and fetching live in the server files
 * (`providers`, `preferences`, `ingest`, `briefing`, `feedback`).
 *
 * Governance: architecture/news-briefing-architecture.md.
 */

// --- Categories --------------------------------------------------------------

/** The configurable news categories (any combination selectable per tenant). */
export type NewsCategory =
  | "world_geopolitics"
  | "africa"
  | "fintech_payments"
  | "crypto_digital_assets"
  | "ai_technology"
  | "markets_macro"
  | "regulatory_compliance"
  | "company_competitor"
  | "people_monitoring"
  | "custom_topics";

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  world_geopolitics: "World & geopolitics",
  africa: "Africa",
  fintech_payments: "Fintech & payments",
  crypto_digital_assets: "Crypto & digital assets",
  ai_technology: "AI & technology",
  markets_macro: "Markets & macro",
  regulatory_compliance: "Regulatory & compliance",
  company_competitor: "Company & competitor monitoring",
  people_monitoring: "People monitoring",
  custom_topics: "Custom topics",
};

export const NEWS_CATEGORY_ORDER: readonly NewsCategory[] = [
  "world_geopolitics",
  "africa",
  "fintech_payments",
  "crypto_digital_assets",
  "ai_technology",
  "markets_macro",
  "regulatory_compliance",
  "company_competitor",
  "people_monitoring",
  "custom_topics",
];

/**
 * Seed keyword sets per category — used both to query providers and to classify
 * fetched items heuristically. Tenant keywords/monitors are layered on top.
 */
export const CATEGORY_KEYWORDS: Record<NewsCategory, readonly string[]> = {
  world_geopolitics: ["geopolitics", "sanctions", "election", "conflict", "treaty", "diplomacy"],
  africa: ["Africa", "Nigeria", "Kenya", "Zimbabwe", "South Africa", "Ghana", "Egypt"],
  fintech_payments: ["fintech", "payments", "stablecoin", "remittance", "card scheme", "open banking"],
  crypto_digital_assets: ["crypto", "bitcoin", "ethereum", "stablecoin", "digital asset", "tokenisation"],
  ai_technology: ["artificial intelligence", "AI model", "LLM", "machine learning", "chip", "data centre"],
  markets_macro: ["inflation", "interest rate", "central bank", "GDP", "currency", "bond yield"],
  regulatory_compliance: ["regulation", "compliance", "regulator", "licence", "AML", "KYC", "sanction"],
  company_competitor: ["acquisition", "funding round", "earnings", "merger", "layoffs", "partnership"],
  people_monitoring: [],
  custom_topics: [],
};

// --- Provider abstraction ----------------------------------------------------

export type NewsProviderTier = "production" | "development";

/** A normalised news item — the only shape the pipeline and briefing consume. */
export interface NormalisedNewsItem {
  /** Provider attribution. */
  readonly providerKey: string;
  /** Provider's own id, when available. */
  readonly externalId: string | null;
  readonly title: string;
  /** Summary/snippet if available — NEVER the full article body. */
  readonly snippet: string | null;
  /** Canonical link back to the original source. */
  readonly canonicalUrl: string;
  readonly sourceName: string;
  readonly language: string | null;
  /** ISO timestamp, or null when the provider omits it. */
  readonly publishedAt: string | null;
  /** Provider category hint, if any (else classified downstream). */
  readonly category: NewsCategory | null;
  readonly country: string | null;
  /** Raw provider payload for audit/debug; persisted only per provider terms. */
  readonly rawPayload: unknown;
}

/** A normalised query handed to a provider adapter. */
export interface NewsFetchQuery {
  readonly categories?: readonly NewsCategory[];
  readonly keywords?: readonly string[];
  readonly regions?: readonly string[];
  readonly countries?: readonly string[];
  readonly sources?: readonly string[];
  readonly languages?: readonly string[];
  /** ISO lower bound for published time. */
  readonly since?: string;
  readonly limit?: number;
}

/** Per-call runtime config (server env keys for keyed providers; RSS/GDELT ignore). */
export interface ProviderRuntimeConfig {
  readonly apiKey?: string;
  /** Tenant feed URLs (RSS) / source allowlist. */
  readonly feedUrls?: readonly string[];
}

export interface ProviderCapabilities {
  readonly byCategory: boolean;
  readonly byKeyword: boolean;
  readonly byRegion: boolean;
  readonly bySource: boolean;
}

/**
 * The single contract every news provider implements. Adding a provider is a
 * new file + a registry entry; nothing above the registry knows the vendor.
 */
export interface NewsProvider {
  readonly key: string;
  readonly name: string;
  readonly tier: NewsProviderTier;
  readonly capabilities: ProviderCapabilities;
  /** Fetch + normalise the latest items matching the query. Never throws for
   *  empty results; throws only on a genuine provider/transport failure (the
   *  pipeline isolates these per provider). */
  fetchLatest(query: NewsFetchQuery, cfg: ProviderRuntimeConfig): Promise<NormalisedNewsItem[]>;
  /** A lightweight connectivity probe for the admin "Test" button. */
  test(cfg: ProviderRuntimeConfig): Promise<{ ok: boolean; detail: string }>;
}

// --- Tenant preferences (mirrors news_tenant_preferences) --------------------

export interface NewsTenantPreferences {
  readonly enabled: boolean;
  readonly briefingEnabled: boolean;
  readonly categories: readonly NewsCategory[];
  readonly regions: readonly string[];
  readonly countries: readonly string[];
  readonly keywords: readonly string[];
  readonly peopleToMonitor: readonly string[];
  readonly companiesToMonitor: readonly string[];
  readonly preferredSources: readonly string[];
  readonly blockedSources: readonly string[];
  readonly languages: readonly string[];
  readonly maxItemsPerBriefing: number;
  readonly minRelevanceScore: number;
  readonly includeGlobalHeadlines: boolean;
  readonly includeMarketNews: boolean;
  readonly includeRegulatoryNews: boolean;
  readonly includeAiNews: boolean;
  readonly updatedAt: string | null;
}

/** Mutable tenant preferences accepted by the admin API and server actions. */
export interface NewsPreferencesPatch {
  enabled?: boolean;
  briefingEnabled?: boolean;
  categories?: NewsCategory[];
  regions?: string[];
  countries?: string[];
  keywords?: string[];
  peopleToMonitor?: string[];
  companiesToMonitor?: string[];
  preferredSources?: string[];
  blockedSources?: string[];
  languages?: string[];
  maxItemsPerBriefing?: number;
  minRelevanceScore?: number;
  includeGlobalHeadlines?: boolean;
  includeMarketNews?: boolean;
  includeRegulatoryNews?: boolean;
  includeAiNews?: boolean;
}

/** Conservative defaults for a tenant that has never configured news. */
export const DEFAULT_NEWS_PREFERENCES: NewsTenantPreferences = {
  enabled: false,
  briefingEnabled: false,
  categories: [],
  regions: [],
  countries: [],
  keywords: [],
  peopleToMonitor: [],
  companiesToMonitor: [],
  preferredSources: [],
  blockedSources: [],
  languages: ["en"],
  maxItemsPerBriefing: 5,
  minRelevanceScore: 0.5,
  includeGlobalHeadlines: true,
  includeMarketNews: true,
  includeRegulatoryNews: true,
  includeAiNews: true,
  updatedAt: null,
};

/** Feedback signals the operator can give on a briefing item / source / topic. */
export type NewsFeedbackSignal =
  | "more_like_this"
  | "less_like_this"
  | "hide_source"
  | "follow_topic"
  | "unfollow_topic"
  | "important"
  | "not_relevant";

export const NEWS_FEEDBACK_LABELS: Record<NewsFeedbackSignal, string> = {
  more_like_this: "More like this",
  less_like_this: "Less like this",
  hide_source: "Hide source",
  follow_topic: "Follow topic",
  unfollow_topic: "Stop following",
  important: "Important",
  not_relevant: "Not relevant",
};

/** Tenant-facing provider state. API keys are intentionally absent. */
export interface NewsProviderView {
  readonly key: string;
  readonly name: string;
  readonly tier: NewsProviderTier;
  readonly platformEnabled: boolean;
  readonly implemented: boolean;
  readonly enabled: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly docsUrl: string | null;
  readonly feedUrls: readonly string[];
  readonly updatedAt: string | null;
}

/** Recent normalised/ranked item shown in the News admin surface. */
export interface NewsItemView {
  readonly id: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly canonicalUrl: string;
  readonly sourceName: string;
  readonly providerKey: string;
  readonly publishedAt: string | null;
  readonly fetchedAt: string;
  readonly category: NewsCategory | null;
  readonly country: string | null;
  readonly topicTags: readonly string[];
  readonly relevanceScore: number | null;
  readonly rankReason: Record<string, unknown> | null;
  readonly status: "candidate" | "shown" | "suppressed" | null;
}

export interface NewsItemDetail extends NewsItemView {
  readonly language: string | null;
  readonly urgency: string | null;
  readonly riskLevel: string | null;
  readonly sentiment: string | null;
  readonly confidence: number | null;
  readonly entities: readonly {
    readonly type: "company" | "person" | "topic" | "place";
    readonly value: string;
    readonly matchedMonitor: boolean;
    readonly confidence: number;
  }[];
}

/** A concise, decision-focused item rendered in the Daily Memo. */
export interface ExternalSignalView {
  readonly briefingItemId: string;
  readonly newsItemId: string;
  readonly headline: string;
  readonly summary: string | null;
  readonly whyItMatters: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly publishedAt: string | null;
  readonly category: NewsCategory | null;
  readonly relevanceScore: number;
}

export interface NewsConfigAuditView {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly field: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  readonly createdAt: string;
}

export interface NewsIngestionRunView {
  readonly id: string;
  readonly status: "running" | "completed" | "partial" | "failed";
  readonly fetched: number;
  readonly deduped: number;
  readonly stored: number;
  readonly candidates: number;
  readonly providerErrors: readonly { provider: string; error: string }[];
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

/** Serializable payload for the News Connected Source detail screen. */
export interface NewsAdminData {
  readonly preferences: NewsTenantPreferences;
  readonly providers: readonly NewsProviderView[];
  readonly recentItems: readonly NewsItemView[];
  readonly recentAudit: readonly NewsConfigAuditView[];
  readonly latestRun: NewsIngestionRunView | null;
}
