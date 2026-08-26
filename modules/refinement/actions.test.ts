import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, insert, select, eqTenant, eqId, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  eqTenant: vi.fn(),
  eqId: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/modules/identity-tenant/server", () => ({
  requireTenantContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-456",
    tenantSlug: "acme",
    userId: "user-123",
    role: "owner",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ from }),
}));

import { submitFeedbackAction } from "./actions";

const validInput = {
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  feedbackType: "not_relevant" as const,
  targetType: "memo_section" as const,
  targetId: "section-123",
};

describe("submitFeedbackAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ insert, select });
    insert.mockResolvedValue({ error: null });
    select.mockReturnValue({ eq: eqId });
    eqId.mockReturnValue({ eq: eqTenant });
    eqTenant.mockReturnValue({ maybeSingle });
  });

  it("attributes valid feedback to the trusted tenant and user", async () => {
    await expect(submitFeedbackAction(validInput)).resolves.toEqual({ ok: true });

    expect(from).toHaveBeenCalledWith("user_feedback_events");
    expect(insert).toHaveBeenCalledWith({
      id: validInput.eventId,
      tenant_id: "tenant-456",
      user_id: "user-123",
      feedback_type: "not_relevant",
      target_type: "memo_section",
      target_id: "section-123",
    });
  });

  it("records an append-only relevance correction", async () => {
    await expect(submitFeedbackAction({ ...validInput, feedbackType: "relevant" })).resolves.toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ feedback_type: "relevant" }));
  });

  it.each([
    null,
    {},
    { ...validInput, eventId: "not-a-uuid" },
    { ...validInput, feedbackType: "invented" as typeof validInput.feedbackType },
    { ...validInput, targetType: "tenant" as typeof validInput.targetType },
    { ...validInput, targetId: "   " },
    { ...validInput, targetId: "x".repeat(201) },
    { ...validInput, targetId: 42 },
  ])("rejects invalid input before database access", async (input) => {
    await expect(submitFeedbackAction(input)).resolves.toEqual({
      ok: false,
      error: "This feedback request is invalid.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a retryable error when persistence fails", async () => {
    insert.mockResolvedValue({ error: { code: "XX000" } });

    await expect(submitFeedbackAction(validInput)).resolves.toEqual({
      ok: false,
      error: "Pilot could not save that feedback. Please try again.",
    });
  });

  it("returns a retryable error when the database client throws", async () => {
    insert.mockRejectedValue(new Error("connection reset"));

    await expect(submitFeedbackAction(validInput)).resolves.toEqual({
      ok: false,
      error: "Pilot could not save that feedback. Please try again.",
    });
  });

  it("treats an identical owned replay as success", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    maybeSingle.mockResolvedValue({
      error: null,
      data: {
        tenant_id: "tenant-456",
        user_id: "user-123",
        feedback_type: "not_relevant",
        target_type: "memo_section",
        target_id: "section-123",
      },
    });

    await expect(submitFeedbackAction(validInput)).resolves.toEqual({ ok: true });
    expect(eqId).toHaveBeenCalledWith("id", validInput.eventId);
    expect(eqTenant).toHaveBeenCalledWith("tenant_id", "tenant-456");
  });

  it("rejects an event id replayed with a different payload", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    maybeSingle.mockResolvedValue({
      error: null,
      data: {
        tenant_id: "tenant-456",
        user_id: "user-123",
        feedback_type: "raise_priority",
        target_type: "memo_section",
        target_id: "section-123",
      },
    });

    await expect(submitFeedbackAction(validInput)).resolves.toEqual({
      ok: false,
      error: "Pilot could not save that feedback. Please try again.",
    });
  });

  it("rejects an identical payload replayed by a different user", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    maybeSingle.mockResolvedValue({
      error: null,
      data: {
        tenant_id: "tenant-456",
        user_id: "another-user",
        feedback_type: "not_relevant",
        target_type: "memo_section",
        target_id: "section-123",
      },
    });

    await expect(submitFeedbackAction(validInput)).resolves.toMatchObject({ ok: false });
  });
});
