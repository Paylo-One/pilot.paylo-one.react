/**
 * server.test.ts — unit tests for the server-only tenant-context resolution
 * and provisioning implementation. Supabase clients, next/headers,
 * next/navigation, config and provisioning side-effect modules are mocked;
 * lib/tenant/host stays real (pure).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  headerGet: vi.fn(),
  redirect: vi.fn(),
  serverFrom: vi.fn(),
  secretFrom: vi.fn(),
  seedTenantPrompts: vi.fn(),
  createTrialBillingAccess: vi.fn(),
  getOrCreateForOwner: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    from: mocks.serverFrom,
  }),
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({ from: mocks.secretFrom }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: mocks.headerGet }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/config", () => ({
  appHostBaseUrl: () => "https://app.paylo.test",
  tenantBaseUrl: (slug: string) => `https://${slug}.paylo.test`,
}));

vi.mock("@/modules/prompt-versioning/server", () => ({
  seedTenantPrompts: mocks.seedTenantPrompts,
}));

vi.mock("@/modules/referral", () => ({
  referralService: { getOrCreateForOwner: mocks.getOrCreateForOwner },
}));

vi.mock("@/modules/billing/access", () => ({
  createTrialBillingAccess: mocks.createTrialBillingAccess,
}));

import {
  findPrimaryTenantSlug,
  getSignedInUser,
  isSubdomainAvailable,
  provisionTenantForUser,
  requireTenantContext,
  requireTenantContextForAccessGate,
  resolveTenantContext,
} from "./server";

/* ------------------------------------------------------------------------ */
/* Chainable Supabase stub                                                    */
/* ------------------------------------------------------------------------ */

interface TableResult {
  data?: unknown;
  error?: { message: string } | null;
}

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface TableAccess {
  table: string;
  calls: RecordedCall[];
}

/**
 * Minimal chainable PostgREST builder: every method returns the chain and is
 * recorded; awaiting the chain (or calling single/maybeSingle) resolves the
 * next queued result for that table (FIFO), defaulting to { data: null }.
 */
function createSupabaseStub() {
  const queues = new Map<string, TableResult[]>();
  const log: TableAccess[] = [];

  const queue = (table: string, result: TableResult): void => {
    const q = queues.get(table) ?? [];
    q.push(result);
    queues.set(table, q);
  };

  const from = (table: string): unknown => {
    const access: TableAccess = { table, calls: [] };
    log.push(access);
    let settled: TableResult | undefined;
    const respond = (): TableResult => {
      if (settled === undefined) {
        const q = queues.get(table);
        settled =
          q !== undefined && q.length > 0
            ? q.shift()!
            : { data: null, error: null };
      }
      return { data: null, error: null, ...settled };
    };
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: TableResult) => void) =>
              resolve(respond());
          }
          return (...args: unknown[]) => {
            access.calls.push({ method: String(prop), args });
            if (prop === "single" || prop === "maybeSingle") {
              return Promise.resolve(respond());
            }
            return chain;
          };
        },
      },
    );
    return chain;
  };

  return { queue, log, from };
}

type SupabaseStub = ReturnType<typeof createSupabaseStub>;

/** Tables that received an insert/upsert, with the payload, in call order. */
function writeOps(
  stub: SupabaseStub,
): Array<{ table: string; method: string; payload: unknown }> {
  const ops: Array<{ table: string; method: string; payload: unknown }> = [];
  for (const access of stub.log) {
    for (const call of access.calls) {
      if (call.method === "insert" || call.method === "upsert") {
        ops.push({ table: access.table, method: call.method, payload: call.args[0] });
      }
    }
  }
  return ops;
}

/** eq(...) argument pairs recorded for a table (across all accesses). */
function eqCalls(stub: SupabaseStub, table: string): unknown[][] {
  return stub.log
    .filter((a) => a.table === table)
    .flatMap((a) => a.calls.filter((c) => c.method === "eq").map((c) => c.args));
}

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------ */

const USER_ID = "user-1";
const EMAIL = "bernard@example.com";

let serverDb: SupabaseStub;
let secretDb: SupabaseStub;

function signIn(claims: Record<string, unknown> | null = { sub: USER_ID, email: EMAIL }): void {
  mocks.getClaims.mockResolvedValue({ data: claims ? { claims } : { claims: undefined } });
}

