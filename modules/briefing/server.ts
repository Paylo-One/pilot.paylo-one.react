import "server-only";

/**
 * modules/briefing/server.ts
 *
 * Server-only read helpers for the Daily Memo surface. Reads run through the
 * USER server client so Row Level Security enforces tenant isolation; an
 * explicit tenant_id predicate is added as defence-in-depth (and to pick the
 * correct tenant for users who belong to more than one).
 *
 * Writes (briefing generation) are NOT here — they go through agent
 * orchestration + the secret client, since RLS forbids end users from inserting
 * briefings/sections/source_references.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { listPeople } from "@/modules/people/people-server";
import type { PersonImportanceLevel, PersonSignal } from "@/modules/people/people.types";
import type { ExternalSignalView } from "@/modules/news";
import { getBriefingExternalSignals } from "@/modules/news/briefing";
import type { TenantContext } from "@/modules/shared";
import { resolveEntitlements, requireWithinLimit } from "@/modules/billing";
import { calendarDayBoundsInTimeZone } from "@/lib/tz-day";

/**
 * Count the tenant's generated briefings for the operator's local calendar day
 * and check against `maxBriefingsPerDay`.
 * This is an observe-only check: it logs a warning if the limit is exceeded but lets the action proceed.
 */
export async function checkBriefingLimit(ctx: TenantContext): Promise<boolean> {
  const { tenantId } = ctx;
  try {
    const resolved = await resolveEntitlements({ tenantId });
    if (!resolved.ok) {
      console.warn(
        "[billing][observe] maxBriefingsPerDay: entitlement resolution failed; allowing (fail-open)",
        { tenantId, error: resolved.error.code },
      );
      return true;
    }

    const secret = createSupabaseSecretClient();
    const { data: profile, error: profileError } = await secret
      .from("user_profiles")
      .select("timezone")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (profileError) {
      console.warn(
        "[billing][observe] maxBriefingsPerDay: failed to resolve timezone; using UTC",
        { tenantId, userId: ctx.userId, error: profileError.message },
      );
    }
    const timezone = (profile?.timezone as string | null) || "UTC";
    const today = calendarDayBoundsInTimeZone(new Date(), timezone);

    const { count, error } = await secret
      .from("briefings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("generated_at", today.start.toISOString())
      .lt("generated_at", today.end.toISOString());

    if (error) {
      console.warn(
        "[billing][observe] maxBriefingsPerDay: failed to count briefings; allowing (fail-open)",
        { tenantId, error: error.message },
      );
      return true;
    }

    const current = count ?? 0;
    const decision = requireWithinLimit(
      resolved.value,
      "maxBriefingsPerDay",
      current,
      1,
    );

    if (decision.ok) return true;

    // Denied by the plan limit.
    const detail = decision.error.detail ?? {};
    console.warn(
      "[billing][observe] maxBriefingsPerDay: WOULD block briefing generation (observe-only; allowing)",
      {
        tenantId,
        current,
        ...detail,
      },
    );
    return true;
  } catch (cause) {
    console.warn(
      "[billing][observe] maxBriefingsPerDay: check errored; allowing (fail-open)",
      {
        tenantId,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    );
    return true;
  }
}


export interface BriefingSourceReference {
  readonly id: string;
  readonly sourceSystem: string;
  readonly itemTimestamp: string | null;
  readonly confidence: number | null;
  readonly excerptOrPointer: string | null;
  /** Person this reference is correlated to (People Context), if any. */
  readonly personId: string | null;
  readonly personName: string | null;
}

export interface BriefingSectionView {
  readonly id: string;
  readonly kind: string;
  readonly position: number;
  readonly title: string;
  readonly body: string | null;
  readonly references: BriefingSourceReference[];
}

export interface LatestBriefing {
  readonly id: string;
  readonly status: string;
  readonly summary: string | null;
  readonly generatedAt: string;
  readonly sections: BriefingSectionView[];
  readonly externalSignals: ExternalSignalView[];
}

interface BriefingRow {
  id: string;
  status: string;
  summary: string | null;
  generated_at: string;
}

interface SectionRow {
  id: string;
  kind: string;
  position: number;
  title: string;
  body: string | null;
}

interface SourceReferenceRow {
  id: string;
  briefing_section_id: string | null;
  source_system: string;
  item_timestamp: string | null;
  confidence: number | null;
  excerpt_or_pointer: string | null;
  person_id: string | null;
}

/** The most recent briefing for the tenant, with ordered sections + references. */
export async function getLatestBriefing(ctx: TenantContext): Promise<LatestBriefing | null> {
  const supabase = await createSupabaseServerClient();

  const { data: briefingData, error: briefingError } = await supabase
    .from("briefings")
    .select("id, status, summary, generated_at")
    .eq("tenant_id", ctx.tenantId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fail loud on a read error rather than returning null, which the surface
  // renders as "no memo yet" — a lie when a memo exists but failed to load.
  if (briefingError) {
    throw new Error(`Failed to load latest briefing: ${briefingError.message}`);
  }

  const briefing = briefingData as BriefingRow | null;
  if (!briefing) return null;

  const { data: sectionData, error: sectionError } = await supabase
    .from("briefing_sections")
    .select("id, kind, position, title, body")
    .eq("briefing_id", briefing.id)
    .order("position", { ascending: true });

  if (sectionError) {
    throw new Error(`Failed to load briefing sections: ${sectionError.message}`);
  }

  const sections = ((sectionData ?? []) as SectionRow[]).filter(
    (section) => section.kind !== "external_signals",
  );
  const sectionIds = sections.map((s) => s.id);

  const referencesBySection = new Map<string, BriefingSourceReference[]>();
  if (sectionIds.length > 0) {
    const { data: refData, error: refError } = await supabase
      .from("source_references")
      .select("id, briefing_section_id, source_system, item_timestamp, confidence, excerpt_or_pointer, person_id")
      .in("briefing_section_id", sectionIds);

    // Trust contract: every shown memo insight must carry its real source
    // references. If we cannot load them, fail loud rather than render sections
    // stripped of their provenance (which would present them as if unattributed).
    if (refError) {
      throw new Error(`Failed to load briefing source references: ${refError.message}`);
    }

    const refRows = (refData ?? []) as SourceReferenceRow[];

    // Resolve person names for person-linked references (People Context). This
    // is cosmetic enrichment — a failure here degrades a resolved name to null
    // (already handled below) rather than dropping a real reference, so it must
    // not fail the whole memo the way a missing reference would.
    const personIds = [...new Set(refRows.map((r) => r.person_id).filter(Boolean))] as string[];
    const personNames = new Map<string, string>();
    if (personIds.length > 0) {
      const { data: peopleData, error: peopleError } = await supabase
        .from("people")
        .select("id, display_name")
        .in("id", personIds);
      if (peopleError) {
        console.warn(
          "[briefing] person-name resolution failed; references keep null names",
          { briefingId: briefing.id, error: peopleError.message },
        );
      }
      for (const p of (peopleData ?? []) as { id: string; display_name: string }[]) {
        personNames.set(p.id, p.display_name);
      }
    }

    for (const row of refRows) {
      if (!row.briefing_section_id) continue;
      const list = referencesBySection.get(row.briefing_section_id) ?? [];
      list.push({
        id: row.id,
        sourceSystem: row.source_system,
        itemTimestamp: row.item_timestamp,
        confidence: row.confidence,
        excerptOrPointer: row.excerpt_or_pointer,
        personId: row.person_id,
        personName: row.person_id ? personNames.get(row.person_id) ?? null : null,
      });
      referencesBySection.set(row.briefing_section_id, list);
    }
  }

  const externalSignals = await getBriefingExternalSignals(ctx, briefing.id);
  return {
    id: briefing.id,
    status: briefing.status,
    summary: briefing.summary,
    generatedAt: briefing.generated_at,
    externalSignals,
    sections: sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      position: s.position,
      title: s.title,
      body: s.body,
      references: referencesBySection.get(s.id) ?? [],
    })),
  };
}

