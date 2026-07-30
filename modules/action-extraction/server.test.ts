/**
 * server.test.ts — listSuggestedActions read-path trust contract.
 *
 * The Actions queue must never silently render an empty inbox on a read error,
 * nor render actions stripped of their source references (which would present an
 * attributed action as if it were unattributed). Both read errors must throw so
 * the surface degrades to its calm error boundary instead.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: { message: string } | null };

const { tables } = vi.hoisted(() => ({
  tables: {
    suggested_actions: { data: [] as unknown[], error: null } as QueryResult,
    source_references: { data: [] as unknown[], error: null } as QueryResult,
  } as Record<string, QueryResult>,
}));

// A permissive chainable builder: every method returns the same thenable, and
// awaiting it resolves to the per-table configured result. This mirrors the
// real query shapes (.select().eq().order() and .select().in()) without pinning
// to a specific call sequence.
function makeBuilder(table: string) {
  const result = tables[table] as QueryResult;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "order", "in"]) {
    builder[method] = chain;
  }
  builder.then = (resolve: (v: QueryResult) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

import { listSuggestedActions } from "./server";

beforeEach(() => {
  tables.suggested_actions = { data: [], error: null };
  tables.source_references = { data: [], error: null };
});

describe("listSuggestedActions (read-path trust contract)", () => {
  it("returns [] when there are no actions (and never queries references)", async () => {
    tables.suggested_actions = { data: [], error: null };
    await expect(listSuggestedActions("t1")).resolves.toEqual([]);
  });

  it("throws when the suggested_actions read errors (no silent empty inbox)", async () => {
    tables.suggested_actions = { data: null, error: { message: "db down" } };
    await expect(listSuggestedActions("t1")).rejects.toThrow(/Failed to load suggested actions/);
  });

  it("throws when the source_references read errors (no unattributed actions)", async () => {
    tables.suggested_actions = {
      data: [{ id: "a1", status: "inbox", title: "Do the thing", topics: [], documents: [] }],
      error: null,
    };
    tables.source_references = { data: null, error: { message: "rls hiccup" } };
    await expect(listSuggestedActions("t1")).rejects.toThrow(/Failed to load action source references/);
  });

  it("attaches references to their action on the happy path", async () => {
    tables.suggested_actions = {
      data: [{ id: "a1", status: "inbox", title: "Do the thing", topics: [], documents: [] }],
      error: null,
    };
    tables.source_references = {
      data: [
        {
          id: "r1",
          suggested_action_id: "a1",
          source_system: "slack",
          item_timestamp: null,
          confidence: 0.9,
          excerpt_or_pointer: "…",
          diary_entry_id: null,
        },
      ],
      error: null,
    };

    const actions = await listSuggestedActions("t1");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.references).toHaveLength(1);
    expect(actions[0]!.references[0]!.sourceSystem).toBe("slack");
  });
});