function onTenantHost(slug: string | null): void {
  mocks.headerGet.mockImplementation((name: string) =>
    name === "x-paylo-tenant-slug" ? slug : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serverDb = createSupabaseStub();
  secretDb = createSupabaseStub();
  mocks.serverFrom.mockImplementation(serverDb.from);
  mocks.secretFrom.mockImplementation(secretDb.from);
  mocks.redirect.mockImplementation((url: string) => {
    // next/navigation redirect() throws; model that so control flow matches.
    throw new Error(`REDIRECT:${url}`);
  });
  mocks.seedTenantPrompts.mockResolvedValue(undefined);
  mocks.createTrialBillingAccess.mockResolvedValue(undefined);
  mocks.getOrCreateForOwner.mockResolvedValue(undefined);
  signIn();
  onTenantHost(null);
});

/* ------------------------------------------------------------------------ */
/* getSignedInUser                                                            */
/* ------------------------------------------------------------------------ */

describe("getSignedInUser", () => {
  it("returns userId and email from verified claims", async () => {
    signIn({ sub: USER_ID, email: EMAIL });
    await expect(getSignedInUser()).resolves.toEqual({
      userId: USER_ID,
      email: EMAIL,
    });
  });

  it("returns null when getClaims throws (stale refresh token)", async () => {
    mocks.getClaims.mockRejectedValue(new Error("refresh_token_not_found"));
    await expect(getSignedInUser()).resolves.toBeNull();
  });

  it("returns null when claims lack a sub", async () => {
    signIn({ email: EMAIL });
    await expect(getSignedInUser()).resolves.toBeNull();
  });

  it("returns null when there are no claims at all", async () => {
    signIn(null);
    await expect(getSignedInUser()).resolves.toBeNull();
  });

  it("returns a null email when the claim is missing", async () => {
    signIn({ sub: USER_ID });
    await expect(getSignedInUser()).resolves.toEqual({
      userId: USER_ID,
      email: null,
    });
  });
});

/* ------------------------------------------------------------------------ */
/* resolveTenantContext                                                       */
/* ------------------------------------------------------------------------ */

