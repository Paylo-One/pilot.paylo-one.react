/**
 * modules/identity-tenant/subdomain.ts
 *
 * Subdomain selection for tenant onboarding. Governance:
 * governance/docs/architecture/multi-tenancy-design.md
 * §"Subdomain Selection & Uniqueness".
 *
 * The DNS-safe pattern + the reserved blocklist live in `@/lib/tenant/host`
 * and are SHARED with request routing (proxy.ts) so selection and routing can
 * never diverge (multi-tenancy-design.md §"Reserved subdomain collision").
 * This module imports and re-uses them; it MUST NOT redefine the reserved list
 * or the pattern.
 *
 * Selection is a transaction: check → reserve → confirm. Uniqueness is
 * ultimately enforced by a `unique` constraint on `tenant_domains.subdomain`
 * (and `tenants.slug`); the check is an early, friendly signal, not the
 * authority — the DB constraint is.
 *
 * Scaffold note: the pure validation below is real; the stateful flow methods
 * (which need a DB) throw `NotImplementedError`.
 */

import {
  NotImplementedError,
  type Result,
} from "@/modules/shared";
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_PATTERN,
  isSelectableSubdomain,
} from "@/lib/tenant/host";
import type { TenantDomain } from "./types";

/** Why a candidate subdomain was rejected by local (pre-DB) validation. */
export type SubdomainRejectionReason =
  | "too_short_or_invalid_chars"
  | "reserved";

/** Outcome of a pure, local (no-DB) syntactic check of a candidate label. */
export type LocalSubdomainCheck =
  | { readonly selectable: true }
  | { readonly selectable: false; readonly reason: SubdomainRejectionReason };

/**
 * Pure, synchronous, no-network check that a candidate label is syntactically
 * valid AND not reserved. Re-uses `isSelectableSubdomain` / `SUBDOMAIN_PATTERN`
 * / `RESERVED_SUBDOMAINS` from the shared host module — this is the single
 * source of truth shared with routing.
 *
 * This does NOT check DB uniqueness (that is `checkAvailability`).
 */
export function checkSubdomainLocally(label: string): LocalSubdomainCheck {
  const normalised = label.toLowerCase().trim();
  if (isSelectableSubdomain(normalised)) return { selectable: true };
  // Distinguish "reserved" from "bad shape" for a clearer onboarding message.
  if (RESERVED_SUBDOMAINS.has(normalised) && SUBDOMAIN_PATTERN.test(normalised)) {
    return { selectable: false, reason: "reserved" };
  }
  return { selectable: false, reason: "too_short_or_invalid_chars" };
}

/** Availability signal returned by the (DB-backed) check step. */
export interface SubdomainAvailability {
  readonly slug: string;
  /** True iff locally selectable AND not already taken/held in the DB. */
  readonly available: boolean;
  /** Present when `available === false` to explain why. */
  readonly reason?: SubdomainRejectionReason | "already_taken" | "held";
}

/**
 * A short-lived hold on a subdomain placed during onboarding so a concurrent
 * operator cannot claim it between `check` and `confirm`. Released on expiry.
 */
export interface SubdomainReservation {
  readonly reservationId: string;
  readonly slug: string;
  /** ISO timestamp after which the hold lapses and the slug frees up. */
  readonly expiresAt: string;
}

/**
 * The stateful check → reserve → confirm flow (multi-tenancy-design.md
 * §"Subdomain Selection & Uniqueness"). Each step is a DB transaction; the
 * authority for uniqueness is the `unique` constraint, surfaced here.
 *
 * Scaffold: every method throws `NotImplementedError`.
 */
export interface SubdomainSelectionService {
  /**
   * Step 1 — CHECK. Local syntactic/reserved validation, then a DB lookup for
   * an existing `tenant_domains.subdomain` or active hold.
   */
  checkAvailability(slug: string): Promise<Result<SubdomainAvailability>>;

  /**
   * Step 2 — RESERVE. Place a short-lived hold so the slug cannot be taken
   * between check and confirm. Idempotent per (slug, onboarding session).
   */
  reserve(slug: string): Promise<Result<SubdomainReservation>>;

  /**
   * Step 3 — CONFIRM. Atomically bind the held slug to `tenantId`, inserting
   * the `tenant_domains` row (`kind="subdomain"`, `verified=true` for
   * `*.paylo.one`). The `unique` constraint is the final arbiter; a race loses
   * here and surfaces as a failed `Result`.
   */
  confirm(
    reservationId: string,
    tenantId: string,
  ): Promise<Result<TenantDomain>>;
}

/** Scaffold stub. Pure helpers above are usable; flow methods are not built. */
export const subdomainSelectionService: SubdomainSelectionService = {
  async checkAvailability() {
    throw new NotImplementedError("identityTenant.subdomain.checkAvailability");
  },
  async reserve() {
    throw new NotImplementedError("identityTenant.subdomain.reserve");
  },
  async confirm() {
    throw new NotImplementedError("identityTenant.subdomain.confirm");
  },
};
