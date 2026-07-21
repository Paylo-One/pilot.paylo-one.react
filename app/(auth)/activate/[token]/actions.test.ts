/**
 * Tests for the prepared-tenant activation server action: token validation,
 * invitation state, email binding, legal acceptance, activation error
 * mapping, and the happy-path redirect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("next/headers", () => ({
  headers: vi.fn(
    async () =>
      new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
  ),
}));

vi.mock("@/modules/identity-tenant/activation", () => ({
  // Mirrors the production token shape (43-char base64url, 32 bytes).
  isActivationToken: (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value),
  inspectPreparedActivation: vi.fn(),
  activatePreparedTenant: vi.fn(),
}));

vi.mock("@/modules/identity-tenant/server", () => ({
  getSignedInUser: vi.fn(),
}));

vi.mock("@/modules/legal/server", () => ({
  recordLegalAcceptances: vi.fn(),
}));

import { activateWorkspace } from "./actions";
import {
  activatePreparedTenant,
  inspectPreparedActivation,
} from "@/modules/identity-tenant/activation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { recordLegalAcceptances } from "@/modules/legal/server";

const TOKEN = "a".repeat(43);
const user = { userId: "user-1", email: "user@x.com" };

const invitation = {
  invitationId: "inv-1",
  tenantId: "tenant-1",
  tenantName: "Acme",
  tenantSlug: "acme",
  contactName: "Alex Doe",
  email: "user@x.com",
  status: "pending" as const,
  expiresAt: "2026-08-01T00:00:00Z",
  acceptedUserId: null,
};

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    token: TOKEN,
    acceptTerms: "on",
    acceptPrivacy: "on",
    ...fields,
  })) {
    if (value !== "") data.set(key, value);
  }
  return data;
}

const prev = { error: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSignedInUser).mockResolvedValue(user);
  vi.mocked(inspectPreparedActivation).mockResolvedValue(invitation);
  vi.mocked(recordLegalAcceptances).mockResolvedValue(undefined);
  vi.mocked(activatePreparedTenant).mockResolvedValue({
    tenantId: "tenant-1",
    slug: "acme",
    redirectTo: "https://acme.paylo.test/",
    created: true,
  });
});

describe("activateWorkspace", () => {
  it("returns an error when unauthenticated", async () => {
    vi.mocked(getSignedInUser).mockResolvedValue(null);
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({
      error: "Sign in with the invited email to continue.",
    });
    expect(inspectPreparedActivation).not.toHaveBeenCalled();
  });

  it("rejects a malformed token", async () => {
    const state = await activateWorkspace(prev, form({ token: "nope" }));
    expect(state).toEqual({ error: "Activation link is invalid." });
    expect(inspectPreparedActivation).not.toHaveBeenCalled();
  });

  it("returns an error when the invitation is not found", async () => {
    vi.mocked(inspectPreparedActivation).mockResolvedValue(null);
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({ error: "Activation invitation was not found." });
  });

  it("returns an error for an expired invitation", async () => {
    vi.mocked(inspectPreparedActivation).mockResolvedValue({
      ...invitation,
      status: "expired",
    });
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({
      error: "This activation link has expired. Ask Operations for a new one.",
    });
  });

  it("returns an error for a revoked invitation", async () => {
    vi.mocked(inspectPreparedActivation).mockResolvedValue({
      ...invitation,
      status: "revoked",
    });
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({
      error: "This activation link is no longer active.",
    });
  });

  it("returns an error when the signed-in email does not match the invitation", async () => {
    vi.mocked(getSignedInUser).mockResolvedValue({
      userId: "user-1",
      email: "someone-else@x.com",
    });
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({
      error: "Sign in with the email address that received this invitation.",
    });
  });

  it("matches emails case- and whitespace-insensitively", async () => {
    vi.mocked(getSignedInUser).mockResolvedValue({
      userId: "user-1",
      email: " User@X.com ",
    });
    await expect(activateWorkspace(prev, form())).rejects.toThrow(
      "NEXT_REDIRECT:https://acme.paylo.test/",
    );
  });

  it("requires both legal checkboxes", async () => {
    const state = await activateWorkspace(prev, form({ acceptTerms: "" }));
    expect(state.error).toMatch(/accept the Terms and Conditions/);
    expect(recordLegalAcceptances).not.toHaveBeenCalled();
  });

  it("returns an error when recording legal acceptance fails", async () => {
    vi.mocked(recordLegalAcceptances).mockRejectedValue(new Error("insert failed"));
    const state = await activateWorkspace(prev, form());
    expect(state).toEqual({
      error: "Could not record your acceptance. Please try again.",
    });
    expect(activatePreparedTenant).not.toHaveBeenCalled();
  });

  it.each([
    [
      "activation_email_mismatch",
      "Sign in with the email address that received this invitation.",
    ],
    [
      "user already belongs to another workspace",
      "This account already belongs to another workspace.",
    ],
    [
      "invitation expired during activation",
      "This activation link has expired. Ask Operations for a new one.",
    ],
    ["boom", "Could not activate the workspace. Please try again."],
  ])(
    "maps an activation failure of %j to a readable message",
    async (code, message) => {
      vi.mocked(activatePreparedTenant).mockRejectedValue(new Error(code));
      const state = await activateWorkspace(prev, form());
      expect(state).toEqual({ error: message });
    },
  );

  it("redirects to the workspace on success using the submitted display name", async () => {
    await expect(
      activateWorkspace(prev, form({ displayName: "  Bernard  " })),
    ).rejects.toThrow("NEXT_REDIRECT:https://acme.paylo.test/");
    expect(activatePreparedTenant).toHaveBeenCalledWith({
      token: TOKEN,
      userId: "user-1",
      displayName: "Bernard",
    });
  });

  it("falls back to the invitation contact name when no display name is submitted", async () => {
    await expect(activateWorkspace(prev, form())).rejects.toThrow("NEXT_REDIRECT:");
    expect(activatePreparedTenant).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Alex Doe" }),
    );
  });

  it("falls back to the user email when neither display name nor contact name exists", async () => {
    vi.mocked(inspectPreparedActivation).mockResolvedValue({
      ...invitation,
      contactName: null,
    });
    await expect(activateWorkspace(prev, form())).rejects.toThrow("NEXT_REDIRECT:");
    expect(activatePreparedTenant).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "user@x.com" }),
    );
  });
});
