import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn(),
  getSignedInUser: vi.fn(),
  provisionTenantForUser: vi.fn(),
  recordLegalAcceptances: vi.fn(),
  validateReferral: vi.fn(),
  reserveReferral: vi.fn(),
  releaseReservation: vi.fn(),
  completeReservation: vi.fn(),
  hasPaddleSubscriptionForEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
  headers: async () => ({ get: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/identity-tenant/server", () => ({
  getSignedInUser: mocks.getSignedInUser,
  provisionTenantForUser: mocks.provisionTenantForUser,
}));
vi.mock("@/modules/legal/server", () => ({
  recordLegalAcceptances: mocks.recordLegalAcceptances,
}));
vi.mock("@/modules/referral", () => ({
  REFERRAL_COOKIE: "paylo_ref",
  referralService: {
    validateCode: mocks.validateReferral,
    reserve: mocks.reserveReferral,
    releaseReservation: mocks.releaseReservation,
    completeReservation: mocks.completeReservation,
  },
}));
vi.mock("@/modules/billing/paddle", () => ({
  hasPaddleSubscriptionForEmail: mocks.hasPaddleSubscriptionForEmail,
}));
vi.mock("@/lib/supabase/cookies", () => ({
  supabaseCookieOptions: () => ({
    domain: ".example.com",
    path: "/",
    sameSite: "lax",
    secure: true,
  }),
}));
vi.mock("@/lib/tenant/host", () => ({ isSelectableSubdomain: () => true }));

import { createWorkspace } from "./actions";

class RedirectSignal extends Error {}

describe("open-registration onboarding action", () => {
  const originalSignupMode = process.env.PILOT_SIGNUP_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PILOT_SIGNUP_MODE = "open";
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.getSignedInUser.mockResolvedValue({
      userId: "user-1",
      email: "operator@example.com",
    });
    mocks.provisionTenantForUser.mockResolvedValue({
      tenantId: "tenant-1",
      slug: "acme",
      redirectTo: "https://acme.example.com",
    });
    mocks.redirect.mockImplementation(() => {
      throw new RedirectSignal();
    });
  });

  afterEach(() => {
    if (originalSignupMode === undefined) delete process.env.PILOT_SIGNUP_MODE;
    else process.env.PILOT_SIGNUP_MODE = originalSignupMode;
  });

  it("passes open mode to provisioning without hosted eligibility or legal side effects", async () => {
    const form = new FormData();
    form.set("subdomain", "acme");
    form.set("workspaceName", "Acme");

    await expect(createWorkspace({ error: null }, form)).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(mocks.provisionTenantForUser).toHaveBeenCalledWith({
      userId: "user-1",
      email: "operator@example.com",
      desiredSubdomain: "acme",
      tenantName: "Acme",
      signupMode: "open",
    });
    expect(mocks.hasPaddleSubscriptionForEmail).not.toHaveBeenCalled();
    expect(mocks.validateReferral).not.toHaveBeenCalled();
    expect(mocks.reserveReferral).not.toHaveBeenCalled();
    expect(mocks.recordLegalAcceptances).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("https://acme.example.com");
  });
});
