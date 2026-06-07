/**
 * app/(app)/layout.tsx
 *
 * The tenant application shell, served on <slug>.paylo.one. The first three
 * surfaces are Briefing, Actions, Diary (the wedge), with Sources and Settings
 * alongside (technical-design.md recommended structure; product/screen-map.md).
 *
 * This layout resolves the tenant context server-side (verified session +
 * validated host slug -> { userId, tenantId, role }, with tenant_users
 * membership enforced) and fails closed via redirect when the visitor is not a
 * member. Governance: multi-tenancy-design.md, authentication-architecture.md §8.
 */

import Link from "next/link";
import { requireTenantContext } from "@/modules/identity-tenant/server";

const NAV = [
  { href: "/briefing", label: "Briefing" },
  { href: "/actions", label: "Actions" },
  { href: "/diary", label: "Diary" },
  { href: "/sources", label: "Sources" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fails closed (redirects) when not signed in / not a member of this tenant.
  const ctx = await requireTenantContext();

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Primary">
        <div className="app-nav__brand">
          Paylo.one
          <span
            className="mono"
            style={{
              display: "block",
              fontSize: "var(--text-label)",
              color: "var(--colour-text-tertiary)",
            }}
          >
            {ctx.tenantSlug.toUpperCase()}
          </span>
        </div>
        <div className="app-nav__links">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="app-nav__link">
              {item.label}
            </Link>
          ))}
        </div>
        <form action="/auth/signout" method="post" style={{ marginTop: "auto" }}>
          <button
            type="submit"
            className="app-nav__link"
            style={{
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Sign out
          </button>
        </form>
      </nav>
      {children}
    </div>
  );
}
