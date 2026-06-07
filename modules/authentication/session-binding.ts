/**
 * modules/authentication/session-binding.ts
 *
 * The session <-> tenant binding contract (anti session-tenant-mismatch).
 * Governance:
 *   - governance/docs/architecture/authentication-architecture.md §8
 *   - governance/docs/services/identity-and-tenant.md ("Bind session <-> tenant
 *     on every request")
 *
 * Principle (authentication-architecture.md §8): authentication establishes WHO
 * the user is; the TENANT is resolved separately from the request host and
 * validated against `tenant_users` membership. On EVERY request the server
 * re-derives `{ userId, tenantId, role }` and denies on mismatch — a session is
 * never assumed to belong to the host's tenant. RLS is the database backstop.
 *
 * Wiring note (build-race avoidance): membership/tenant lookup is owned by the
 * identity-tenant module, but this module does NOT import it (the two modules
 * are scaffolded in parallel, and the module-boundary rule forbids reaching into
 * another module's internals). Instead we accept an injected {@link TenantResolver}
 * function. identity-tenant supplies the concrete resolver at wiring time.
 */

import {
  NotImplementedError,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import type { AuthenticatedSession } from "./types";

/**
 * The host-derived, already-validated tenant slug for the current request
 * (e.g. "bernard" for `bernard.paylo.one`). Parsing/validation of the raw Host
 * header happens upstream (lib/tenant/host.ts + proxy.ts); this is the trusted
 * result, never a client-supplied value.
 */
export type ValidatedHostSlug = string;

/**
 * Injected dependency, implemented by the identity-tenant module at wiring time.
 *
 * Given an authenticated user id and a validated host slug, it must:
 *   1. resolve the tenant for that slug (fail closed if unknown/suspended), and
 *   2. verify the user is a member of that tenant (`tenant_users`),
 * returning a server-trusted {@link TenantContext} on success or an `AppError`
 * (e.g. `tenant_isolation`, `not_found`) on failure.
 *
 * Defined HERE (inside the authentication module) rather than imported from
 * identity-tenant to avoid a cross-module build dependency; see the file header.
 */
export type TenantResolver = (input: {
  readonly userId: string;
  readonly hostSlug: ValidatedHostSlug;
}) => Promise<Result<TenantContext>>;

/**
 * Re-derives and validates the tenant context for an authenticated session on a
 * given host. The single chokepoint that enforces anti session-tenant-mismatch.
 */
export interface SessionTenantBinder {
  /**
   * Bind `session` to the tenant identified by `hostSlug`, using the injected
   * `resolve` to look up tenant + membership.
   *
   * Contract:
   *   - returns `ok(TenantContext)` only when the user is a verified member of
   *     the host's tenant;
   *   - returns `err(AppError)` (deny) on any mismatch, unknown/suspended
   *     tenant, or resolver failure — never silently falls through.
   */
  bind(
    session: AuthenticatedSession,
    hostSlug: ValidatedHostSlug,
    resolve: TenantResolver,
  ): Promise<Result<TenantContext>>;
}

/**
 * Scaffold implementation. The real binder will call `resolve` and map failures
 * to denials; here it throws `NotImplementedError` so the unbuilt path is
 * explicit and greppable.
 */
export const sessionTenantBinder: SessionTenantBinder = {
  async bind() {
    throw new NotImplementedError("authentication.sessionTenantBinder.bind");
  },
};
