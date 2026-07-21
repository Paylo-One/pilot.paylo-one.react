import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { exchangeCodeForSession, findPrimaryTenantSlug, seedLocaleCookieFromProfile } = vi.hoisted(
  () => ({
    exchangeCodeForSession: vi.fn(),
    findPrimaryTenantSlug: vi.fn(),
    seedLocaleCookieFromProfile: vi.fn(),
  }),
);

const supabase = { auth: { exchangeCodeForSession } };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabase),
}));
vi.mock("@/lib/config", () => ({
  appHostBaseUrl: () => "https://app.paylo.test",
  tenantBaseUrl: (slug: string) => `https://${slug}.paylo.test`,
}));
vi.mock("@/modules/identity-tenant/server", () => ({ findPrimaryTenantSlug }));
vi.mock("@/lib/i18n/locale-cookie", () => ({ seedLocaleCookieFromProfile }));

import { GET } from "./route";

function request(params: Record<string, string>): NextRequest {
  const url = new URL("https://app.paylo.test/auth/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

beforeEach(() => {
  exchangeCodeForSession
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  findPrimaryTenantSlug.mockReset().mockResolvedValue(null);
  seedLocaleCookieFromProfile.mockReset().mockResolvedValue(undefined);
});

describe("GET /auth/callback", () => {
  it("redirects to sign-in with missing_code when no code is present", async () => {
    const response = await GET(request({}));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.paylo.test/sign-in?error=missing_code",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to sign-in with the encoded error message when the exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid flow state / no valid flow state" },
    });

    const response = await GET(request({ code: "bad-code" }));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("bad-code");
    expect(response.headers.get("location")).toBe(
      `https://app.paylo.test/sign-in?error=${encodeURIComponent("invalid flow state / no valid flow state")}`,
    );
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });

  it("sends a new user (no tenant) to onboarding and seeds the locale cookie", async () => {
    const response = await GET(request({ code: "good-code" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
    expect(findPrimaryTenantSlug).toHaveBeenCalledWith("user-1");
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("honours a safe relative next path", async () => {
    const response = await GET(request({ code: "good-code", next: "/settings/profile" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/settings/profile");
  });

  it("routes /activate/... next paths to the app host without tenant lookup", async () => {
    const response = await GET(request({ code: "good-code", next: "/activate/tok-abc" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/activate/tok-abc");
    expect(findPrimaryTenantSlug).not.toHaveBeenCalled();
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("does not seed locale on an activation redirect without a verified user", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request({ code: "good-code", next: "/activate/tok-abc" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/activate/tok-abc");
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });

  it("redirects an existing tenant owner to their workspace and seeds the locale cookie", async () => {
    findPrimaryTenantSlug.mockResolvedValue("acme");

    const response = await GET(request({ code: "good-code" }));

    expect(response.headers.get("location")).toBe("https://acme.paylo.test/");
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("sanitises an absolute external next to /onboarding", async () => {
    const response = await GET(request({ code: "good-code", next: "https://evil.example/x" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });

  it("sanitises a protocol-relative next to /onboarding", async () => {
    const response = await GET(request({ code: "good-code", next: "//evil.example" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });

  it("skips tenant lookup and locale seeding when the exchange returns no user", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request({ code: "good-code" }));

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
    expect(findPrimaryTenantSlug).not.toHaveBeenCalled();
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });
});
