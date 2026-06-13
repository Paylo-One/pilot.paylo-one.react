/**
 * Actions — the execution-memory surface.
 *
 * The current persistence layer supports source-backed action suggestions and
 * their review decisions. This screen presents that working capability inside
 * the broader Actions operating model, while manual capture, reminders, and the
 * full commitment lifecycle remain clearly marked as planned.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSuggestedActions } from "@/modules/action-extraction/server";
import { ActionsWorkspace } from "./actions-workspace";

export default async function ActionsPage() {
  const ctx = await requireTenantContext();
  const actions = await listSuggestedActions(ctx.tenantId);

  return (
    <main className="workspace__content actions-page">
      <ActionsWorkspace actions={actions} />
    </main>
  );
}
