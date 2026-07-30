/**
 * get-latest-briefing.test.ts — getLatestBriefing read-path trust contract.
 *
 * The Daily Memo must never silently return null on a read error (the surface
 * renders that as "no memo yet", a lie when a memo exists but failed to load),
 * nor render sections stripped of their source references. Trust-critical reads
 * (briefings, sections, source_references) must throw so the surface degrades to
 * its calm error boundary. Person-name resolution is cosmetic and must NOT throw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: { message: string } | null };

const { tables } = vi.hoisted(() => ({
  tables: {
    briefings: { data: null, error: null } as QueryResult,
    briefing_sections: { data: [] as unknown[], error: null } as QueryResult,
    source_references: { data: [] as unknown[], error: null } as QueryResult,
    people: { data: [] as unknown[], error: null } as QueryResult,
  } as Record<string, QueryResult>,
}));

function makeBuilder(table: string) {
  const result = tables[table] as QueryResult;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "order", "limit", "in"]) {
    builder[method] = chain;
  }
  // briefings is read via .maybeSingle(); the rest are awaited directly.
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (v: QueryResult) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

// External signals are fetched after the trust-critical reads; stub to isolate.
vi.mock("@/modules/news/briefing", () => ({
  getBriefingExternalSignals: () => Promise.resolve([]),
}));

import { getLatestBriefing } from "./server";

const ctx = { tenantId: "t1", userId: "u1" } as never;

beforeEach(() => {
  tables.briefings = { data: null, error: null };
  tables.briefing_sections = { data: [], error: null };
  tables.source_references = { data: [], error: null };
  tables.people = { data: [], error: null };
});

describe("getLatestBriefing (read-path trust contract)", () => {
  it("returns null when no briefing exists yet", async () => {
    tables.briefings = { data: null, error: null };
    await expect(getLatestBriefing(ctx)).resolves.toBeNull();
  });

  it("throws when the briefings read errors (never masks it as 'no memo yet')", async () => {
    tables.briefings = { data: null, error: { message: "db down" } };
    await expect(getLatestBriefing(ctx)).rejects.toThrow(/Failed to load latest briefing/);
  });

  it("throws when the briefing_sections read errors", async () => {
    tables.briefings = { data: { id: "b1", status: "ready", summary: "s", generated_at: "t" }, error: null };
    tables.briefing_sections = { data: null, error: { message: "boom" } };
    await expect(getLatestBriefing(ctx)).rejects.toThrow(/Failed to load briefing sections/);
  });

  it("throws when the source_references read errors (no sections without provenance)", async () => {
    tables.briefings = { data: { id: "b1", status: "ready", summary: "s", generated_at: "t" }, error: null };
    tables.briefing_sections = {
      data: [{ id: "sec1", kind: "decision", position: 1, title: "T", body: "B" }],
      error: null,
    };
    tables.source_references = { data: null, error: { message: "rls hiccup" } };
    await expect(getLatestBriefing(ctx)).rejects.toThrow(/Failed to load briefing source references/);
  });

  it("does NOT throw when only person-name resolution errors (cosmetic degrade)", async () => {
    tables.briefings = { data: { id: "b1", status: "ready", summary: "s", generated_at: "t" }, error: null };
    tables.briefing_sections = {
      data: [{ id: "sec1", kind: "decision", position: 1, title: "T", body: "B" }],
      error: null,
    };
    tables.source_references = {
      data: [
        {
          id: "r1",
          briefing_section_id: "sec1",
          source_system: "slack",
          item_timestamp: null,
          confidence: 0.8,
          excerpt_or_pointer: "…",
          person_id: "p1",
        },
      ],
      error: null,
    };
    tables.people = { data: null, error: { message: "people read down" } };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await getLatestBriefing(ctx);
    expect(result).not.toBeNull();
    expect(result!.sections[0]!.references[0]!.personName).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
