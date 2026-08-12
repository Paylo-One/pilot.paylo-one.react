/**
 * Metadata suggestions must not quietly treat a failed context read as an
 * empty tenant. Doing so produces plausible but context-poor suggestions and
 * hides an operational failure from the operator.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const state = vi.hoisted(() => ({
  results: {} as Record<string, QueryResult>,
}));

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq"]) builder[method] = chain;
  builder.then = (resolve: (value: QueryResult) => unknown) =>
    resolve(state.results[table] ?? { data: [], error: null });
  return builder;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/identity-tenant/server", () => ({
  requireTenantContext: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));
vi.mock("@/lib/llm", () => ({
  createLlmClient: vi.fn(),
  llmChatModel: "test-model",
  hasLlm: () => false,
}));

import { suggestActionMetadata } from "./actions";

beforeEach(() => {
  state.results = {
    suggested_actions: { data: [{ topics: ["Platform"] }], error: null },
    people: {
      data: [{ id: "person-1", display_name: "Ada Lovelace" }],
      error: null,
    },
  };
});

describe("suggestActionMetadata context reads", () => {
  it("returns a visible error when existing action topics cannot be read", async () => {
    state.results.suggested_actions = { data: null, error: { message: "database unavailable" } };

    await expect(suggestActionMetadata("Platform follow-up")).resolves.toEqual({
      ok: false,
      error: "Could not read action topics: database unavailable",
    });
  });

  it("returns a visible error when the people directory cannot be read", async () => {
    state.results.people = { data: null, error: { message: "RLS policy rejected read" } };

    await expect(suggestActionMetadata("Follow up with Ada Lovelace")).resolves.toEqual({
      ok: false,
      error: "Could not read people for action suggestions: RLS policy rejected read",
    });
  });

  it("uses tenant context when both reads succeed", async () => {
    const result = await suggestActionMetadata("Platform follow-up with Ada Lovelace");

    expect(result.ok).toBe(true);
    expect(result.suggestions?.topics).toEqual(["Platform"]);
    expect(result.suggestions?.people).toEqual([
      { id: "person-1", displayName: "Ada Lovelace" },
    ]);
  });
});
