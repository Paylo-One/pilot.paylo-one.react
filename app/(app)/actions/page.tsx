/**
 * Actions — Screen 2, the suggested-actions queue. product/actions.md.
 *
 * Server Component: lists the tenant's suggested actions via the USER server
 * client (RLS active), each with rationale + source references. The operator
 * approves / defers / dismisses; nothing is ever sent autonomously
 * (approval-gated, status changes only).
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSuggestedActions, type SuggestedActionView } from "@/modules/action-extraction/server";
import { ActionControls } from "./action-controls";

function ActionReferences({ action }: { action: SuggestedActionView }) {
  if (action.references.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
      {action.references.map((ref) => (
        <span
          key={ref.id}
          className="badge"
          title={ref.excerptOrPointer ?? undefined}
          style={{ textTransform: "none" }}
        >
          {ref.sourceSystem}
          {typeof ref.confidence === "number" ? ` · ${Math.round(ref.confidence * 100)}%` : ""}
        </span>
      ))}
    </div>
  );
}

export default async function ActionsPage() {
  const ctx = await requireTenantContext();
  const actions = await listSuggestedActions(ctx.tenantId);
  const pendingCount = actions.filter((a) => a.status === "suggested").length;

  return (
    <main className="app-main">
      <p className="eyebrow">Actions</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>Suggested actions</h1>

      {actions.length === 0 ? (
        <div className="panel">
          <p style={{ color: "var(--colour-text-secondary)" }}>
            No actions yet. Generate a Daily Memo and candidate actions extracted from
            your context will appear here, each with its rationale and source. You
            approve, defer, or dismiss — the system prepares the work; you remain the
            one who acts.
          </p>
        </div>
      ) : (
        <>
          <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
            {pendingCount} awaiting your decision · {actions.length} total
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {actions.map((action) => (
              <article
                key={action.id}
                className="panel"
                style={{
                  display: "flex",
                  gap: "var(--space-md)",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                  <h2 style={{ fontSize: "var(--text-body)", margin: "0 0 4px" }}>
                    {action.title}
                  </h2>
                  {action.rationale ? (
                    <p style={{ color: "var(--colour-text-secondary)" }}>{action.rationale}</p>
                  ) : null}
                  <ActionReferences action={action} />
                </div>
                <ActionControls actionId={action.id} status={action.status} />
              </article>
            ))}
          </div>
        </>
      )}

      <p className="scaffold-note" style={{ marginTop: "16px" }}>
        No autonomous external actions. Decisions change status only — nothing leaves
        the system.
      </p>
    </main>
  );
}