// --- Correlation → Daily Memo: people behind today's activity ---------------

/** A person surfaced in the memo because recent activity correlates to them. */
export interface PersonInFocus {
  readonly personId: string;
  readonly name: string;
  readonly importance: PersonImportanceLevel;
  readonly roleTitle: string | null;
  readonly organisation: string | null;
  /** Top recent correlated signals (capped). */
  readonly signals: PersonSignal[];
  readonly signalCount: number;
}

const IMPORTANCE_RANK: Record<PersonImportanceLevel, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

/**
 * Real, correlation-derived input to the Daily Memo: the people behind recent
 * activity, ranked by the importance the operator set, then by how much they
 * touched. Deterministic (People Context + Information Correlation) — not an
 * LLM-generated section. Drives the memo's "People in focus" surface so the memo
 * is relationship-aware regardless of whether an agent briefing exists yet.
 */
export async function getPeopleInFocus(limit = 6): Promise<PersonInFocus[]> {
  const people = await listPeople(); // signals already correlated (RLS-scoped)
  return people
    .filter((p) => p.signals.length > 0)
    .map((p) => ({
      personId: p.id,
      name: p.displayName,
      importance: p.importance,
      roleTitle: p.roleTitle,
      organisation: p.organisation,
      signals: p.signals.slice(0, 3),
      signalCount: p.signals.length,
    }))
    .sort(
      (a, b) =>
        IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] ||
        b.signalCount - a.signalCount,
    )
    .slice(0, limit);
}
