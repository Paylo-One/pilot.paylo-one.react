import "server-only";

/**
 * modules/audit — append-only, tenant-scoped business audit trail.
 * Governance: services/audit-and-source-traceability.md.
 *
 * Writes via the secret client with an explicit tenant_id (audit rows are not
 * end-user writable; RLS grants authenticated SELECT only). Distinct from the
 * gateways' own inference/tool audit events but complementary.
 */

import type { AuditEvent, TenantContext } from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export interface AuditService {
  /** Record a tenant-scoped business event (append-only). */
  record(
    ctx: TenantContext,
    event: Omit<AuditEvent, "tenantId" | "occurredAt">,
  ): Promise<void>;
}

export const auditService: AuditService = {
  async record(ctx, event) {
    const secret = createSupabaseSecretClient();
    await secret.from("audit_events").insert({
      tenant_id: ctx.tenantId,
      user_id: event.userId ?? ctx.userId,
      action: event.action,
      target: event.target ?? null,
      metadata: event.metadata ?? null,
    });
  },
};
