/**
 * The action detail surface must distinguish a missing action from failed
 * reads. Empty evidence or topic context looks plausible, but is misleading.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: Record<string, unknown>[] | Record<string, unknown> | null;
  error: { message: string } | null;
};

const state = vi.hoisted(() => ({
  results: [] as QueryResult[],
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

function makeBuilder() {
  const result = state.results.shift() ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq"]) builder[method] = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: QueryResult) => unknown) => resolve(result);
  return builder;
}

vi.mock("next/navigation", () => ({ notFound: state.notFound }));
vi.mock("@/modules/identity-tenant/server", () => ({
  requireTenantContext: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: () => makeBuilder() }),
}));
vi.mock("@/modules/people/people-server", () => ({ listPeopleDirectory: () => [] }));
import ActionDetailPage from "./[id]/page";

const action = {
  id: "action-1",
  status: "pending",
  title: "Follow up",
  rationale: null,
  due_at: null,
  person_id: null,
  created_at: "2026-08-08T00:00:00Z",
  description: null,
  follow_up_at: null,
  priority: null,
  completed_at: null,
  snoozed_until: null,
  created_by: null,
  created_from: null,
  topics: [],
  snooze_metadata: null,
  completion_metadata: null,
  documents: [],
};

beforeEach(() => {
  state.results = [];
  state.notFound.mockClear();
});

describe("ActionDetailPage read integrity", () => {
  it("uses not-found only when the action is genuinely absent", async () => {
    state.results = [{ data: null, error: null }];

    await expect(ActionDetailPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(state.notFound).toHaveBeenCalledOnce();
  });

  it("surfaces a primary action read failure", async () => {
    state.results = [{ data: null, error: { message: "database unavailable" } }];

    await expect(ActionDetailPage({ params: Promise.resolve({ id: "action-1" }) })).rejects.toThrow(
      "Could not read action: database unavailable",
    );
    expect(state.notFound).not.toHaveBeenCalled();
  });

  it("surfaces an evidence read failure instead of showing no references", async () => {
    state.results = [
      { data: action, error: null },
      { data: null, error: { message: "RLS policy rejected read" } },
    ];

    await expect(ActionDetailPage({ params: Promise.resolve({ id: "action-1" }) })).rejects.toThrow(
      "Could not read action references: RLS policy rejected read",
    );
  });

  it("surfaces a topic read failure instead of showing empty autocomplete context", async () => {
    state.results = [
      { data: action, error: null },
      { data: [], error: null },
      { data: null, error: { message: "database unavailable" } },
    ];

    await expect(ActionDetailPage({ params: Promise.resolve({ id: "action-1" }) })).rejects.toThrow(
      "Could not read action topics: database unavailable",
    );
  });
});