describe("resolveTenantContext", () => {
  it("returns unauthenticated when there is no signed-in user", async () => {
    signIn(null);
    await expect(resolveTenantContext()).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("returns no_tenant_host when the slug header is absent", async () => {
    onTenantHost(null);
    await expect(resolveTenantContext()).resolves.toEqual({
      kind: "no_tenant_host",
      user: { userId: USER_ID, email: EMAIL },
    });
  });

  it("returns forbidden when the tenant row is not visible (RLS/no row)", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", { data: null });
    await expect(resolveTenantContext()).resolves.toEqual({
      kind: "forbidden",
      user: { userId: USER_ID, email: EMAIL },
      slug: "acme",
    });
  });

  it("returns forbidden for a suspended tenant by default", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", {
      data: { id: "t-1", slug: "acme", status: "suspended" },
    });
    const result = await resolveTenantContext();
    expect(result.kind).toBe("forbidden");
    // Membership must not even be consulted.
    expect(serverDb.log.some((a) => a.table === "tenant_users")).toBe(false);
  });

  it("proceeds to the membership check for a suspended tenant when allowSuspended", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", {
      data: { id: "t-1", slug: "acme", status: "suspended" },
    });
    serverDb.queue("tenant_users", { data: { role: "owner" } });
    await expect(
      resolveTenantContext({ allowSuspended: true }),
    ).resolves.toEqual({
      kind: "ok",
      context: {
        tenantId: "t-1",
        tenantSlug: "acme",
        userId: USER_ID,
        role: "owner",
      },
    });
  });

  it("returns forbidden when the membership row is missing", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", {
      data: { id: "t-1", slug: "acme", status: "active" },
    });
    serverDb.queue("tenant_users", { data: null });
    await expect(resolveTenantContext()).resolves.toEqual({
      kind: "forbidden",
      user: { userId: USER_ID, email: EMAIL },
      slug: "acme",
    });
  });

  it("returns ok with the full TenantContext on the happy path", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", {
      data: { id: "t-1", slug: "acme", status: "active" },
    });
    serverDb.queue("tenant_users", { data: { role: "member" } });

    await expect(resolveTenantContext()).resolves.toEqual({
      kind: "ok",
      context: {
        tenantId: "t-1",
        tenantSlug: "acme",
        userId: USER_ID,
        role: "member",
      },
    });

    // Queried through the user's RLS-scoped client with explicit predicates.
    expect(eqCalls(serverDb, "tenants")).toEqual([["slug", "acme"]]);
    expect(eqCalls(serverDb, "tenant_users")).toEqual([
      ["tenant_id", "t-1"],
      ["user_id", USER_ID],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* requireTenantContext / requireTenantContextForAccessGate                   */
/* ------------------------------------------------------------------------ */

describe.each([
  ["requireTenantContext", requireTenantContext, false],
  ["requireTenantContextForAccessGate", requireTenantContextForAccessGate, true],
] as const)("%s", (_name, requireFn, allowsSuspended) => {
  it("redirects to sign-in when unauthenticated", async () => {
    signIn(null);
    await expect(requireFn()).rejects.toThrow(
      "REDIRECT:https://app.paylo.test/sign-in",
    );
  });

  it("redirects to onboarding when not on a tenant host", async () => {
    onTenantHost(null);
    await expect(requireFn()).rejects.toThrow(
      "REDIRECT:https://app.paylo.test/onboarding",
    );
  });

  it("redirects to sign-in with not_a_member when forbidden", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", { data: null });
    await expect(requireFn()).rejects.toThrow(
      "REDIRECT:https://app.paylo.test/sign-in?error=not_a_member",
    );
  });

  it("returns the context when resolution is ok", async () => {
    onTenantHost("acme");
    serverDb.queue("tenants", {
      data: { id: "t-1", slug: "acme", status: "active" },
    });
    serverDb.queue("tenant_users", { data: { role: "owner" } });
    await expect(requireFn()).resolves.toEqual({
      tenantId: "t-1",
      tenantSlug: "acme",
      userId: USER_ID,
      role: "owner",
    });
  });

  it(
    allowsSuspended
      ? "returns the context for a suspended tenant (access-gate variant)"
      : "redirects for a suspended tenant (default variant)",
    async () => {
      onTenantHost("acme");
      serverDb.queue("tenants", {
        data: { id: "t-1", slug: "acme", status: "suspended" },
      });
      serverDb.queue("tenant_users", { data: { role: "owner" } });
      if (allowsSuspended) {
        await expect(requireFn()).resolves.toMatchObject({ tenantId: "t-1" });
      } else {
        await expect(requireFn()).rejects.toThrow(
          "REDIRECT:https://app.paylo.test/sign-in?error=not_a_member",
        );
      }
    },
  );
});

/* ------------------------------------------------------------------------ */
/* isSubdomainAvailable                                                       */
/* ------------------------------------------------------------------------ */

describe("isSubdomainAvailable", () => {
  it("returns false for an invalid slug without querying the database", async () => {
    await expect(isSubdomainAvailable("ab")).resolves.toBe(false);
    await expect(isSubdomainAvailable("-bad-")).resolves.toBe(false);
    await expect(isSubdomainAvailable("bad_slug!")).resolves.toBe(false);
    expect(mocks.secretFrom).not.toHaveBeenCalled();
  });

  it("returns false for a reserved slug without querying the database", async () => {
    await expect(isSubdomainAvailable("www")).resolves.toBe(false);
    await expect(isSubdomainAvailable("admin")).resolves.toBe(false);
    expect(mocks.secretFrom).not.toHaveBeenCalled();
  });

  it("returns false when the subdomain is already taken", async () => {
    secretDb.queue("tenant_domains", { data: { id: "dom-1" } });
    await expect(isSubdomainAvailable("acme")).resolves.toBe(false);
  });

  it("returns true when no tenant_domains row exists", async () => {
    secretDb.queue("tenant_domains", { data: null });
    await expect(isSubdomainAvailable("acme")).resolves.toBe(true);
  });

  it("normalises uppercase and surrounding whitespace before checking", async () => {
    secretDb.queue("tenant_domains", { data: null });
    await expect(isSubdomainAvailable("  ACME  ")).resolves.toBe(true);
    expect(eqCalls(secretDb, "tenant_domains")).toEqual([
      ["subdomain", "acme"],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* findPrimaryTenantSlug                                                      */
/* ------------------------------------------------------------------------ */

describe("findPrimaryTenantSlug", () => {
  it("returns null when the user has no membership", async () => {
    secretDb.queue("tenant_users", { data: null });
    await expect(findPrimaryTenantSlug(USER_ID)).resolves.toBeNull();
    expect(secretDb.log.some((a) => a.table === "tenants")).toBe(false);
  });

  it("returns null when the membership's tenant is not active", async () => {
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } });
    secretDb.queue("tenants", { data: null }); // filtered out by status=active
    await expect(findPrimaryTenantSlug(USER_ID)).resolves.toBeNull();
  });

  it("returns the slug of the active primary tenant", async () => {
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } });
    secretDb.queue("tenants", { data: { slug: "acme" } });
    await expect(findPrimaryTenantSlug(USER_ID)).resolves.toBe("acme");
    expect(eqCalls(secretDb, "tenant_users")).toEqual([["user_id", USER_ID]]);
    expect(eqCalls(secretDb, "tenants")).toEqual([
      ["id", "t-1"],
      ["status", "active"],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* provisionTenantForUser                                                     */
/* ------------------------------------------------------------------------ */

describe("provisionTenantForUser", () => {
  const input = {
    userId: USER_ID,
    email: EMAIL,
    desiredSubdomain: "acme",
  };

  it("throws invalid_subdomain for a syntactically invalid subdomain", async () => {
    await expect(
      provisionTenantForUser({ ...input, desiredSubdomain: "bad_slug!" }),
    ).rejects.toThrow("invalid_subdomain");
    expect(mocks.secretFrom).not.toHaveBeenCalled();
  });

  it("throws invalid_subdomain for a reserved subdomain", async () => {
    await expect(
      provisionTenantForUser({ ...input, desiredSubdomain: "admin" }),
    ).rejects.toThrow("invalid_subdomain");
  });

  it("normalises the desired subdomain (uppercase/whitespace) before use", async () => {
    // Existing tenant path so we can observe normalisation without inserts.
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } });
    secretDb.queue("tenants", { data: { slug: "acme" } });
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } });
    await expect(
      provisionTenantForUser({ ...input, desiredSubdomain: "  ACME " }),
    ).resolves.toMatchObject({ slug: "acme" });
  });

  it("returns the existing workspace without any insert when already provisioned", async () => {
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } }); // findPrimaryTenantSlug
    secretDb.queue("tenants", { data: { slug: "acme" } });
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } }); // membership re-read

    await expect(provisionTenantForUser(input)).resolves.toEqual({
      tenantId: "t-1",
      slug: "acme",
      redirectTo: "https://acme.paylo.test",
    });
    expect(writeOps(secretDb)).toEqual([]);
    expect(mocks.seedTenantPrompts).not.toHaveBeenCalled();
    expect(mocks.createTrialBillingAccess).not.toHaveBeenCalled();
  });

  it("throws tenant_membership_missing when the membership re-read vanishes", async () => {
    secretDb.queue("tenant_users", { data: { tenant_id: "t-1" } });
    secretDb.queue("tenants", { data: { slug: "acme" } });
    secretDb.queue("tenant_users", { data: null });
    await expect(provisionTenantForUser(input)).rejects.toThrow(
      "tenant_membership_missing",
    );
  });

  it("throws subdomain_taken when the subdomain is already claimed", async () => {
    secretDb.queue("tenant_users", { data: null }); // no existing tenant
    secretDb.queue("tenant_domains", { data: { id: "dom-1" } }); // taken
    await expect(provisionTenantForUser(input)).rejects.toThrow(
      "subdomain_taken",
    );
    expect(writeOps(secretDb)).toEqual([]);
  });

  function queueHappyPath(): void {
    secretDb.queue("tenant_users", { data: null }); // findPrimaryTenantSlug: none
    secretDb.queue("tenant_domains", { data: null }); // availability: free
    secretDb.queue("tenants", { data: { id: "t-new", slug: "acme" } }); // insert
    // tenant_users insert, tenant_domains insert, user_profiles upsert and
    // audit_events inserts fall through to the default { error: null }.
  }

  it("provisions tenant → membership → domain → profile in order and returns redirectTo", async () => {
    queueHappyPath();

    await expect(
      provisionTenantForUser({ ...input, tenantName: "  Acme Inc  ", displayName: "Bernard" }),
    ).resolves.toEqual({
      tenantId: "t-new",
      slug: "acme",
      redirectTo: "https://acme.paylo.test",
    });

    const ops = writeOps(secretDb);
    expect(ops.map((o) => `${o.table}:${o.method}`)).toEqual([
      "tenants:insert",
      "tenant_users:insert",
      "tenant_domains:insert",
      "user_profiles:upsert",
      "audit_events:insert", // prompt.defaults.seeded
      "audit_events:insert", // tenant.provisioned
    ]);
    expect(ops[0]!.payload).toEqual({
      slug: "acme",
      name: "Acme Inc",
      status: "active",
    });
    expect(ops[1]!.payload).toEqual({
      tenant_id: "t-new",
      user_id: USER_ID,
      role: "owner",
    });
    expect(ops[2]!.payload).toEqual({
      tenant_id: "t-new",
      kind: "subdomain",
      subdomain: "acme",
      is_primary: true,
      verified: true,
    });
    expect(ops[3]!.payload).toEqual({
      user_id: USER_ID,
      display_name: "Bernard",
      default_tenant_id: "t-new",
    });
    expect(ops[5]!.payload).toMatchObject({ action: "tenant.provisioned", target: "acme" });

    expect(mocks.seedTenantPrompts).toHaveBeenCalledWith("t-new", USER_ID);
    expect(mocks.createTrialBillingAccess).toHaveBeenCalledWith({
      tenantId: "t-new",
      userId: USER_ID,
    });
    expect(mocks.getOrCreateForOwner).toHaveBeenCalledWith(USER_ID, "t-new");
  });

  it("defaults the tenant name to the slug and display name to the email", async () => {
    queueHappyPath();
    await provisionTenantForUser(input);
    const ops = writeOps(secretDb);
    expect(ops[0]!.payload).toMatchObject({ name: "acme" });
    expect(ops[3]!.payload).toMatchObject({ display_name: EMAIL });
  });

  it("stores a null display name when neither display name nor email exists", async () => {
    queueHappyPath();

    await provisionTenantForUser({
      ...input,
      email: null,
      displayName: undefined,
    });

    const profile = writeOps(secretDb).find((op) => op.table === "user_profiles");
    expect(profile?.payload).toMatchObject({ display_name: null });
  });

  it("does not fail provisioning when prompt seeding fails (and skips its audit)", async () => {
    queueHappyPath();
    mocks.seedTenantPrompts.mockRejectedValue(new Error("seed boom"));

    await expect(provisionTenantForUser(input)).resolves.toMatchObject({
      tenantId: "t-new",
    });

    const audits = writeOps(secretDb).filter((o) => o.table === "audit_events");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ action: "tenant.provisioned" });
  });

  it("audits but does not throw when trial billing initialisation fails", async () => {
    queueHappyPath();
    mocks.createTrialBillingAccess.mockRejectedValue(new Error("stripe down"));

    await expect(provisionTenantForUser(input)).resolves.toMatchObject({
      tenantId: "t-new",
    });

    const audits = writeOps(secretDb).filter((o) => o.table === "audit_events");
    expect(
      audits.map((a) => (a.payload as { action: string }).action),
    ).toContain("billing.trial_initialisation_failed");
  });

  it("treats a referral-code failure as non-fatal", async () => {
    queueHappyPath();
    mocks.getOrCreateForOwner.mockRejectedValue(new Error("referral down"));
    await expect(provisionTenantForUser(input)).resolves.toMatchObject({
      tenantId: "t-new",
      redirectTo: "https://acme.paylo.test",
    });
  });

  it("propagates a tenant insert error", async () => {
    secretDb.queue("tenant_users", { data: null });
    secretDb.queue("tenant_domains", { data: null });
    secretDb.queue("tenants", { data: null, error: { message: "tenant boom" } });
    await expect(provisionTenantForUser(input)).rejects.toThrow("tenant boom");
  });

  it("throws tenant_create_failed when the insert returns neither row nor error", async () => {
    secretDb.queue("tenant_users", { data: null });
    secretDb.queue("tenant_domains", { data: null });
    secretDb.queue("tenants", { data: null, error: null });
    await expect(provisionTenantForUser(input)).rejects.toThrow(
      "tenant_create_failed",
    );
  });

  it("propagates a membership insert error", async () => {
    secretDb.queue("tenant_users", { data: null }); // findPrimaryTenantSlug
    secretDb.queue("tenant_domains", { data: null }); // availability
    secretDb.queue("tenants", { data: { id: "t-new", slug: "acme" } });
    secretDb.queue("tenant_users", { error: { message: "member boom" } });
    await expect(provisionTenantForUser(input)).rejects.toThrow("member boom");
  });

  it("propagates a domain insert error", async () => {
    secretDb.queue("tenant_users", { data: null });
    secretDb.queue("tenant_domains", { data: null }); // availability check
    secretDb.queue("tenants", { data: { id: "t-new", slug: "acme" } });
    secretDb.queue("tenant_users", { error: null }); // membership insert ok
    secretDb.queue("tenant_domains", { error: { message: "domain boom" } });
    await expect(provisionTenantForUser(input)).rejects.toThrow("domain boom");
  });
});
