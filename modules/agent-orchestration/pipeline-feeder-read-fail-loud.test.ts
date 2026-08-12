/**
 * pipeline-feeder-read-fail-loud.test.ts — intelligence-pipeline feeder-read contract.
 *
 * The 2026-08-03 ADR hardened the WRITE side of the non-grounding pipeline
 * agents (people memory, diary reflection, weekly operating review) so a failed
 * persist can no longer be audited as a clean run. Its follow-up #2 flagged the
 * read-side complement: three feeder reads still destructured only `data` and
 * swallowed `error`, so a transient DB/RLS read failure silently
 *   - dropped the whole run's relationship memory (people read → empty name map,
 *     `noted: 0`, run audited as a clean pass);
 *   - skipped the private weekly reflection (diary read → looks like "no
 *     entries");
 *   - produced an empty or silently-partial weekly operating review (any of the
 *     four review reads → the review omits a whole dimension yet is audited as
 *     complete over `considered: lines.length`).
 *
 * Every feeder read must now fail loud (return an `internal` error) before the
 * audit record, mirroring the write-side hardening. Happy paths are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { message: string } | null;

const state = vi.hoisted(() => ({
  rows: {} as Record<string, { data: unknown; error: Err }>,
  invokeResult: null as unknown,
}));

// A chainable Supabase builder: every query method returns the builder, and
// awaiting it resolves to the table's configured { data, error }. insert/upsert
// resolve to the same shape (writes read only `error`).
function makeBuilder(table: string) {
  const result = () =>
    Promise.resolve(state.rows[table] ?? { data: [], error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.insert = () => result();
  builder.upsert = () => result();
  builder.then = (resolve: (v: { data: unknown; error: Err }) => unknown) =>
    result().then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/modules/model-gateway", () => ({
  modelGateway: { invoke },
}));

const listRecentSourceItems = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown[]> => []),
);
vi.mock("@/modules/knowledge-store/server", () => ({
  listRecentSourceItems,
  listMemoSourceItems: vi.fn(async () => []),
}));

const auditRecord = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/modules/audit", () => ({
  auditService: { record: auditRecord },
}));

// Side-effectful top-level imports of index.ts that these three agents never
// touch — stubbed so importing the module is hermetic.
vi.mock("@/modules/news/briefing", () => ({
  appendExternalSignalsToBriefing: vi.fn(async () => {}),
}));
vi.mock("@/modules/action-extraction/dedupe", () => ({
  dedupeAndPersistSuggestedActions: vi.fn(async () => ({ inserted: 0 })),
}));
vi.mock("@/modules/notification/server", () => ({
  recordNotification: vi.fn(async () => {}),
}));
vi.mock("@/modules/briefing/server", () => ({
  checkBriefingLimit: vi.fn(async () => ({ allowed: true })),
}));

import { agentOrchestrationService } from "./index";

const ctx = {
  tenantId: "t1",
  tenantSlug: "acme",
  userId: "u1",
  role: "owner",
} as const;

function invokeOk(output: unknown) {
  return { ok: true, value: { output, promptVersionDbId: "pv1" } };
}

beforeEach(() => {
  invoke.mockReset();
  auditRecord.mockClear();
  listRecentSourceItems.mockReset();
  listRecentSourceItems.mockResolvedValue([]);
  state.rows = {};
});

describe("runPeopleMemory feeder-read contract", () => {
  const oneItem = [
    {
      id: "s1",
      system: "gmail",
      title: "Sync",
      body: "Jacques committed to the migration.",
      author: null,
      occurredAt: "2026-08-05T08:00:00.000Z",
      createdAt: "2026-08-05T08:00:00.000Z",
    },
  ];

  it("notes a matched person and audits the run on the happy path", async () => {
    listRecentSourceItems.mockResolvedValue(oneItem);
    invoke.mockResolvedValue(
      invokeOk({
        people: [{ name: "Jacques", commitments: ["ship migration"], concerns: [], context: "" }],
      }),
    );
    state.rows.people = {
      data: [{ id: "p1", display_name: "Jacques" }],
      error: null,
    };
    state.rows.person_notes = { data: null, error: null };

    const res = await agentOrchestrationService.run(ctx, { kind: "people_memory" });
    expect(res.ok).toBe(true);
    expect(auditRecord).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: "pipeline.people_memory.run",
        metadata: expect.objectContaining({ noted: 1, failedWrites: 0 }),
      }),
    );
  });

  it("fails loud (does not audit) when the people name-match read errors", async () => {
    listRecentSourceItems.mockResolvedValue(oneItem);
    invoke.mockResolvedValue(
      invokeOk({ people: [{ name: "Jacques", commitments: ["x"], concerns: [], context: "" }] }),
    );
    state.rows.people = { data: null, error: { message: "people boom" } };

    const res = await agentOrchestrationService.run(ctx, { kind: "people_memory" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("internal");
      expect(res.error.message).toBe("people boom");
    }
    expect(auditRecord).not.toHaveBeenCalled();
  });
});

describe("runDiaryReflection feeder-read contract", () => {
  it("fails loud (before invoking the model) when the entries read errors", async () => {
    state.rows.diary_entries = { data: null, error: { message: "diary boom" } };

    const res = await agentOrchestrationService.run(ctx, {
      kind: "diary_reflection",
      input: { userId: "author-1" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("internal");
      expect(res.error.message).toBe("diary boom");
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("returns a clean run without invoking the model when the author has no entries", async () => {
    state.rows.diary_entries = { data: [], error: null };

    const res = await agentOrchestrationService.run(ctx, {
      kind: "diary_reflection",
      input: { userId: "author-1" },
    });
    expect(res.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("runWeeklyOperatingReview feeder-read contract", () => {
  const okReads = () => {
    state.rows.signals = { data: [], error: null };
    state.rows.decisions = { data: [], error: null };
    state.rows.risks = { data: [], error: null };
    state.rows.suggested_actions = { data: [], error: null };
  };

  it("returns a clean run without invoking the model when the week is empty", async () => {
    okReads();
    const res = await agentOrchestrationService.run(ctx, {
      kind: "weekly_operating_review",
    });
    expect(res.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  for (const [table, message] of [
    ["signals", "signals boom"],
    ["decisions", "decisions boom"],
    ["risks", "risks boom"],
    ["suggested_actions", "actions boom"],
  ] as const) {
    it(`fails loud (before invoking the model) when the ${table} read errors`, async () => {
      okReads();
      state.rows[table] = { data: null, error: { message } };

      const res = await agentOrchestrationService.run(ctx, {
        kind: "weekly_operating_review",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("internal");
        expect(res.error.message).toBe(message);
      }
      expect(invoke).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  }
});
