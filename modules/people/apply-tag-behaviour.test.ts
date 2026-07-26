/**
 * apply-tag-behaviour.test.ts — regression guard for the wired `suggest_action`
 * tag ("follow-up-required").
 *
 * The action state machine was rebuilt by migration 20260614120000, which
 * migrated the legacy status 'suggested' → 'inbox' and rebuilt the CHECK to
 * exclude 'suggested'. `applyTagBehaviour` still inserted `status: "suggested"`,
 * so every application of the follow-up tag was rejected by the DB CHECK and
 * threw — a wired feature that was 100% broken. This test pins the inserted
 * status to a value the current CHECK accepts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Statuses the live `suggested_actions_status_check` accepts. */
const VALID_ACTION_STATUSES = [
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "follow_up",
  "completed",
  "cancelled",
] as const;

const { insertCapture } = vi.hoisted(() => ({
  insertCapture: { value: null as Record<string, unknown> | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      from: (table: string) => {
        if (table === "people") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { display_name: "Dana Lee", importance_level: "normal" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "suggested_actions") {
          return {
            insert: (payload: Record<string, unknown>) => {
              insertCapture.value = payload;
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    }),
}));

import { applyTagBehaviour } from "./people-server";

beforeEach(() => {
  insertCapture.value = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("applyTagBehaviour — suggest_action (follow-up-required)", () => {
  const ctx = { tenantId: "11111111-1111-1111-1111-111111111111", userId: "u1" };

  it("inserts a follow-up action with a status the DB CHECK accepts (not the legacy 'suggested')", async () => {
    const effects = await applyTagBehaviour(ctx, "person-1", "follow-up-required");

    expect(insertCapture.value).not.toBeNull();
    const status = insertCapture.value?.status;
    expect(status).not.toBe("suggested");
    expect(VALID_ACTION_STATUSES).toContain(status as (typeof VALID_ACTION_STATUSES)[number]);
    expect(insertCapture.value?.created_from).toBe("people");
    expect(effects).toContain("A follow-up action has been proposed in Actions.");
  });
});
