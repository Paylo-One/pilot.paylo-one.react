import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUpdate, mockFrom, mockEnsureSourceConnection, mockAuditRecord, mockRevalidatePath } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFrom: vi.fn(),
  mockEnsureSourceConnection: vi.fn(),
  mockAuditRecord: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/modules/identity-tenant/server", () => ({
  requireTenantContext: vi.fn().mockResolvedValue({
    userId: "user-123",
    tenantId: "tenant-456",
    tenantSlug: "acme",
  }),
  getSignedInUser: vi.fn().mockResolvedValue({ email: "operator@example.com" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    from: mockFrom,
  }),
}));

vi.mock("@/modules/source-connection/server", () => ({
  ensureSourceConnection: (...args: any[]) => mockEnsureSourceConnection(...args),
}));

vi.mock("@/modules/audit", () => ({
  auditService: {
    record: (...args: any[]) => mockAuditRecord(...args),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: any[]) => mockRevalidatePath(...args),
}));

import { completeOnboardingAction } from "./onboarding-actions";

describe("completeOnboardingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      update: mockUpdate,
    });
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockEnsureSourceConnection.mockResolvedValue("conn-abc");
    mockAuditRecord.mockResolvedValue(undefined);
  });

  it("successfully updates profile, configures sources, and logs audit events", async () => {
    const input = {
      timezone: "Europe/London",
      briefingTime: "07:30",
      syncSources: ["github" as const],
    };

    const result = await completeOnboardingAction(input);

    expect(result).toEqual({ ok: true, error: null });

    // Verify profile update
    expect(mockFrom).toHaveBeenCalledWith("user_profiles");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "Europe/London",
        briefing_time: "07:30",
        onboarding_completed: true,
      })
    );

    // Verify source connection setup
    expect(mockEnsureSourceConnection).toHaveBeenCalledWith(
      expect.any(Object),
      "github",
      expect.any(Object)
    );

    // Verify audit record called
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: "profile.onboarding.completed",
      })
    );

    // Verify revalidation
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("handles profile update failures gracefully", async () => {
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "DB constraint error" } }),
    });

    const input = {
      timezone: "Europe/London",
      briefingTime: "07:30",
      syncSources: [],
    };

    const result = await completeOnboardingAction(input);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Profile update failed: DB constraint error");
  });

  it("completes onboarding and reports sources that could not be configured", async () => {
    // First source (github) fails hard (e.g. plan connection limit); the second
    // (slack) succeeds. Onboarding must still complete without discarding it.
    mockEnsureSourceConnection.mockRejectedValueOnce(
      new Error("source_connection_limit_reached"),
    );

    const input = {
      timezone: "Europe/London",
      briefingTime: "07:30",
      syncSources: ["github" as const, "slack" as const],
    };

    const result = await completeOnboardingAction(input);

    // Onboarding completes despite the partial failure...
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    // ...and the failed source is reported back for later retry.
    expect(result.failedSources).toEqual(["github"]);

    // Both sources were attempted (no early abort).
    expect(mockEnsureSourceConnection).toHaveBeenCalledTimes(2);

    // The profile is still committed as complete.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_completed: true }),
    );

    // The audit trail records which sources failed.
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: "profile.onboarding.completed",
        metadata: expect.objectContaining({ failedSources: ["github"] }),
      }),
    );
  });

  it("omits failedSources when every source configures cleanly", async () => {
    const input = {
      timezone: "Europe/London",
      briefingTime: "07:30",
      syncSources: ["github" as const],
    };

    const result = await completeOnboardingAction(input);

    expect(result.ok).toBe(true);
    expect(result.failedSources).toBeUndefined();
  });
});
