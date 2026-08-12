/**
 * company-link-suggestions-fail-loud.test.ts — correlation feeder-read contract.
 *
 * `generateCompanyLinkSuggestions` proposes person↔company `works_at` edges by
 * matching a person's verified email identity to a company domain. It is fed by
 * three reads (company_domains, person_identities, people). If any of those
 * reads errors and we swallow it, the pass silently under-generates (or returns
 * 0) and the operator reads "no new links to suggest" when the read actually
 * failed. Every feeder read must fail loud — the write-side continuation of the
 * 2026-07-30 read-path / 2026-08-01 people-suggestion fail-loud contract
 * (its follow-up #3).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { message: string } | null;

const state = vi.hoisted(() => ({
  rows: {} as Record<string, { data: unknown; error: Err }>,
}));

function makeBuilder(table: string) {
  const result = () => Promise.resolve(state.rows[table] ?? { data: [], error: null });
  const builder: Record<string, unknown> = {};
  // select()/eq() are chainable; awaiting the builder resolves to the table's row set.
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.then = (resolve: (v: { data: unknown; error: Err }) => unknown) =>
    result().then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

const upsertEntityLink = vi.hoisted(() => vi.fn(async () => "link1"));
vi.mock("@/modules/people/relationships", () => ({
  upsertEntityLink,
  listRelationshipsFor: vi.fn(async () => []),
}));

import { generateCompanyLinkSuggestions } from "./companies-server";

beforeEach(() => {
  upsertEntityLink.mockClear();
  state.rows = {
    company_domains: { data: [{ company_id: "c1", domain: "acme.com" }], error: null },
    person_identities: {
      data: [{ person_id: "p1", identity_value: "jacques@acme.com" }],
      error: null,
    },
    people: { data: [{ id: "p1", display_name: "Jacques", company_id: null }], error: null },
  };
});

describe("generateCompanyLinkSuggestions (feeder-read contract)", () => {
  it("proposes a works_at edge when an email domain matches a company domain", async () => {
    const added = await generateCompanyLinkSuggestions("t1");
    expect(added).toBe(1);
    expect(upsertEntityLink).toHaveBeenCalledTimes(1);
    expect(upsertEntityLink).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        sourceType: "person",
        sourceId: "p1",
        targetType: "company",
        targetId: "c1",
        relationshipType: "works_at",
        status: "suggested",
      }),
    );
  });

  it("skips a person already linked to that company (no suggestion)", async () => {
    state.rows.people = {
      data: [{ id: "p1", display_name: "Jacques", company_id: "c1" }],
      error: null,
    };
    const added = await generateCompanyLinkSuggestions("t1");
    expect(added).toBe(0);
    expect(upsertEntityLink).not.toHaveBeenCalled();
  });

  it("throws (not returns 0) when the company_domains read errors", async () => {
    state.rows.company_domains = { data: null, error: { message: "domains boom" } };
    await expect(generateCompanyLinkSuggestions("t1")).rejects.toThrow("domains boom");
    expect(upsertEntityLink).not.toHaveBeenCalled();
  });

  it("throws when the person_identities read errors", async () => {
    state.rows.person_identities = { data: null, error: { message: "identities boom" } };
    await expect(generateCompanyLinkSuggestions("t1")).rejects.toThrow("identities boom");
    expect(upsertEntityLink).not.toHaveBeenCalled();
  });

  it("throws when the people read errors", async () => {
    state.rows.people = { data: null, error: { message: "people boom" } };
    await expect(generateCompanyLinkSuggestions("t1")).rejects.toThrow("people boom");
    expect(upsertEntityLink).not.toHaveBeenCalled();
  });
});
