/**
 * modules/identity-tenant — the multi-tenancy pillar (highest blast radius).
 *
 * Governance:
 *   - governance/docs/architecture/multi-tenancy-design.md
 *   - governance/docs/services/identity-and-tenant.md
 *
 * Owns the multi-tenancy primitives every other module depends on: tenants,
 * membership, subdomains, roles, the server-side tenant-context re-derivation,
 * the session↔tenant binding, and tenant provisioning. It is the source of
 * truth for the RLS predicate used across the database.
 *
 * Module boundary: depends ONLY on `@/modules/shared` and `@/lib/tenant/host`.
 * It does NOT import the authentication module (built concurrently); the
 * minimal `AuthSession` shape it needs is defined locally in `resolution.ts`.
 * Other modules consume this module only via the exported service below.
 *
 * ---------------------------------------------------------------------------
 * RLS ISOLATION MODEL (canonical) — multi-tenancy-design.md §"Supabase RLS
 * Enforcement". This is documented here, in the owning module, so the database
 * predicate and the application's `TenantContext` never drift apart.
 *
 *   Isolation: shared Postgres, shared schema, a `tenant_id` column on EVERY
 *   tenant-owned table, with RLS ENABLED + default-deny on every such table.
 *
 *   Canonical predicate — a row is visible iff its `tenant_id` is one of the
 *   tenants the authenticated user belongs to:
 *
 *     tenant_id in (
 *       select tu.tenant_id from tenant_users tu where tu.user_id = auth.uid()
 *     )
 *
 *   Centralised in a SECURITY DEFINER, STABLE helper so policies stay uniform:
 *
 *     create or replace function auth_tenant_ids()
 *       returns setof uuid language sql stable security definer
 *     as $$
 *       select tu.tenant_id from tenant_users tu where tu.user_id = auth.uid()
 *     $$;
 *
 *     -- applied to every tenant-owned table, e.g.:
 *     alter table briefings enable row level security;
 *     create policy tenant_isolation on briefings
 *       using      ( tenant_id in (select auth_tenant_ids()) )
 *       with check ( tenant_id in (select auth_tenant_ids()) );
 *
 *   Diary rows additionally carry `author_user_id` and restrict to the author
 *   (private by default) even within a multi-user tenant.
 *
 *   Two-tier enforcement:
 *     - User-context queries use the anon/auth client → RLS is ACTIVE.
 *     - Background jobs use the service-role client → RLS is BYPASSED, so the
 *       job's explicit `tenant_id` filter is the developer's responsibility
 *       (enforced by code review + tests). Application-level checks
 *       (`deriveTenantContext`, membership binding) are the first line; RLS is
 *       the database-level backstop.
 *
 * See app/supabase/migrations/0001_tenancy.sql for the (commented, non-executed)
 * schema + policies that mirror this model.
 * ---------------------------------------------------------------------------
 */

import type { Result, TenantContext } from "@/modules/shared";
import type { Tenant } from "./types";
import {
  subdomainSelectionService,
  type SubdomainSelectionService,
} from "./subdomain";
import {
  tenantResolutionService,
  type DeriveTenantContextInput,
  type TenantResolutionService,
} from "./resolution";
import {
  tenantProvisioningService,
  type TenantProvisioningService,
} from "./provisioning";

// --- Domain types -----------------------------------------------------------
export type {
  Tenant,
  TenantUser,
  TenantDomain,
  TenantDomainKind,
  TenantStatus,
  UserProfile,
} from "./types";

// --- Subdomain selection ----------------------------------------------------
export {
  checkSubdomainLocally,
  subdomainSelectionService,
} from "./subdomain";
export type {
  LocalSubdomainCheck,
  SubdomainAvailability,
  SubdomainRejectionReason,
  SubdomainReservation,
  SubdomainSelectionService,
} from "./subdomain";

// --- Tenant resolution + session↔tenant binding -----------------------------
export { tenantResolutionService } from "./resolution";
export type {
  AuthSession,
  DeriveTenantContextInput,
  TenantResolutionService,
} from "./resolution";

// --- Provisioning -----------------------------------------------------------
export {
  DEFAULT_RETENTION_POLICY,
  tenantProvisioningService,
} from "./provisioning";
export type {
  ProvisionTenantInput,
  ProvisionTenantResult,
  TenantProvisioningService,
} from "./provisioning";

/**
 * The aggregate interface other modules import. Composes the three sub-services
 * (subdomain selection, tenant resolution, provisioning) plus the two most
 * commonly-called resolution methods promoted to the top level for ergonomics.
 */
export interface IdentityTenantService {
  /** Subdomain check → reserve → confirm flow. */
  readonly subdomains: SubdomainSelectionService;
  /** Host/slug resolution + session↔tenant binding. */
  readonly resolution: TenantResolutionService;
  /** Tenant provisioning pipeline. */
  readonly provisioning: TenantProvisioningService;

  /** Convenience: resolve a tenant by subdomain slug (fails closed). */
  resolveTenantBySubdomain(slug: string): Promise<Result<Tenant>>;
  /** Convenience: re-derive trusted `TenantContext` for the current request. */
  deriveTenantContext(
    input: DeriveTenantContextInput,
  ): Promise<Result<TenantContext>>;
}

/**
 * Scaffold implementation. Sub-services are wired in; every runtime path
 * ultimately throws `NotImplementedError` until the module is built.
 */
export const identityTenantService: IdentityTenantService = {
  subdomains: subdomainSelectionService,
  resolution: tenantResolutionService,
  provisioning: tenantProvisioningService,

  resolveTenantBySubdomain(slug) {
    return tenantResolutionService.resolveTenantBySubdomain(slug);
  },
  deriveTenantContext(input) {
    return tenantResolutionService.deriveTenantContext(input);
  },
};
