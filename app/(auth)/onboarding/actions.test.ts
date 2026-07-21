/**
 * Tests for the onboarding server action: referral gating, legal acceptance,
 * reservation lifecycle, provisioning errors, and the happy path.
 *
 * `redirect()` is mocked to throw (as Next's real implementation does), so a
 * redirecting path is asserted via the thrown sentinel message.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieStore: {
    get: vi.fn<(name: string) => { value: string } | undefined>(),
    set: vi.fn(),
  },
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
  headers: vi.fn(
    async () =>
      new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "vitest" }),
  ),
}));

vi.mock("@/modules/identity-tenant/server", () => ({
  getSignedInUser: vi.fn(),
  provisionTenantForUser: vi.fn(),
}));

vi.mock("@/modules/legal/server", () => ({
  recordLegalAcceptances: vi.fn(),
}));

vi.mock("@/modules/referral", () => ({
  REFERRAL_COOKIE: "paylo_ref",
  referralService: {
    validateCode: vi.fn(),
    reserve: vi.fn(),
    completeReservation: vi.fn(),
    releaseReservation: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/cookies", () => ({
  supabaseCookieOptions: () => ({
    domain: ".paylo.test",
    path: "/",
    sameSite: "lax" as const,
    secure: false,
  }),
}));

// Mirror of the production pattern (3–32 chars, letters/digits/hyphens) so the
// zod refinement behaves realistically without pulling in config.
vi.mock("@/lib/tenant/host", () => ({
  isSelectableSubdomain: (label: string) =>
    /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(label),
}));

import { createWorkspace } from "./actions";
import {
  getSignedInUser,
  provisionTenantForUser,
} from "@/modules/identity-tenant/server";
import { recordLegalAcceptances } from "@/modules/legal/server";
import { referralService } from "@/modules/referral";

const user = { userId: "user-1", email: "bernard@paylo.one" };

const validValidation = {
  ok: true as const,
  value: { status: "valid" as const, code: "REF123", allocation: 5, used: 1, remaining: 4 },
};

function validation(status: "not_found" | "suspended" | "exhausted") {
  return {
    ok: true as const,
    value: { status, code: "REF123", allocation: 5, used: 5, remaining: 0 },
  };
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    subdomain: "acme",
    acceptTerms: "on",
    acceptPrivacy: "on",
    ...fields,
  })) {
    if (value !== "") data.set(key, value);
  }
  return data;
}

const prev = { error: null };

function expectReferralCookieCleared() {
  expect(mocks.cookieStore.set).toHaveBeenCalledWith("paylo_ref", "", {
    domain: ".paylo.test",
    path: "/",
    sameSite: "lax",
    secure: false,
    maxAge: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSignedInUser).mockResolvedValue(user);
  mocks.cookieStore.get.mockReturnValue({ value: "REF123" });
  vi.mocked(referralService.validateCode).mockResolvedValue(validValidation);
  vi.mocked(referralService.reserve).mockResolvedValue({
    ok: true,
    value: { outcome: "reserved", reservationId: "res-1" },
  });
  vi.mocked(referralService.completeReservation).mockResolvedValue({
    ok: true,
    value: undefined,
  });
  vi.mocked(referralService.releaseReservation).mockResolvedValue({
    ok: true,
    value: undefined,
  });
  vi.mocked(recordLegalAcceptances).mockResolvedValue(undefined);
  vi.mocked(provisionTenantForUser).mockResolvedValue({
    tenantId: "tenant-1",
    slug: "acme",
    redirectTo: "https://acme.paylo.test/",
  });
});

describe("createWorkspace", () => {
  it("redirects unauthenticated users to /sign-in", async () => {
    vi.mocked(getSignedInUser).mockResolvedValue(null);
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in",
    );
  });

  it("redirects to invite-unavailable when neither cookie nor form referral exists", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/invite-unavailable?reason=referral-required",
    );
    expect(referralService.validateCode).not.toHaveBeenCalled();
  });

  it("falls back to the hidden form field when the cookie is absent", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);
    await expect(
      createWorkspace(prev, form({ referralCode: "FORMREF" })),
    ).rejects.toThrow("NEXT_REDIRECT:");
    expect(referralService.validateCode).toHaveBeenCalledWith("FORMREF");
  });

  it("redirects with reason=invalid and clears the cookie for a not_found referral", async () => {
    vi.mocked(referralService.validateCode).mockResolvedValue(validation("not_found"));
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/invite-unavailable?reason=invalid",
    );
    expectReferralCookieCleared();
  });

  it("redirects with reason=limit-reached for an exhausted referral", async () => {
    vi.mocked(referralService.validateCode).mockResolvedValue(validation("exhausted"));
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/invite-unavailable?reason=limit-reached",
    );
    expectReferralCookieCleared();
  });

  it("redirects with reason=limit-reached for a suspended referral", async () => {
    vi.mocked(referralService.validateCode).mockResolvedValue(validation("suspended"));
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/invite-unavailable?reason=limit-reached",
    );
    expectReferralCookieCleared();
  });

  it("redirects with reason=unavailable when validation itself fails", async () => {
    vi.mocked(referralService.validateCode).mockResolvedValue({
      ok: false,
      error: new Error("db down") as never,
    });
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:/invite-unavailable?reason=unavailable",
    );
    expectReferralCookieCleared();
  });

  it("returns the validation message for a bad subdomain", async () => {
    const state = await createWorkspace(prev, form({ subdomain: "a!" }));
    expect(state).toEqual({
      error: "Choose 3–32 letters, numbers, or hyphens.",
    });
    expect(recordLegalAcceptances).not.toHaveBeenCalled();
  });

  it("requires both legal checkboxes", async () => {
    const state = await createWorkspace(prev, form({ acceptPrivacy: "" }));
    expect(state.error).toMatch(/accept the Terms and Conditions/);
    expect(recordLegalAcceptances).not.toHaveBeenCalled();
  });

  it("returns an error when recording legal acceptance fails", async () => {
    vi.mocked(recordLegalAcceptances).mockRejectedValue(new Error("insert failed"));
    const state = await createWorkspace(prev, form());
    expect(state).toEqual({
      error: "Could not record your acceptance. Please try again.",
    });
    expect(referralService.reserve).not.toHaveBeenCalled();
  });

  it("returns an error when the reservation call fails", async () => {
    vi.mocked(referralService.reserve).mockResolvedValue({
      ok: false,
      error: new Error("db down") as never,
    });
    const state = await createWorkspace(prev, form());
    expect(state).toEqual({
      error: "Could not confirm your invitation. Please try again.",
    });
  });

  it.each([
    ["exhausted", "limit-reached"],
    ["suspended", "limit-reached"],
    ["not_found", "invalid"],
  ] as const)(
    "redirects when the reservation outcome is %s with reason=%s and clears the cookie",
    async (outcome, reason) => {
      vi.mocked(referralService.reserve).mockResolvedValue({
        ok: true,
        value: { outcome, reservationId: null },
      });
      await expect(createWorkspace(prev, form())).rejects.toThrow(
        `NEXT_REDIRECT:/invite-unavailable?reason=${reason}`,
      );
      expectReferralCookieCleared();
      expect(provisionTenantForUser).not.toHaveBeenCalled();
    },
  );

  it("maps a subdomain_taken provisioning failure and releases the reservation", async () => {
    vi.mocked(provisionTenantForUser).mockRejectedValue(new Error("subdomain_taken"));
    const state = await createWorkspace(prev, form());
    expect(state).toEqual({
      error: "That subdomain is already taken. Try another.",
    });
    expect(referralService.releaseReservation).toHaveBeenCalledWith("res-1");
    expect(referralService.completeReservation).not.toHaveBeenCalled();
  });

  it("maps an invalid_subdomain provisioning failure and releases the reservation", async () => {
    vi.mocked(provisionTenantForUser).mockRejectedValue(new Error("invalid_subdomain"));
    const state = await createWorkspace(prev, form());
    expect(state).toEqual({
      error: "Choose 3–32 letters, numbers, or hyphens.",
    });
    expect(referralService.releaseReservation).toHaveBeenCalledWith("res-1");
  });

  it("maps unknown provisioning failures generically and releases the reservation", async () => {
    vi.mocked(provisionTenantForUser).mockRejectedValue(new Error("boom"));
    const state = await createWorkspace(prev, form());
    expect(state).toEqual({
      error: "Could not create your workspace. Please try again.",
    });
    expect(referralService.releaseReservation).toHaveBeenCalledWith("res-1");
  });

  it("completes the reservation, clears the cookie, and redirects on success", async () => {
    await expect(createWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:https://acme.paylo.test/",
    );
    expect(provisionTenantForUser).toHaveBeenCalledWith({
      userId: "user-1",
      email: "bernard@paylo.one",
      desiredSubdomain: "acme",
      tenantName: undefined,
    });
    expect(referralService.completeReservation).toHaveBeenCalledWith(
      "res-1",
      "tenant-1",
    );
    expectReferralCookieCleared();
    expect(referralService.releaseReservation).not.toHaveBeenCalled();
  });
});
