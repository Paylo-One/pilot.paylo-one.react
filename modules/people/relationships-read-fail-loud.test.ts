/**
 * relationships-read-fail-loud.test.ts — read path fails loud on the diary
 * privacy filter, matching the enclosing entity_links reads.
 *
 * `listRelationshipsFor` throws if its entity_links read errors. One line later,
 * `filterReadableLinks` reads `diary_entries` to decide which diary-linked edges
 * the current user authored (and may see). That read used to discard its error:
 * on a transient failure `data` was null, so the readable set was empty and every
 * diary-linked relationship silently vanished — the operator's own graph rendered
 * incomplete with no signal. This guards that the diary read now fails loud too,
 * degrading the People/Companies view to its calm error boundary instead, while
 * the happy path still filters to only the diary entries the user authored.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { message: string } | null;

interface Row {
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  entityLinks: [] as Row[],
  entityLinksError: null as Err,
  userId: "u1" as string | null,
  diaryRows: [] as Row[],
  diaryError: null as Err,
}));

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "in", "or", "is", "order"]) {
    builder[method] = chain;
  }
  // Every read in this path awaits the builder directly (no .single()).
  builder.then = (resolve: (v: { data: Row[]; error: Err }) => unknown) => {
    if (table === "entity_links") {
      return resolve({ data: state.entityLinks, error: state.entityLinksError });
    }
    if (table === "diary_entries") {
      return resolve({ data: state.diaryRows, error: state.diaryError });
    }
    // Label lookups (people/companies/…) — irrelevant here; degrade to fallback.
    return resolve({ data: [], error: null });
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => makeBuilder(table),
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.userId ? { id: state.userId } : null } }),
    },
  }),
}));

import { listRelationshipsFor } from "./relationships";

function link(overrides: Row): Row {
  return {
    id: "l0",
    source_entity_type: "person",
    source_entity_id: "person1",
    target_entity_type: "company",
    target_entity_id: "c1",
    relationship_type: "works_at",
    confidence: 0.9,
    origin: "user",
    status: "confirmed",
    evidence_summary: null,
    source_reference: null,
    visibility: "visible",
    first_seen_at: "2026-08-01T00:00:00Z",
    last_seen_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.userId = "u1";
  state.entityLinksError = null;
  state.diaryError = null;
  // Two diary-linked edges (one the user authored, one they did not) plus a
  // non-diary edge that must always survive the filter.
  state.entityLinks = [
    link({ id: "mine", target_entity_type: "diary_entry", target_entity_id: "d1" }),
    link({ id: "theirs", target_entity_type: "diary_entry", target_entity_id: "d2" }),
    link({ id: "company", target_entity_type: "company", target_entity_id: "c1" }),
  ];
  state.diaryRows = [
    { id: "d1", author_user_id: "u1", created_at: "2026-08-01T00:00:00Z" },
    { id: "d2", author_user_id: "someone-else", created_at: "2026-08-01T00:00:00Z" },
  ];
});

describe("listRelationshipsFor — diary privacy read", () => {
  it("keeps only the diary edges the current user authored (happy path)", async () => {
    const rels = await listRelationshipsFor("person", "person1", { includeSuggested: true });
    const ids = rels.map((r) => r.id).sort();
    // "mine" (own diary) and "company" (non-diary) survive; "theirs" is filtered.
    expect(ids).toEqual(["company", "mine"]);
  });

  it("fails loud when the diary_entries read errors, instead of silently dropping diary edges", async () => {
    state.diaryError = { message: "diary read failed" };
    await expect(
      listRelationshipsFor("person", "person1", { includeSuggested: true }),
    ).rejects.toThrow(/diary read failed/);
  });

  it("still surfaces the underlying error from the primary entity_links read", async () => {
    state.entityLinksError = { message: "links read failed" };
    await expect(
      listRelationshipsFor("person", "person1", { includeSuggested: true }),
    ).rejects.toThrow(/links read failed/);
  });
});
