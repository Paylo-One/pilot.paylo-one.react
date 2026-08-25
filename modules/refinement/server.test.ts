import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, select, eqTenant, eqUser, eqTargetType, eqFeedbackType, inTargets, inFeedback, orderCreated, orderId } = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eqTenant: vi.fn(), eqUser: vi.fn(),
  eqTargetType: vi.fn(), eqFeedbackType: vi.fn(), inTargets: vi.fn(),
  inFeedback: vi.fn(), orderCreated: vi.fn(), orderId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ from }),
}));

import { listSavedFeedbackTargets } from "./server";
const ctx = { tenantId: "tenant-456", userId: "user-123" } as never;

describe("listSavedFeedbackTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq: eqTenant });
    eqTenant.mockReturnValue({ eq: eqUser });
    eqUser.mockReturnValue({ eq: eqTargetType });
    eqTargetType.mockReturnValue({ in: inTargets });
    inTargets.mockReturnValue({ in: inFeedback, eq: eqFeedbackType });
    inFeedback.mockReturnValue({ order: orderCreated });
    orderCreated.mockReturnValue({ order: orderId });
    orderId.mockResolvedValue({ data: [], error: null });
    eqFeedbackType.mockResolvedValue({ data: [], error: null });
  });

  it("loads only the current operator's matching feedback for visible targets", async () => {
    orderId.mockResolvedValue({
      data: [
        { id: "3", target_id: "section-1", feedback_type: "not_relevant", created_at: "2026-08-25T00:00:03Z" },
        { id: "2", target_id: "section-2", feedback_type: "relevant", created_at: "2026-08-25T00:00:02Z" },
        { id: "1", target_id: "section-2", feedback_type: "not_relevant", created_at: "2026-08-25T00:00:01Z" },
      ],
      error: null,
    });
    const result = await listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", ["section-1", "section-2", "section-1"]);
    expect(from).toHaveBeenCalledWith("user_feedback_events");
    expect(eqTenant).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-123");
    expect(eqTargetType).toHaveBeenCalledWith("target_type", "memo_section");
    expect(inTargets).toHaveBeenCalledWith("target_id", ["section-1", "section-2"]);
    expect(inFeedback).toHaveBeenCalledWith("feedback_type", ["not_relevant", "relevant"]);
    expect([...result]).toEqual(["section-1"]);
  });

  it("does not query when the surface has no targets", async () => {
    await expect(listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", [])).resolves.toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when saved state cannot be established", async () => {
    orderId.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", ["section-1"])).rejects.toThrow("Failed to load saved feedback: db down");
  });
});
