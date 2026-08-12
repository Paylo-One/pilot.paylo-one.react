/**
 * people-suggestion-writes.test.ts — confirm/reject suggestion write contract.
 *
 * Resolving a person-link suggestion applies an operator's explicit identity
 * decision. Every write must fail loud: if the verified identity (or its
 * feedback) cannot be written, the suggestion must NOT be flipped out of the
 * pending queue, and the caller must throw so the UI shows an error instead of
 * a false "handled". The status flip is the authoritative "resolved" signal and
 * runs last.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { message: string } | null;

const state = vi.hoisted(() => ({
  suggestion: null as Record<string, unknown> | null,
  readError: null as Err,
  writeErrors: {} as Record<string, Err>,
  writes: [] as string[],
}));

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "upsert", "insert", "update", "in"]) {
    builder[method] = chain;
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: state.suggestion, error: state.readError });
  // Awaiting a write chain records the table (write order) and resolves to its
  // configured error. Reads terminate in maybeSingle and never hit this.
  builder.then = (resolve: (v: { error: Err }) => unknown) => {
    state.writes.push(table);
    return resolve({ error: state.writeErrors[table] ?? null });
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { confirmSuggestion, rejectSuggestion } from "./people-server";

beforeEach(() => {
  state.suggestion = {
    id: "sug1",
    candidate_person_id: "p1",
    source_system: "email",
    observed_identity: "alex@example.com",
    source_item_id: "item1",
  };
  state.readError = null;
  state.writeErrors = {};
  state.writes = [];
});

describe("confirmSuggestion (write contract)", () => {
  it("writes the verified identity before resolving the suggestion, and returns true", async () => {
    await expect(confirmSuggestion("t1", "sug1")).resolves.toBe(true);
    expect(state.writes).toEqual([
      "person_identities",
      "correlation_feedback",
      "person_link_suggestions",
    ]);
  });

  it("throws and does NOT resolve the suggestion when the identity write fails", async () => {
    state.writeErrors.person_identities = { message: "unique violation" };
    await expect(confirmSuggestion("t1", "sug1")).rejects.toThrow(/unique violation/);
    // The status flip must not have run — the suggestion stays pending.
    expect(state.writes).toEqual(["person_identities"]);
    expect(state.writes).not.toContain("person_link_suggestions");
  });

  it("throws when the final status flip fails (loud, not silent)", async () => {
    state.writeErrors.person_link_suggestions = { message: "db down" };
    await expect(confirmSuggestion("t1", "sug1")).rejects.toThrow(/db down/);
  });

  it("returns false without writing when the suggestion has no candidate person", async () => {
    state.suggestion = { ...state.suggestion, candidate_person_id: null };
    await expect(confirmSuggestion("t1", "sug1")).resolves.toBe(false);
    expect(state.writes).toEqual([]);
  });
});

describe("rejectSuggestion (write contract)", () => {
  it("records feedback then resolves the suggestion, and returns true", async () => {
    await expect(rejectSuggestion("t1", "sug1")).resolves.toBe(true);
    expect(state.writes).toEqual(["correlation_feedback", "person_link_suggestions"]);
  });

  it("throws and does NOT resolve the suggestion when feedback write fails", async () => {
    state.writeErrors.correlation_feedback = { message: "insert failed" };
    await expect(rejectSuggestion("t1", "sug1")).rejects.toThrow(/insert failed/);
    expect(state.writes).not.toContain("person_link_suggestions");
  });
});
