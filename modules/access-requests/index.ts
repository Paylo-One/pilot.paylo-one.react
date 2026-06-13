import "server-only";

/**
 * modules/access-requests — visitors asking for an invitation from the public
 * landing page. There is no tenant or signed-in user when a request is made, so
 * rows are global and every write goes through the service-role client. Reading
 * the queue is an operator task and is gated on a privileged tenant role.
 *
 * Governance: governance/docs/product/access-and-invitations.md.
 */

import {
  AppError,
  ValidationError,
  err,
  ok,
  isPrivilegedRole,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export type AccessRequestStatus = "pending" | "approved" | "declined" | "invited";

/** A stored request for access from the marketing landing page. */
export interface AccessRequest {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly companyOrRole: string | null;
  readonly reason: string | null;
  readonly status: AccessRequestStatus;
  readonly source: string;
  readonly createdAt: string;
}

/** Fields a visitor submits. Tenant/user are never part of this — there is none. */
export interface CreateAccessRequestInput {
  readonly name: string;
  readonly email: string;
  readonly companyOrRole?: string;
  readonly reason?: string;
  readonly userAgent?: string;
}

const REQUEST_COLUMNS =
  "id, name, email, company_or_role, reason, status, source, created_at";

interface AccessRequestRow {
  id: string;
  name: string;
  email: string;
  company_or_role: string | null;
  reason: string | null;
  status: AccessRequestStatus;
  source: string;
  created_at: string;
}

function mapRow(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    companyOrRole: row.company_or_role,
    reason: row.reason,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  };
}

// Deliberately forgiving: one "@" with text either side and a dot in the domain.
// Real deliverability is confirmed by the invitation email, not by this check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

export interface AccessRequestService {
  /** Store a new request. Idempotent for a still-pending email. */
  create(input: CreateAccessRequestInput): Promise<Result<{ duplicate: boolean }>>;
  /** Privileged: the most recent access requests for review. */
  listForReview(
    ctx: TenantContext,
    limit?: number,
  ): Promise<Result<AccessRequest[]>>;
  /** Privileged: count of requests still awaiting a decision. */
  countPending(ctx: TenantContext): Promise<Result<number>>;
}

export const accessRequestService: AccessRequestService = {
  async create(input) {
    const name = clean(input.name, 120);
    const email = clean(input.email, 200).toLowerCase();
    const companyOrRole = clean(input.companyOrRole, 160);
    const reason = clean(input.reason, 2000);

    if (name.length === 0) {
      return err(new ValidationError("Please enter your name."));
    }
    if (!EMAIL_RE.test(email)) {
      return err(new ValidationError("Please enter a valid email address."));
    }

    const secret = createSupabaseSecretClient();

    // Idempotent: if this address already has a pending request, treat the
    // submission as success without creating a duplicate (and without leaking
    // whether the address is already known).
    const { data: existing, error: existingError } = await secret
      .from("access_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return err(new AppError("internal", existingError.message));
    }
    if (existing) {
      return ok({ duplicate: true });
    }

    const { error } = await secret.from("access_requests").insert({
      name,
      email,
      company_or_role: companyOrRole || null,
      reason: reason || null,
      source: "marketing",
      user_agent: clean(input.userAgent, 400) || null,
    });

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok({ duplicate: false });
  },

  async listForReview(ctx, limit = 50) {
    if (!isPrivilegedRole(ctx.role)) {
      return err(
        new AppError("policy_denied", "Only workspace admins can view access requests."),
      );
    }
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("access_requests")
      .select(REQUEST_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok((data as AccessRequestRow[]).map(mapRow));
  },

  async countPending(ctx) {
    if (!isPrivilegedRole(ctx.role)) {
      return err(
        new AppError("policy_denied", "Only workspace admins can view access requests."),
      );
    }
    const secret = createSupabaseSecretClient();
    const { count, error } = await secret
      .from("access_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) {
      return err(new AppError("internal", error.message));
    }
    return ok(count ?? 0);
  },
};
