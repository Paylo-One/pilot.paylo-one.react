/**
 * modules/identity-tenant/tenant-isolation.integration.test.ts
 *
 * RUNTIME tenant-isolation test — the companion to the static
 * `rls-invariants.test.ts`. Where the static test proves policy *coverage*,
 * this proves policy *enforcement*: a user who belongs only to tenant A must
 * never be able to read tenant B's rows through the PostgREST/authenticated
 * path.
 *
 * Requires a live Supabase test database with the migrations applied. It is
 * skipped unless all three env vars are present, so it never false-fails the
 * default (no-DB) suite:
 *   - SUPABASE_TEST_URL           (e.g. http://127.0.0.1:54321)
 *   - SUPABASE_TEST_SERVICE_KEY   (service_role key — seeds + cleans up)
 *   - SUPABASE_TEST_ANON_KEY      (anon/publishable key — the user clients)
 *
 * NOTE: authored against the tenancy schema in
 * `supabase/migrations/20260607160001_tenancy_core.sql` (tenants, tenant_users,
 * auth_tenant_ids()). It has NOT been executed in this environment (no test DB
 * available); run it against a seeded Supabase instance before relying on it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

// A stable, obviously-synthetic marker so seeded rows are easy to clean up.
const RUN = "rls-itest";

type Seed = { tenantId: string; userId: string; email: string; password: string; sectionId: string };

describe.skipIf(!hasEnv)("tenant isolation (runtime RLS enforcement)", () => {
  // Created in beforeAll, not at collection time: `describe.skipIf` still
  // evaluates this body, so constructing the client here with an absent URL
  // would throw during collection even when the suite is skipped.
  let admin: SupabaseClient;
  const seeds: Seed[] = [];

  async function seedTenant(label: string): Promise<Seed> {
    const email = `${RUN}-${label}-${Math.abs(hashLabel(label))}@example.test`;
    const password = `${RUN}-${label}-pw-123456`;

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !created.user) throw userErr ?? new Error("user create failed");
    const userId = created.user.id;

    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: `${RUN}-${label}`, slug: `${RUN}-${label}-${userId.slice(0, 8)}` })
      .select("id")
      .single();
    if (tErr || !tenant) throw tErr ?? new Error("tenant insert failed");
    const tenantId = tenant.id as string;

    const { error: memErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
    if (memErr) throw memErr;

    // One tenant-owned row we can later try to read across the boundary.
    const { error: pErr } = await admin
      .from("people")
      .insert({ tenant_id: tenantId, display_name: `${RUN}-${label}-person` });
    if (pErr) throw pErr;

    const { data: briefing, error: briefingError } = await admin
      .from("briefings")
      .insert({ tenant_id: tenantId, status: "ready" })
      .select("id")
      .single();
    if (briefingError || !briefing) throw briefingError ?? new Error("briefing create failed");
    const { data: section, error: sectionError } = await admin
      .from("briefing_sections")
      .insert({ tenant_id: tenantId, briefing_id: briefing.id, kind: "decisions", title: `${RUN}-${label}-section` })
      .select("id")
      .single();
    if (sectionError || !section) throw sectionError ?? new Error("section create failed");
    const { error: referenceError } = await admin.from("source_references").insert({
      tenant_id: tenantId,
      briefing_section_id: section.id,
      source_system: "integration-test",
      excerpt_or_pointer: `${RUN}-${label}-evidence`,
    });
    if (referenceError) throw referenceError;

    return { tenantId, userId, email, password, sectionId: section.id as string };
  }

  async function userClient(seed: Seed): Promise<SupabaseClient> {
    const client = createClient(URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: seed.email,
      password: seed.password,
    });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    seeds.push(await seedTenant("a"));
    seeds.push(await seedTenant("b"));
  });

  afterAll(async () => {
    // Best-effort teardown (service role bypasses RLS).
    for (const s of seeds) {
      await admin.from("user_feedback_events").delete().eq("tenant_id", s.tenantId);
      await admin.from("suggested_actions").delete().eq("tenant_id", s.tenantId);
      await admin.from("briefings").delete().eq("tenant_id", s.tenantId);
      await admin.from("people").delete().eq("tenant_id", s.tenantId);
      await admin.from("tenant_users").delete().eq("tenant_id", s.tenantId);
      await admin.from("tenants").delete().eq("id", s.tenantId);
      await admin.auth.admin.deleteUser(s.userId);
    }
  });

  it("a member of tenant A reads only tenant A's people", async () => {
    const a = seeds[0]!;
    const b = seeds[1]!;
    const clientA = await userClient(a);
    const { data, error } = await clientA.from("people").select("tenant_id");
    expect(error).toBeNull();
    const tenantIds = new Set((data ?? []).map((r) => r.tenant_id as string));
    expect(tenantIds.has(a.tenantId)).toBe(true);
    expect(tenantIds.has(b.tenantId)).toBe(false);
  });

  it("a member of tenant A cannot read tenant B by filtering on B's id", async () => {
    const a = seeds[0]!;
    const b = seeds[1]!;
    const clientA = await userClient(a);
    const { data, error } = await clientA
      .from("people")
      .select("id")
      .eq("tenant_id", b.tenantId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0); // RLS filters to zero, not an error
  });

  it("attributes feedback writes to an allowed tenant and hides them from another tenant", async () => {
    const a = seeds[0]!;
    const b = seeds[1]!;
    const clientA = await userClient(a);
    const clientB = await userClient(b);
    const eventId = crypto.randomUUID();

    const { error: insertError } = await clientA.from("user_feedback_events").insert({
      id: eventId,
      tenant_id: a.tenantId,
      user_id: a.userId,
      feedback_type: "not_relevant",
      target_type: "memo_section",
      target_id: `${RUN}-section`,
    });
    expect(insertError).toBeNull();

    const { data: ownRows, error: ownError } = await clientA
      .from("user_feedback_events")
      .select("tenant_id, user_id")
      .eq("id", eventId);
    expect(ownError).toBeNull();
    expect(ownRows).toEqual([{ tenant_id: a.tenantId, user_id: a.userId }]);

    const { data: foreignRows, error: foreignError } = await clientB
      .from("user_feedback_events")
      .select("id")
      .eq("id", eventId);
    expect(foreignError).toBeNull();
    expect(foreignRows).toHaveLength(0);

    const { error: forgedInsertError } = await clientA.from("user_feedback_events").insert({
      tenant_id: b.tenantId,
      user_id: a.userId,
      feedback_type: "not_relevant",
      target_type: "memo_section",
      target_id: `${RUN}-forged-section`,
    });
    expect(forgedInsertError).not.toBeNull();

    const { error: forgedUserError } = await clientA.from("user_feedback_events").insert({
      tenant_id: a.tenantId,
      user_id: b.userId,
      feedback_type: "not_relevant",
      target_type: "memo_section",
      target_id: `${RUN}-forged-user`,
    });
    expect(forgedUserError).not.toBeNull();
  });

  it("preserves memo evidence atomically and rejects a foreign section", async () => {
    const a = seeds[0]!;
    const b = seeds[1]!;
    const clientA = await userClient(a);
    const handoffKey = "11111111-1111-4111-8111-111111111111";

    const { data: action, error: ownError } = await clientA.rpc(
      "create_action_from_briefing_section",
      {
        p_tenant_id: a.tenantId,
        p_section_id: a.sectionId,
        p_handoff_key: handoffKey,
        p_action: { title: `${RUN}-grounded-action`, status: "planned", priority: "normal" },
      },
    );
    expect(ownError).toBeNull();
    expect(action).toMatchObject({ tenant_id: a.tenantId, created_from: "briefing" });

    const { data: references, error: referencesError } = await clientA
      .from("source_references")
      .select("suggested_action_id, excerpt_or_pointer")
      .eq("suggested_action_id", action.id);
    expect(referencesError).toBeNull();
    expect(references).toEqual([{ suggested_action_id: action.id, excerpt_or_pointer: `${RUN}-a-evidence` }]);

    const { data: retriedAction, error: retryError } = await clientA.rpc(
      "create_action_from_briefing_section",
      {
        p_tenant_id: a.tenantId,
        p_section_id: a.sectionId,
        p_handoff_key: handoffKey,
        p_action: { title: `${RUN}-grounded-action`, status: "planned", priority: "normal" },
      },
    );
    expect(retryError).toBeNull();
    expect(retriedAction.id).toBe(action.id);

    const { count: retryCount } = await admin
      .from("suggested_actions")
      .select("id", { count: "exact", head: true })
      .eq("briefing_handoff_key", handoffKey);
    expect(retryCount).toBe(1);

    const concurrentKey = "44444444-4444-4444-8444-444444444444";
    const concurrentResults = await Promise.all([
      clientA.rpc("create_action_from_briefing_section", {
        p_tenant_id: a.tenantId,
        p_section_id: a.sectionId,
        p_handoff_key: concurrentKey,
        p_action: { title: `${RUN}-concurrent-action` },
      }),
      clientA.rpc("create_action_from_briefing_section", {
        p_tenant_id: a.tenantId,
        p_section_id: a.sectionId,
        p_handoff_key: concurrentKey,
        p_action: { title: `${RUN}-concurrent-action` },
      }),
    ]);
    expect(concurrentResults.every((result) => result.error === null)).toBe(true);
    expect(concurrentResults[0]!.data.id).toBe(concurrentResults[1]!.data.id);

    const { count: concurrentCount } = await admin
      .from("suggested_actions")
      .select("id", { count: "exact", head: true })
      .eq("briefing_handoff_key", concurrentKey);
    expect(concurrentCount).toBe(1);

    const { error: conflictingKeyError } = await clientA.rpc(
      "create_action_from_briefing_section",
      {
        p_tenant_id: a.tenantId,
        p_section_id: b.sectionId,
        p_handoff_key: handoffKey,
        p_action: { title: `${RUN}-conflicting-key` },
      },
    );
    expect(conflictingKeyError).not.toBeNull();

    const { error: foreignError } = await clientA.rpc(
      "create_action_from_briefing_section",
      {
        p_tenant_id: a.tenantId,
        p_section_id: b.sectionId,
        p_handoff_key: "22222222-2222-4222-8222-222222222222",
        p_action: { title: `${RUN}-forged-action` },
      },
    );
    expect(foreignError).not.toBeNull();

    const { count } = await admin
      .from("suggested_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", a.tenantId)
      .eq("title", `${RUN}-forged-action`);
    expect(count).toBe(0);

    const invalidPayloads: Array<{ key: string; action: unknown }> = [
      { key: "30000000-0000-4000-8000-000000000001", action: "not-an-object" },
      { key: "30000000-0000-4000-8000-000000000002", action: { title: "x".repeat(201) } },
      { key: "30000000-0000-4000-8000-000000000003", action: { title: "valid", description: "x".repeat(1001) } },
      { key: "30000000-0000-4000-8000-000000000004", action: { title: "valid", rationale: "x".repeat(2001) } },
      { key: "30000000-0000-4000-8000-000000000005", action: { title: "valid", topics: "not-an-array" } },
      { key: "30000000-0000-4000-8000-000000000006", action: { title: "valid", topics: Array(21).fill("topic") } },
      { key: "30000000-0000-4000-8000-000000000007", action: { title: "valid", topics: ["x".repeat(101)] } },
      { key: "30000000-0000-4000-8000-000000000008", action: { title: "valid", ignored: "x".repeat(33_000) } },
    ];

    for (const invalid of invalidPayloads) {
      const { error } = await clientA.rpc("create_action_from_briefing_section", {
        p_tenant_id: a.tenantId,
        p_section_id: a.sectionId,
        p_handoff_key: invalid.key,
        p_action: invalid.action,
      });
      expect(error, invalid.key).not.toBeNull();
    }

    const { error: missingKeyError } = await clientA.rpc("create_action_from_briefing_section", {
      p_tenant_id: a.tenantId,
      p_section_id: a.sectionId,
      p_handoff_key: null,
      p_action: { title: "valid" },
    });
    expect(missingKeyError).not.toBeNull();

    const { count: invalidCount } = await admin
      .from("suggested_actions")
      .select("id", { count: "exact", head: true })
      .in("briefing_handoff_key", invalidPayloads.map((invalid) => invalid.key));
    expect(invalidCount).toBe(0);
  });
});

/** Deterministic small hash so re-runs reuse stable synthetic emails. */
function hashLabel(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
