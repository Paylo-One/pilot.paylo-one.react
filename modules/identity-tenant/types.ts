/**
 * modules/identity-tenant/types.ts
 *
 * Domain types for the multi-tenancy pillar — the workspace (`Tenant`),
 * membership (`TenantUser`), addressing (`TenantDomain`), and the app-level
 * `UserProfile`. These mirror the canonical schema in
 * governance/docs/architecture/multi-tenancy-design.md §"Example Tables" and
 * the data objects in governance/docs/services/identity-and-tenant.md.
 *
 * This module is the highest-blast-radius module in the system: it is the
 * source of truth for the tenant context + RLS predicate every other service
 * depends on. If isolation is wrong here, it is wrong everywhere.
 *
 * Scaffold note: shapes only. No persistence, no Supabase calls. `TenantRole`
 * is owned by `@/modules/shared` and re-used here (never redefined).
 */

import type { TenantRole } from "@/modules/shared";

/**
 * Tenant lifecycle status (multi-tenancy-design.md §"Tenant Provisioning",
 * §"Tenant Deletion", §"Tenant Suspension").
 *
 * - `provisioning` — being created; not yet reachable.
 * - `active`       — fully operational.
 * - `suspended`    — access blocked at the proxy, jobs paused, data retained.
 * - `deleting`     — soft-deleted; jobs stopped, hard-delete in progress.
 * - `deleted`      — terminal; tenant-owned rows + storage removed.
 */
export type TenantStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "deleting"
  | "deleted";

/** Addressing kind for a tenant domain (multi-tenancy-design.md §"Custom Domains"). */
export type TenantDomainKind = "subdomain" | "custom";

/**
 * A tenant: a private, isolated workspace. Everything the product stores is
 * owned by exactly one tenant (multi-tenancy-design.md §"Tenant Model").
 */
export interface Tenant {
  /** Stable UUID; the value carried as `tenant_id` on every owned row. */
  readonly id: string;
  /** Canonical, unique, immutable-ish slug (e.g. "alex"). */
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  /** Billing plan key; null until billing is wired. */
  readonly plan: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Membership of a user in a tenant. The model is many-to-many from day one
 * (single-user-first, multi-ready) so multi-user is a feature flag + UI later,
 * not a migration (multi-tenancy-design.md §"Single-User-First Tenant Design").
 */
export interface TenantUser {
  readonly tenantId: string;
  /** Supabase `auth.users` id. */
  readonly userId: string;
  /** Role within this tenant; `TenantRole` is shared across modules. */
  readonly role: TenantRole;
  readonly createdAt: string;
}

/**
 * A subdomain (`<slug>.paylo.one`) or, later, a verified custom domain mapped
 * to a tenant. `subdomain` and `custom_domain` are each `unique` at the DB
 * level; resolution failures fail closed (multi-tenancy-design.md
 * §"Subdomain Selection & Uniqueness", §"Tenant Resolution From Host").
 */
export interface TenantDomain {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: TenantDomainKind;
  /** Set when `kind === "subdomain"` (e.g. "alex"). */
  readonly subdomain: string | null;
  /** Set when `kind === "custom"` (e.g. "ops.acme.com"); MVP leaves null. */
  readonly customDomain: string | null;
  readonly isPrimary: boolean;
  /** Subdomains under `*.paylo.one` are auto-verified; custom domains are not. */
  readonly verified: boolean;
  readonly createdAt: string;
}

/**
 * App-level user profile (1:1 with `auth.users`). Drives the Daily Memo
 * scheduling fan-out via `timezone` + `briefingTime`
 * (multi-tenancy-design.md §"Example Tables").
 */
export interface UserProfile {
  readonly userId: string;
  readonly displayName: string | null;
  /** IANA timezone; defaults to "UTC". Drives local briefing time. */
  readonly timezone: string;
  /** Local time-of-day for the Daily Memo, e.g. "07:30"; null if unset. */
  readonly briefingTime: string | null;
  /** Used only on a neutral host to pick a tenant when membership is ambiguous. */
  readonly defaultTenantId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
