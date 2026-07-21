import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyOtp, exchangeCodeForSession, findPrimaryTenantSlug, seedLocaleCookieFromProfile } =
  vi.hoisted(() => ({
    verifyOtp: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    findPrimaryTenantSlug: vi.fn(),
    seedLocaleCookieFromProfile: vi.fn(),
  }));

const supabase = { auth: { verifyOtp, exchangeCodeForSession } };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabase),
}));
vi.mock("@/lib/config", () => ({
  appHostBaseUrl: () => "https://app.paylo.test",
  tenantBaseUrl: (slug: string) => `https://${slug}.paylo.test`,
}));
vi.mock("@/modules/identity-tenant/server", () => ({ findPrimaryTenantSlug }));
vi.mock("@/lib/i18n/locale-cookie", () => ({ seedLocaleCookieFromProfile }));

import { GET, POST } from "./route";

function getRequest(params: Record<string, string>): NextRequest {
  const url = new URL("https://app.paylo.test/auth/confirm");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function postRequest(fields: Record<string, string>): NextRequest {
  const body = new URLSearchParams(fields);
  return new NextRequest("https://app.paylo.test/auth/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  exchangeCodeForSession
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  findPrimaryTenantSlug.mockReset().mockResolvedValue(null);
  seedLocaleCookieFromProfile.mockReset().mockResolvedValue(undefined);
});

describe("GET /auth/confirm (interstitial)", () => {
  it("redirects to sign-in with missing_token when no token_hash/type/code", () => {
    const response = GET(getRequest({}));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.paylo.test/sign-in?error=missing_token",
    );
  });

  it("redirects to sign-in when token_hash is present without type", () => {
    const response = GET(getRequest({ token_hash: "abc" }));

    expect(response.headers.get("location")).toBe(
      "https://app.paylo.test/sign-in?error=missing_token",
    );
  });

  it("renders a 200 HTML interstitial without consuming the token", async () => {
    const response = GET(getRequest({ token_hash: "tok-123", type: "email" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    // GET must never verify — that would let email link-scanners burn the token.
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();

    const html = await response.text();
    expect(html).toContain('<input type="hidden" name="token_hash" value="tok-123" />');
    expect(html).toContain('<input type="hidden" name="type" value="email" />');
    expect(html).toContain('<input type="hidden" name="next" value="/onboarding" />');
    expect(html).not.toContain('name="code"');
    expect(html).toContain('method="POST" action="/auth/confirm"');
  });

  it("renders the interstitial for a PKCE code fallback", async () => {
    const response = GET(getRequest({ code: "pkce-code" }));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<input type="hidden" name="code" value="pkce-code" />');
  });

  it("HTML-escapes malicious query values echoed into the form", async () => {
    const response = GET(
      getRequest({ token_hash: '"><script>alert(1)</script>', type: "email'\"<>" }),
    );

    const html = await response.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(
      'value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    expect(html).toContain('value="email&#39;&quot;&lt;&gt;"');
  });

  it("preserves a safe relative next path", async () => {
    const response = GET(getRequest({ token_hash: "t", type: "email", next: "/activate/xyz" }));

    const html = await response.text();
    expect(html).toContain('<input type="hidden" name="next" value="/activate/xyz" />');
  });

  it("sanitises an absolute external next to /onboarding", async () => {
    const response = GET(
      getRequest({ token_hash: "t", type: "email", next: "https://evil.example/phish" }),
    );

    const html = await response.text();
    expect(html).toContain('<input type="hidden" name="next" value="/onboarding" />');
    expect(html).not.toContain("evil.example");
  });

  it("sanitises a protocol-relative next to /onboarding", async () => {
    const response = GET(getRequest({ token_hash: "t", type: "email", next: "//evil.example" }));

    const html = await response.text();
    expect(html).toContain('<input type="hidden" name="next" value="/onboarding" />');
  });
});

describe("POST /auth/confirm (verification)", () => {
  it("verifies the OTP and 303-redirects to appHost + next", async () => {
    const response = await POST(
      postRequest({ token_hash: "tok-1", type: "email", next: "/onboarding" }),
    );

    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "tok-1" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });

  it("redirects to sign-in with the encoded error message on verify failure", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired / already used" },
    });

    const response = await POST(postRequest({ token_hash: "tok-1", type: "email" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.paylo.test/sign-in?error=${encodeURIComponent("Token has expired / already used")}`,
    );
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });

  it("falls back to exchangeCodeForSession when only a code is posted", async () => {
    const response = await POST(postRequest({ code: "pkce-code" }));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });

  it("redirects to sign-in with missing_token when neither credential is posted", async () => {
    const response = await POST(postRequest({}));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.paylo.test/sign-in?error=missing_token",
    );
  });

  it("routes /activate/... next paths to the app host without tenant lookup", async () => {
    const response = await POST(
      postRequest({ token_hash: "tok-1", type: "email", next: "/activate/tok-abc" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/activate/tok-abc");
    expect(findPrimaryTenantSlug).not.toHaveBeenCalled();
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("does not seed locale on an activation redirect without a verified user", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(
      postRequest({ token_hash: "tok-1", type: "email", next: "/activate/tok-abc" }),
    );

    expect(response.headers.get("location")).toBe("https://app.paylo.test/activate/tok-abc");
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });

  it("redirects an existing tenant owner straight to their workspace", async () => {
    findPrimaryTenantSlug.mockResolvedValue("acme");

    const response = await POST(postRequest({ token_hash: "tok-1", type: "email" }));

    expect(findPrimaryTenantSlug).toHaveBeenCalledWith("user-1");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://acme.paylo.test/");
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("seeds the locale cookie on the default onboarding redirect", async () => {
    const response = await POST(postRequest({ token_hash: "tok-1", type: "email" }));

    expect(seedLocaleCookieFromProfile).toHaveBeenCalledTimes(1);
    expect(seedLocaleCookieFromProfile).toHaveBeenCalledWith(supabase, "user-1", response);
  });

  it("skips locale seeding when the verify response has no user", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest({ token_hash: "tok-1", type: "email" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
    expect(findPrimaryTenantSlug).not.toHaveBeenCalled();
    expect(seedLocaleCookieFromProfile).not.toHaveBeenCalled();
  });

  it("sanitises a posted external next to /onboarding", async () => {
    const response = await POST(
      postRequest({ token_hash: "tok-1", type: "email", next: "https://evil.example/phish" }),
    );

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });

  it("sanitises a posted protocol-relative next to /onboarding", async () => {
    const response = await POST(
      postRequest({ token_hash: "tok-1", type: "email", next: "//evil.example" }),
    );

    expect(response.headers.get("location")).toBe("https://app.paylo.test/onboarding");
  });
});
