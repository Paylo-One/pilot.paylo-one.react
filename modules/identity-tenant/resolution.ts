/**
 * modules/identity-tenant/resolution.ts
 *
 * Server-side tenant resolution + the session↔tenant binding. Governance:
 * governance/docs/architecture/multi-tenancy-design.md §"Tenant Resolution
 * From Host" and governance/docs/services/identity-and-tenant.md
 * (§"Bind session ↔ tenant on every request").
 *
 * Security contract (the reason this module is sev-0):
 *   1. The Host is parsed only AFTER the edge/origin has validated it against
 *      an allowlisted apex. A client-supplied Host / X-Forwarded-Host is never
 *      trusted (anti host-header-spoofing). We re-use `resolveHost` from
 *      `@/lib/tenant/host` for parsing — never a client-provided tenant id.
 *   2. Tenant context `{ userId, tenantId, role }` is ALWAYS re-derived
 *      server-side; the client-provided value is a hint only.
 *   3. The authenticated user's MEMBERSHIP in the host's tenant is verified on
 *      every request (session↔tenant binding); a mismatch is DENIED.
 *   4. Unknown/invalid subdomain, suspended/deleting tenant, or non-member →
 *      fail closed.
 *
 * Scaffold note: every method throws `NotImplementedError`. No DB/session.
 *
 * Shared-type note: `AuthSession` below is a deliberately minimal local shape
 * (the authenticated `auth.users` id). The authentication module is built
 * concurrently and MUST NOT be imported here; when a richer shared session
 * type lands, this can be narrowed to it.
 */

import {
  NotImplementedError,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import type { Tenant } from "./types";

/**
 * Minimal authenticated-session shape this module needs in order to bind a
 * session to a tenant. Owned locally to avoid importing the auth module; carries
 * only the verified Supabase `auth.users` id.
 */
export interface AuthSession {
  readonly userId: string;
}

/** Inputs to the server-side tenant-context re-derivation. */
export interface DeriveTenantContextInput {
  /** The verified session (server-trusted), or null when unauthenticated. */
  readonly session: AuthSession | null;
  /**
   * The request Host as served by our edge/origin (already validated upstream).
   * Parsed with `resolveHost`; never a client-asserted tenant id.
   */
  readonly host: string | null;
}

/**
 * Tenant resolution + the session↔tenant binding. The single authority other
 * server actions/loaders/jobs call to obtain a trusted `TenantContext`.
 *
 * Scaffold: every method throws `NotImplementedError`.
 */
export interface TenantResolutionService {
  /**
   * Resolve a tenant by its subdomain slug (cached lookup against
   * `tenant_domains`). Returns a failed `Result` (fail closed) when the slug is
   * unknown, or when the tenant is `suspended`/`deleting`/`deleted`.
   */
  resolveTenantBySubdomain(slug: string): Promise<Result<Tenant>>;

  /**
   * Re-derive the trusted `{ userId, tenantId, tenantSlug, role }` for the
   * current request:
   *   - parse `host` via `resolveHost` to a slug (apex/reserved/invalid →
   *     denied: those route to marketing/auth, not the tenant app);
   *   - resolve the tenant for that slug;
   *   - require an authenticated `session`;
   *   - verify the user's `tenant_users` membership in THAT tenant — deny on
   *     mismatch (`TenantIsolationError`), with RLS as the DB backstop.
   *
   * Returns `Result<TenantContext>`; never trusts a client-supplied tenant id.
   */
  deriveTenantContext(
    input: DeriveTenantContextInput,
  ): Promise<Result<TenantContext>>;
}

/** Scaffold stub. Wiring requires Supabase + a validated host pipeline. */
export const tenantResolutionService: TenantResolutionService = {
  async resolveTenantBySubdomain() {
    throw new NotImplementedError(
      "identityTenant.resolution.resolveTenantBySubdomain",
    );
  },
  async deriveTenantContext() {
    throw new NotImplementedError(
      "identityTenant.resolution.deriveTenantContext",
    );
  },
};
