import { requireTenantContextForAccessGate } from "@/modules/identity-tenant/server";
import { getTenantAccess } from "@/modules/identity-tenant/access";

// NOTE (draft): copy is intentionally literal here. Before merge, move these
// strings into the next-intl `account` namespace for all locales, mirroring the
// i18n treatment the rest of the app shell now uses.
export default async function AccountInactivePage() {
  const ctx = await requireTenantContextForAccessGate();
  const tenantAccess = await getTenantAccess(ctx.tenantId);
  const isSuspended = tenantAccess?.status === "suspended";

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Account inactive</p>
        <h1 className="page-head__title">
          {isSuspended ? "Workspace access is suspended" : "Access is unavailable"}
        </h1>
        <p className="page-head__lead">
          {isSuspended
            ? "Your workspace has been paused by an administrator. Protected features will remain unavailable until access is reactivated."
            : "We could not confirm an active access state for this workspace."}
        </p>
      </div>

      <section className="card" style={{ maxWidth: "760px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Access state</p>
            <h2 className="card__title">Protected features are paused</h2>
          </div>
          <span className="status status--risk">
            {tenantAccess?.status ?? "inactive"}
          </span>
        </div>
        <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
          {tenantAccess?.suspensionReason
            ? `Reason: ${tenantAccess.suspensionReason}`
            : "Contact support to review the suspension and request reactivation."}
        </p>
        <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
          <a href="mailto:support@paylo.one?subject=Workspace%20reactivation">
            Contact support about reactivation
          </a>
        </p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn btn--ghost">Sign out</button>
        </form>
      </section>
    </main>
  );
}
