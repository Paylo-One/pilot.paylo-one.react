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

type Seed = { tenantId: string; userId: string; email: string; password: string };

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

    return { tenantId, userId, email, password };
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
});

/** Deterministic small hash so re-runs reuse stable synthetic emails. */
function hashLabel(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
