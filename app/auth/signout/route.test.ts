import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

const supabase = { auth: { signOut } };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabase),
}));
vi.mock("@/lib/config", () => ({
  appHostBaseUrl: () => "https://app.paylo.test",
}));

import { POST } from "./route";

function request(): NextRequest {
  return new NextRequest("https://app.paylo.test/auth/signout", { method: "POST" });
}

beforeEach(() => {
  signOut.mockReset().mockResolvedValue({ error: null });
});

describe("POST /auth/signout", () => {
  it("signs out and 303-redirects to sign-in", async () => {
    const response = await POST(request());

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/sign-in");
  });

  it("still redirects when Supabase reports a sign-out error", async () => {
    signOut.mockResolvedValue({ error: { message: "session missing" } });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.paylo.test/sign-in");
  });
});
