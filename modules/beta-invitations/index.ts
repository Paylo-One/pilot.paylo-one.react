import "server-only";

/**
 * modules/beta-invitations — each beta user can invite a small, fixed number of
 * other people (the allowance). Invitations are inviter-owned and tenant-scoped;
 * status moves pending -> accepted | expired | revoked.
 *
 * All operations use the service-role client with explicit tenant_id +
 * inviter_user_id predicates (the RLS policy is a backstop). The allowance cap
 * is enforced here, in the application layer, and stale pending invitations are
 * lazily expired so the allowance and the duplicate guard stay accurate.
 *
 * Governance: governance/docs/product/access-and-invitations.md.
 */

import { randomBytes } from "node:crypto";
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
import { tenantBaseUrl } from "@/lib/config";

/** Invitations granted to each beta user. */
export const INVITATION_ALLOWANCE = 5;

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

/** Statuses that consume one of the inviter's allowance slots. */
const CONSUMING_STATUSES: InvitationStatus[] = ["pending", "accepted"];

export interface BetaInvitation {
  readonly id: string;
  readonly email: string;
  readonly status: InvitationStatus;
  readonly token: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
}

/** A beta user's invitation budget. */
export interface InvitationAllowance {
  readonly total: number;
  readonly used: number;
  readonly remaining: number;
}

/** Admin view: an invitation plus who sent it. */
export interface TenantInvitation extends BetaInvitation {
  readonly inviterUserId: string;
  readonly inviterName: string;
}

const COLUMNS =
  "id, email, status, token, created_at, expires_at, accepted_at, inviter_user_id, tenant_id";

interface InvitationRow {
  id: string;
  email: string;
  status: InvitationStatus;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  inviter_user_id: string;
  tenant_id: string;
}

function mapRow(row: InvitationRow): BetaInvitation {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SecretClient = ReturnType<typeof createSupabaseSecretClient>;

/**
 * Flip any of this tenant's pending invitations whose expiry has passed to
 * "expired", so the allowance count and the live-email duplicate guard reflect
 * reality. Cheap no-op when nothing is stale.
 */
async function expireStale(secret: SecretClient, tenantId: string): Promise<void> {
  await secret
    .from("beta_invitations")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}

/** The absolute invitation link a beta user shares. */
export function invitationLink(ctx: TenantContext, token: string): string {
  return `${tenantBaseUrl(ctx.tenantSlug)}/invite?token=${token}`;
}

export interface BetaInvitationService {
  /** The signed-in user's own invitations, newest first. */
  listMine(ctx: TenantContext): Promise<Result<BetaInvitation[]>>;
  /** How many invitations the signed-in user has used and has left. */
  allowance(ctx: TenantContext): Promise<Result<InvitationAllowance>>;
  /** Send an invitation to an email address (enforces the allowance cap). */
  create(ctx: TenantContext, email: string): Promise<Result<BetaInvitation>>;
  /** Revoke one of the user's own still-pending invitations. */
  revoke(ctx: TenantContext, id: string): Promise<Result<void>>;
  /** Privileged: every invitation in the workspace, with sender names. */
  listForTenant(ctx: TenantContext): Promise<Result<TenantInvitation[]>>;
}

export const betaInvitationService: BetaInvitationService = {
  async listMine(ctx) {
    const secret = createSupabaseSecretClient();
    await expireStale(secret, ctx.tenantId);

    const { data, error } = await secret
      .from("beta_invitations")
      .select(COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("inviter_user_id", ctx.userId)
      .order("created_at", { ascending: false });

    if (error) return err(new AppError("internal", error.message));
    return ok((data as InvitationRow[]).map(mapRow));
  },

  async allowance(ctx) {
    const secret = createSupabaseSecretClient();
    await expireStale(secret, ctx.tenantId);

    const { count, error } = await secret
      .from("beta_invitations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("inviter_user_id", ctx.userId)
      .in("status", CONSUMING_STATUSES);

    if (error) return err(new AppError("internal", error.message));
    const used = count ?? 0;
    return ok({
      total: INVITATION_ALLOWANCE,
      used,
      remaining: Math.max(0, INVITATION_ALLOWANCE - used),
    });
  },

  async create(ctx, emailRaw) {
    const email = emailRaw.trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) {
      return err(new ValidationError("Please enter a valid email address."));
    }

    const secret = createSupabaseSecretClient();
    await expireStale(secret, ctx.tenantId);

    // Re-check the allowance authoritatively right before inserting.
    const { count, error: countError } = await secret
      .from("beta_invitations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("inviter_user_id", ctx.userId)
      .in("status", CONSUMING_STATUSES);

    if (countError) return err(new AppError("internal", countError.message));
    if ((count ?? 0) >= INVITATION_ALLOWANCE) {
      return err(
        new AppError(
          "policy_denied",
          "You have used all of your invitations. Revoke a pending one to free a slot.",
        ),
      );
    }

    const token = randomBytes(24).toString("hex");
    const { data, error } = await secret
      .from("beta_invitations")
      .insert({
        tenant_id: ctx.tenantId,
        inviter_user_id: ctx.userId,
        email,
        token,
        status: "pending",
      })
      .select(COLUMNS)
      .single();

    if (error || !data) {
      // The partial unique index rejects a second live invite to the same
      // address; surface that as a clear, non-technical message.
      if (error?.code === "23505") {
        return err(
          new AppError(
            "validation_failed",
            "There is already a pending invitation for that email address.",
          ),
        );
      }
      return err(new AppError("internal", error?.message ?? "create_failed"));
    }
    return ok(mapRow(data as InvitationRow));
  },

  async revoke(ctx, id) {
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("beta_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("inviter_user_id", ctx.userId)
      .eq("status", "pending")
      .select("id");

    if (error) return err(new AppError("internal", error.message));
    if (!data || data.length === 0) {
      return err(
        new AppError("not_found", "That invitation is no longer pending."),
      );
    }
    return ok(undefined);
  },

  async listForTenant(ctx) {
    if (!isPrivilegedRole(ctx.role)) {
      return err(
        new AppError(
          "policy_denied",
          "Only workspace admins can view all invitations.",
        ),
      );
    }
    const secret = createSupabaseSecretClient();
    await expireStale(secret, ctx.tenantId);

    const { data, error } = await secret
      .from("beta_invitations")
      .select(COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });

    if (error) return err(new AppError("internal", error.message));
    const rows = data as InvitationRow[];

    // Resolve sender display names from public.user_profiles (no auth schema
    // access needed); fall back gracefully when a profile has no name.
    const inviterIds = [...new Set(rows.map((r) => r.inviter_user_id))];
    const names = new Map<string, string>();
    if (inviterIds.length > 0) {
      const { data: profiles } = await secret
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", inviterIds);
      for (const p of (profiles as { user_id: string; display_name: string | null }[]) ?? []) {
        if (p.display_name) names.set(p.user_id, p.display_name);
      }
    }

    return ok(
      rows.map((row) => ({
        ...mapRow(row),
        inviterUserId: row.inviter_user_id,
        inviterName:
          row.inviter_user_id === ctx.userId
            ? "You"
            : names.get(row.inviter_user_id) ?? "Workspace member",
      })),
    );
  },
};
