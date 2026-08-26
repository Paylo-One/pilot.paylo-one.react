import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, select, eqTenant, eqUser, eqTargetType, eqFeedbackType, inTargets } = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eqTenant: vi.fn(), eqUser: vi.fn(),
  eqTargetType: vi.fn(), eqFeedbackType: vi.fn(), inTargets: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ from }),
}));

import { listRecentSavedFeedback, listSavedFeedbackTargets } from "./server";
const ctx = { tenantId: "tenant-456", userId: "user-123" } as never;

describe("listSavedFeedbackTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq: eqTenant });
    eqTenant.mockReturnValue({ eq: eqUser });
    eqUser.mockReturnValue({ eq: eqTargetType });
    eqTargetType.mockReturnValue({ eq: eqFeedbackType });
    eqFeedbackType.mockReturnValue({ in: inTargets });
    inTargets.mockResolvedValue({ data: [], error: null });
  });

  it("loads only the current operator's matching feedback for visible targets", async () => {
    inTargets.mockResolvedValue({ data: [{ target_id: "section-1" }, { target_id: "section-1" }], error: null });
    const result = await listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", ["section-1", "section-2", "section-1"]);
    expect(from).toHaveBeenCalledWith("user_feedback_events");
    expect(eqTenant).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-123");
    expect(eqTargetType).toHaveBeenCalledWith("target_type", "memo_section");
    expect(eqFeedbackType).toHaveBeenCalledWith("feedback_type", "not_relevant");
    expect(inTargets).toHaveBeenCalledWith("target_id", ["section-1", "section-2"]);
    expect([...result]).toEqual(["section-1"]);
  });

  it("does not query when the surface has no targets", async () => {
    await expect(listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", [])).resolves.toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when saved state cannot be established", async () => {
    inTargets.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(listSavedFeedbackTargets(ctx, "memo_section", "not_relevant", ["section-1"])).rejects.toThrow("Failed to load saved feedback: db down");
  });
});

describe("listRecentSavedFeedback", () => {
  it("loads only the current operator's feedback and resolves memo-section context", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{
        id: "feedback-1", feedback_type: "not_relevant", target_type: "memo_section",
        target_id: "section-1", created_at: "2026-08-19T00:00:00.000Z",
      }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const feedbackEqUser = vi.fn().mockReturnValue({ order });
    const feedbackEqTenant = vi.fn().mockReturnValue({ eq: feedbackEqUser });
    const feedbackSelect = vi.fn().mockReturnValue({ eq: feedbackEqTenant });
    const sectionIn = vi.fn().mockResolvedValue({
      data: [{ id: "section-1", kind: "critical_items", title: "Supplier outage" }],
      error: null,
    });
    const sectionEq = vi.fn().mockReturnValue({ in: sectionIn });
    const sectionSelect = vi.fn().mockReturnValue({ eq: sectionEq });
    from
      .mockReturnValueOnce({ select: feedbackSelect })
      .mockReturnValueOnce({ select: sectionSelect });

    await expect(listRecentSavedFeedback(ctx)).resolves.toEqual([{
      id: "feedback-1",
      feedbackType: "not_relevant",
      targetType: "memo_section",
      targetId: "section-1",
      targetLabel: "Supplier outage",
      createdAt: "2026-08-19T00:00:00.000Z",
    }]);
    expect(feedbackEqTenant).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(feedbackEqUser).toHaveBeenCalledWith("user_id", "user-123");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(20);
    expect(sectionEq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(sectionIn).toHaveBeenCalledWith("id", ["section-1"]);
  });

  it("keeps an event inspectable when its target no longer exists", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{
        id: "feedback-1", feedback_type: "not_relevant", target_type: "memo_section",
        target_id: "deleted-section", created_at: "2026-08-19T00:00:00.000Z",
      }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const feedbackEqUser = vi.fn().mockReturnValue({ order });
    const feedbackEqTenant = vi.fn().mockReturnValue({ eq: feedbackEqUser });
    const feedbackSelect = vi.fn().mockReturnValue({ eq: feedbackEqTenant });
    const sectionIn = vi.fn().mockResolvedValue({ data: [], error: null });
    const sectionEq = vi.fn().mockReturnValue({ in: sectionIn });
    const sectionSelect = vi.fn().mockReturnValue({ eq: sectionEq });
    from
      .mockReturnValueOnce({ select: feedbackSelect })
      .mockReturnValueOnce({ select: sectionSelect });

    const result = await listRecentSavedFeedback(ctx);
    expect(result[0]?.targetLabel).toBeNull();
  });

  it("fails visibly when feedback cannot be read", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "db down" } });
    const order = vi.fn().mockReturnValue({ limit });
    const feedbackEqUser = vi.fn().mockReturnValue({ order });
    const feedbackEqTenant = vi.fn().mockReturnValue({ eq: feedbackEqUser });
    const feedbackSelect = vi.fn().mockReturnValue({ eq: feedbackEqTenant });
    from.mockReturnValueOnce({ select: feedbackSelect });

    await expect(listRecentSavedFeedback(ctx)).rejects.toThrow("Failed to load recent feedback: db down");
  });

  it("fails visibly when saved memo context cannot be read", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{
        id: "feedback-1", feedback_type: "not_relevant", target_type: "memo_section",
        target_id: "section-1", created_at: "2026-08-19T00:00:00.000Z",
      }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const feedbackEqUser = vi.fn().mockReturnValue({ order });
    const feedbackEqTenant = vi.fn().mockReturnValue({ eq: feedbackEqUser });
    const feedbackSelect = vi.fn().mockReturnValue({ eq: feedbackEqTenant });
    const sectionIn = vi.fn().mockResolvedValue({ data: null, error: { message: "context down" } });
    const sectionEq = vi.fn().mockReturnValue({ in: sectionIn });
    const sectionSelect = vi.fn().mockReturnValue({ eq: sectionEq });
    from
      .mockReturnValueOnce({ select: feedbackSelect })
      .mockReturnValueOnce({ select: sectionSelect });

    await expect(listRecentSavedFeedback(ctx)).rejects.toThrow("Failed to load feedback context: context down");
  });
});
