import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  audit: vi.fn(),
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
  });

  it("persists and audits an explicitly confirmed briefing handoff", async () => {
    await expect(createAction({ title: "Follow up", createdFrom: "briefing" })).resolves.toMatchObject({ ok: true });
    expect(mocks.inserted).toMatchObject({ tenant_id: "tenant-1", created_from: "briefing" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "action.create",
      metadata: expect.objectContaining({ createdFrom: "briefing" }),
    }));
  });

  it.each([undefined, "email", "briefing "])("defaults an untrusted origin to manual: %j", async (createdFrom) => {
    await createAction({ title: "Manual follow up", createdFrom } as Parameters<typeof createAction>[0]);
    expect(mocks.inserted).toMatchObject({ created_from: "manual" });
  });
});
