import "server-only";

/**
 * modules/news/preferences.ts — tenant news preferences (ADR-039).
 *
 * Reads via the RLS user client; writes via the secret client with an explicit
 * tenant_id (the table has no authenticated write policy). Every change is
 * recorded field-by-field in `news_config_audit` AND summarised on the unified
 * `audit_events` trail.
 */

import { ValidationError, err, ok, type Result, type TenantContext } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { auditService } from "@/modules/audit";
import {
  DEFAULT_NEWS_PREFERENCES,
  type NewsCategory,
  type NewsPreferencesPatch,
  type NewsTenantPreferences,
} from "./index";
import { NewsPreferencesPatchSchema } from "./validation";

interface PrefsRow {
  enabled: boolean;
  briefing_enabled: boolean;
  categories: string[];
  regions: string[];
  countries: string[];
  keywords: string[];
  people_to_monitor: string[];
  companies_to_monitor: string[];
  preferred_sources: string[];
  blocked_sources: string[];
  languages: string[];
  max_items_per_briefing: number;
  min_relevance_score: number;
  include_global_headlines: boolean;
  include_market_news: boolean;
  include_regulatory_news: boolean;
  include_ai_news: boolean;
  updated_at: string | null;
}

const PREFS_SELECT =
  "enabled, briefing_enabled, categories, regions, countries, keywords, people_to_monitor, companies_to_monitor, preferred_sources, blocked_sources, languages, max_items_per_briefing, min_relevance_score, include_global_headlines, include_market_news, include_regulatory_news, include_ai_news, updated_at";

function mapRow(row: PrefsRow): NewsTenantPreferences {
  return {
    enabled: row.enabled,
    briefingEnabled: row.briefing_enabled,
    categories: (row.categories ?? []) as NewsCategory[],
    regions: row.regions ?? [],
    countries: row.countries ?? [],
    keywords: row.keywords ?? [],
    peopleToMonitor: row.people_to_monitor ?? [],
    companiesToMonitor: row.companies_to_monitor ?? [],
    preferredSources: row.preferred_sources ?? [],
    blockedSources: row.blocked_sources ?? [],
    languages: row.languages ?? ["en"],
    maxItemsPerBriefing: row.max_items_per_briefing,
    minRelevanceScore: Number(row.min_relevance_score),
    includeGlobalHeadlines: row.include_global_headlines,
    includeMarketNews: row.include_market_news,
    includeRegulatoryNews: row.include_regulatory_news,
    includeAiNews: row.include_ai_news,
    updatedAt: row.updated_at,
  };
}

/** Read the tenant's news preferences (RLS), or conservative defaults. */
export async function getNewsPreferences(ctx: TenantContext): Promise<NewsTenantPreferences> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("news_tenant_preferences")
    .select(PREFS_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as PrefsRow) : DEFAULT_NEWS_PREFERENCES;
}

/** Read full prefs with the SECRET client (for the ingestion job, no session). */
export async function getNewsPreferencesByTenant(tenantId: string): Promise<NewsTenantPreferences> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("news_tenant_preferences")
    .select(PREFS_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as PrefsRow) : DEFAULT_NEWS_PREFERENCES;
}

/** camelCase patch key → (db column, current-value getter) for audit diffing. */
const FIELD_MAP: Record<
  keyof NewsPreferencesPatch,
  { column: string; current: (p: NewsTenantPreferences) => unknown }
> = {
  enabled: { column: "enabled", current: (p) => p.enabled },
  briefingEnabled: { column: "briefing_enabled", current: (p) => p.briefingEnabled },
  categories: { column: "categories", current: (p) => p.categories },
  regions: { column: "regions", current: (p) => p.regions },
  countries: { column: "countries", current: (p) => p.countries },
  keywords: { column: "keywords", current: (p) => p.keywords },
  peopleToMonitor: { column: "people_to_monitor", current: (p) => p.peopleToMonitor },
  companiesToMonitor: { column: "companies_to_monitor", current: (p) => p.companiesToMonitor },
  preferredSources: { column: "preferred_sources", current: (p) => p.preferredSources },
  blockedSources: { column: "blocked_sources", current: (p) => p.blockedSources },
  languages: { column: "languages", current: (p) => p.languages },
  maxItemsPerBriefing: { column: "max_items_per_briefing", current: (p) => p.maxItemsPerBriefing },
  minRelevanceScore: { column: "min_relevance_score", current: (p) => p.minRelevanceScore },
  includeGlobalHeadlines: { column: "include_global_headlines", current: (p) => p.includeGlobalHeadlines },
  includeMarketNews: { column: "include_market_news", current: (p) => p.includeMarketNews },
  includeRegulatoryNews: { column: "include_regulatory_news", current: (p) => p.includeRegulatoryNews },
  includeAiNews: { column: "include_ai_news", current: (p) => p.includeAiNews },
};

/**
 * Upsert the tenant's news preferences, recording a per-field audit diff in
 * `news_config_audit` + a summary `audit_events` row. Returns the new prefs.
 */
export async function updateNewsPreferences(
  ctx: TenantContext,
  patch: NewsPreferencesPatch,
): Promise<Result<NewsTenantPreferences>> {
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return err(new ValidationError("Only workspace owners and admins can configure News."));
  }
  const parsed = NewsPreferencesPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return err(
      new ValidationError("Invalid News preferences.", {
        issues: parsed.error.issues,
      }),
    );
  }

  const before = await getNewsPreferences(ctx);
  const secret = createSupabaseSecretClient();

  const row: Record<string, unknown> = { tenant_id: ctx.tenantId, updated_by: ctx.userId };
  const auditRows: { tenant_id: string; actor_user_id: string; field: string; previous_value: unknown; new_value: unknown }[] = [];

  for (const key of Object.keys(parsed.data) as (keyof NewsPreferencesPatch)[]) {
    const value = parsed.data[key];
    if (value === undefined) continue;
    const mapping = FIELD_MAP[key];
    row[mapping.column] = value;
    const prev = mapping.current(before);
    if (JSON.stringify(prev) !== JSON.stringify(value)) {
      auditRows.push({
        tenant_id: ctx.tenantId,
        actor_user_id: ctx.userId,
        field: mapping.column,
        previous_value: prev,
        new_value: value,
      });
    }
  }

  // If the row never existed, ensure created_by is set on first write.
  if (before.updatedAt === null) row.created_by = ctx.userId;

  const { error } = await secret
    .from("news_tenant_preferences")
    .upsert(row, { onConflict: "tenant_id" });
  if (error) return err(new ValidationError(error.message));

  if (auditRows.length > 0) {
    const { error: auditError } = await secret.from("news_config_audit").insert(auditRows);
    if (auditError) return err(new ValidationError(auditError.message));
    await auditService.record(ctx, {
      action: "news.preferences.updated",
      metadata: { fields: auditRows.map((a) => a.field) },
    });
  }

  return ok(await getNewsPreferencesByTenant(ctx.tenantId));
}
