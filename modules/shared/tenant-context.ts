/**
 * tenant-context.ts
 *
 * The tenant-context object that flows through every server action, loader,
 * module call, and background job. Governance: multi-tenancy-design.md and
 * authentication-architecture.md (§8 session<->tenant binding).
 *
 * Rule: `{ userId, tenantId, role }` is ALWAYS re-derived server-side from the
 * session + validated host. A client-supplied tenant id is never trusted for
 * authorisation; RLS is the database-level backstop.
 *
 * Scaffold note: types only. No session is established here.
 */

/** Membership roles on a tenant. Single-user-first, but multi-ready. */
export type TenantRole = "owner" | "admin" | "member" | "viewer";

/**
 * Resolved, server-trusted tenant context for the current request or job.
 * Construct only after host validation + `tenant_users` membership check.
 */
export interface TenantContext {
  /** UUID of the resolved tenant. */
  readonly tenantId: string;
  /** Canonical tenant slug (e.g. "bernard" for bernard.paylo.one). */
  readonly tenantSlug: string;
  /** Authenticated Supabase auth user id. */
  readonly userId: string;
  /** The user's role within this tenant. */
  readonly role: TenantRole;
}

/**
 * The minimal context a background job needs. Jobs use the service-role client
 * (RLS bypassed), so the explicit `tenantId` predicate is the developer's
 * responsibility (multi-tenancy-design.md §"Supabase RLS Enforcement").
 */
export interface JobTenantContext {
  readonly tenantId: string;
  /** Initiating user, where one exists (scheduled jobs may have none). */
  readonly userId?: string;
}

/** True if `role` is allowed to perform owner/admin-only operations. */
export function isPrivilegedRole(role: TenantRole): boolean {
  return role === "owner" || role === "admin";
}
