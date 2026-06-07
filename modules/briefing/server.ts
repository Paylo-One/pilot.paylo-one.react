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

export interface BriefingSourceReference {
  readonly id: string;
  readonly sourceSystem: string;
  readonly itemTimestamp: string | null;
  readonly confidence: number | null;
  readonly excerptOrPointer: string | null;
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
}

/** The most recent briefing for the tenant, with ordered sections + references. */
export async function getLatestBriefing(tenantId: string): Promise<LatestBriefing | null> {
  const supabase = await createSupabaseServerClient();

  const { data: briefingData } = await supabase
    .from("briefings")
    .select("id, status, summary, generated_at")
    .eq("tenant_id", tenantId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const briefing = briefingData as BriefingRow | null;
  if (!briefing) return null;

  const { data: sectionData } = await supabase
    .from("briefing_sections")
    .select("id, kind, position, title, body")
    .eq("briefing_id", briefing.id)
    .order("position", { ascending: true });

  const sections = (sectionData ?? []) as SectionRow[];
  const sectionIds = sections.map((s) => s.id);

  const referencesBySection = new Map<string, BriefingSourceReference[]>();
  if (sectionIds.length > 0) {
    const { data: refData } = await supabase
      .from("source_references")
      .select("id, briefing_section_id, source_system, item_timestamp, confidence, excerpt_or_pointer")
      .in("briefing_section_id", sectionIds);

    for (const row of (refData ?? []) as SourceReferenceRow[]) {
      if (!row.briefing_section_id) continue;
      const list = referencesBySection.get(row.briefing_section_id) ?? [];
      list.push({
        id: row.id,
        sourceSystem: row.source_system,
        itemTimestamp: row.item_timestamp,
        confidence: row.confidence,
        excerptOrPointer: row.excerpt_or_pointer,
      });
      referencesBySection.set(row.briefing_section_id, list);
    }
  }

  return {
    id: briefing.id,
    status: briefing.status,
    summary: briefing.summary,
    generatedAt: briefing.generated_at,
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
