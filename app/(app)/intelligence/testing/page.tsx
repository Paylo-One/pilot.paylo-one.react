/**
 * Intelligence · Testing lab — try a prompt version against real information and
 * read an evaluation of whether it beats what is live. Loads the prompts, a flat
 * list of their versions, and recent source items to test against.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTenantPrompts } from "@/modules/prompt-versioning/server";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { TestingLab } from "./testing-lab";

export default async function TestingLabPage() {
  const ctx = await requireTenantContext();
  const promptsRes = await listTenantPrompts(ctx);
  const prompts = promptsRes.ok
    ? promptsRes.value.filter((p) => !p.archivedAt)
    : [];

  const supabase = await createSupabaseServerClient();
  const [{ data: versionRows }, recentItems] = await Promise.all([
    supabase
      .from("prompt_versions")
      .select("id, tenant_prompt_id, version_number, status"),
    listRecentSourceItems(ctx.tenantId, 20),
  ]);

  const versions = (versionRows ?? []).map((v) => ({
    id: v.id as string,
    promptId: v.tenant_prompt_id as string,
    versionNumber: v.version_number as number,
    status: v.status as string,
  }));

  const items = recentItems.map((item) => ({
    id: item.id,
    system: item.system,
    title: item.title ?? "(untitled)",
  }));

  if (prompts.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">No prompts to test yet</p>
        <p className="empty__body">
          Your prompt library will appear here once it is set up.
        </p>
      </div>
    );
  }

  return (
    <TestingLab
      prompts={prompts.map((p) => ({ id: p.id, name: p.name }))}
      versions={versions}
      items={items}
    />
  );
}
