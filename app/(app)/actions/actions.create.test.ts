import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  audit: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/identity-tenant/server", () => ({
  requireTenantContext: vi.fn().mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" }),
}));
vi.mock("@/modules/audit", () => ({ auditService: { record: mocks.audit } }));
vi.mock("@/lib/llm", () => ({ createLlmClient: vi.fn(), llmChatModel: vi.fn(), hasLlm: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        mocks.inserted = payload;
        return {
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: "action-1", ...payload }, error: null }),
          })),
        };
      }),
    })),
  }),
}));

import { createAction } from "./actions";

describe("createAction origin", () => {
  beforeEach(() => {
    mocks.inserted = null;
    mocks.audit.mockClear();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: { id: "action-1" }, error: null });
  });

  it("rejects a briefing origin without its trusted memo section", async () => {
    await expect(createAction({ title: "Follow up", createdFrom: "briefing" }))
      .resolves.toEqual({ ok: false, error: "Daily briefing source context is required." });
    expect(mocks.inserted).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the atomic evidence-preserving boundary for a memo section", async () => {
    await expect(createAction({
      title: "Follow up",
      createdFrom: "briefing",
      briefingSectionId: "section-1",
    })).resolves.toMatchObject({ ok: true });

    expect(mocks.inserted).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("create_action_from_briefing_section", {
      p_tenant_id: "tenant-1",
      p_section_id: "section-1",
      p_action: expect.objectContaining({ title: "Follow up", created_from: "briefing" }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      metadata: expect.objectContaining({ sourceReferencesPreserved: true }),
    }));
  });

  it.each([undefined, "email", "briefing "])("defaults an untrusted origin to manual: %j", async (createdFrom) => {
    await createAction({ title: "Manual follow up", createdFrom } as Parameters<typeof createAction>[0]);
    expect(mocks.inserted).toMatchObject({ created_from: "manual" });
  });
});
