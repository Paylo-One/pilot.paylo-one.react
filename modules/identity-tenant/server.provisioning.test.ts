import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSecretClient: vi.fn(),
  createTrialBillingAccess: vi.fn(),
  linkPaddleCustomerByEmail: vi.fn(),
  seedTenantPrompts: vi.fn(),
  getOrCreateReferral: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: mocks.createSecretClient,
}));
vi.mock("@/lib/config", () => ({
  appHostBaseUrl: () => "https://app.example.com",
  tenantBaseUrl: (slug: string) => `https://${slug}.example.com`,
}));
vi.mock("@/lib/tenant/host", () => ({
  isSelectableSubdomain: () => true,
}));
vi.mock("@/modules/prompt-versioning/server", () => ({
  seedTenantPrompts: mocks.seedTenantPrompts,
}));
vi.mock("@/modules/referral", () => ({
  referralService: { getOrCreateForOwner: mocks.getOrCreateReferral },
}));
vi.mock("@/modules/billing/access", () => ({
  createTrialBillingAccess: mocks.createTrialBillingAccess,
}));
vi.mock("@/modules/billing/paddle-webhooks", () => ({
  linkPaddleCustomerByEmail: mocks.linkPaddleCustomerByEmail,
}));

import { provisionTenantForUser } from "./server";

function query(result: unknown = { data: null, error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<unknown>["then"];
  } = {};
  for (const method of ["select", "eq", "limit", "insert", "upsert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function setupProvisioningDatabase() {
  const membershipRead = query({ data: null, error: null });
  const membershipWrite = query();
  const domainRead = query({ data: null, error: null });
  const domainWrite = query();
  const tenantWrite = query({
    data: { id: "tenant-1", slug: "acme" },
    error: null,
  });
  const profileWrite = query();
  const auditWrite = query();
  const calls = new Map<string, number>();

  const db = {
    from: vi.fn((table: string) => {
      const count = calls.get(table) ?? 0;
      calls.set(table, count + 1);
      if (table === "tenant_users") return count === 0 ? membershipRead : membershipWrite;
      if (table === "tenant_domains") return count === 0 ? domainRead : domainWrite;
      if (table === "tenants") return tenantWrite;
      if (table === "user_profiles") return profileWrite;
      if (table === "audit_events") return auditWrite;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
  mocks.createSecretClient.mockReturnValue(db);

  return { tenantWrite };
}

describe("tenant provisioning signup policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seedTenantPrompts.mockResolvedValue(undefined);
    mocks.createTrialBillingAccess.mockResolvedValue(undefined);
    mocks.linkPaddleCustomerByEmail.mockResolvedValue(undefined);
    mocks.getOrCreateReferral.mockResolvedValue(undefined);
  });

  it("persists complimentary access and performs no hosted billing side effects", async () => {
    const { tenantWrite } = setupProvisioningDatabase();

    const result = await provisionTenantForUser({
      userId: "user-1",
      email: "operator@example.com",
      desiredSubdomain: "acme",
      signupMode: "open",
    });

    expect(tenantWrite.insert).toHaveBeenCalledWith({
      slug: "acme",
      name: "acme",
      status: "active",
      access_grant_type: "complimentary",
      payment_enforcement_exempt: true,
    });
    expect(mocks.createTrialBillingAccess).not.toHaveBeenCalled();
    expect(mocks.linkPaddleCustomerByEmail).not.toHaveBeenCalled();
    expect(mocks.getOrCreateReferral).not.toHaveBeenCalled();
    expect(result).toEqual({
      tenantId: "tenant-1",
      slug: "acme",
      redirectTo: "https://acme.example.com",
    });
  });

  it("retains paid access and hosted billing side effects for gated signup", async () => {
    const { tenantWrite } = setupProvisioningDatabase();

    await provisionTenantForUser({
      userId: "user-1",
      email: "operator@example.com",
      desiredSubdomain: "acme",
      signupMode: "gated",
    });

    expect(tenantWrite.insert).toHaveBeenCalledWith({
      slug: "acme",
      name: "acme",
      status: "active",
      access_grant_type: "paid",
      payment_enforcement_exempt: false,
    });
    expect(mocks.createTrialBillingAccess).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(mocks.linkPaddleCustomerByEmail).toHaveBeenCalledWith(
      "operator@example.com",
      "tenant-1",
    );
    expect(mocks.getOrCreateReferral).toHaveBeenCalledWith("user-1", "tenant-1");
  });
});
