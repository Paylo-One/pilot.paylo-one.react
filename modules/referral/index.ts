import "server-only";

/**
 * modules/referral — each user has ONE personal referral code with an allocation
 * of invitation uses (default 5). The owner shares the link; anyone may use it
 * during onboarding. Each successful signup records a usage; when usage reaches
 * the allocation the code is suspended and can no longer be used. Allocation is
 * stored (not hardcoded) so it can be raised for selected users later.
 *
 * All writes use the service-role client with explicit predicates (creation runs
 * at provisioning; consumption is a cross-user write; suspension is automatic).
 * The owner reads their own code + usages via RLS. The audit trail reuses
 * `audit_events`. Governance: governance/docs/product/access-and-invitations.md.
 */

import { randomInt } from "node:crypto";
import {
  AppError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { appHostBaseUrl } from "@/lib/config";

/** Invitation uses a new code starts with. Stored per-code; not a UI constant. */
export const DEFAULT_REFERRAL_ALLOCATION = 5;

export type ReferralStatus = "active" | "suspended";
export type ReferralOnboardingStatus = "pending" | "completed" | "expired";
export type ReferralValidationStatus =
  | "valid"
  | "not_found"
  | "suspended"
  | "exhausted";

export interface ReferralValidation {
  readonly status: ReferralValidationStatus;
  readonly code: string | null;
  readonly allocation: number | null;
  readonly used: number | null;
  readonly remaining: number | null;
}

export type ReferralReservationOutcome =
  | "reserved"
  | "not_found"
  | "self_referral"
  | "exhausted";

/** Apex-scoped cookie carrying a validated referral through authentication. */
export const REFERRAL_COOKIE = "paylo_ref";

/** A captured referral remains available for two weeks. */
export const REFERRAL_TTL_SECONDS = 14 * 24 * 60 * 60;

/** The owner-facing summary of their referral code. */
export interface ReferralOverview {
  readonly code: string;
  readonly link: string;
  readonly allocation: number;
  readonly used: number;
  readonly remaining: number;
  readonly status: ReferralStatus;
}

/** One person who joined through the owner's code (serialisable for the UI). */
export interface ReferralUsageView {
  readonly id: string;
  readonly referredName: string | null;
  readonly referredEmail: string | null;
  readonly onboardingStatus: ReferralOnboardingStatus;
  /** Derived account status: true once the referred user has a workspace. */
  readonly hasWorkspace: boolean;
  readonly createdAt: string;
}

// Unambiguous alphabet (no 0/O/1/I/L) for human-shareable codes like ABCD-EFGH-JKLM.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i += 1) {
    raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Normalise an inbound code (uppercase; keep the dashed shape). */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** The absolute link the owner shares; lands new users on the /join handler. */
export function referralLink(code: string): string {
  return `${appHostBaseUrl()}/join/${code}`;
}

interface ReferralCodeRow {
  id: string;
  owner_user_id: string;
  tenant_id: string | null;
  code: string;
  allocation: number;
  status: ReferralStatus;
}

const CODE_COLUMNS = "id, owner_user_id, tenant_id, code, allocation, status";

type SecretClient = ReturnType<typeof createSupabaseSecretClient>;

/** Best-effort audit; never let an audit write break referral logic. */
async function audit(
  secret: SecretClient,
  row: {
    tenantId: string | null;
    userId: string;
    action: string;
    target: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    if (!row.tenantId) return;
    await secret.from("audit_events").insert({
      tenant_id: row.tenantId,
      user_id: row.userId,
      action: row.action,
      target: row.target,
      metadata: row.metadata ?? null,
    });
  } catch {
    /* audit is best-effort */
  }
}

async function countUsages(
  secret: SecretClient,
  referralCodeId: string,
): Promise<number> {
  const { count } = await secret
    .from("referral_usages")
    .select("id", { count: "exact", head: true })
    .eq("referral_code_id", referralCodeId);
  return count ?? 0;
}

export interface ReferralService {
  /** Idempotently ensure the owner has a code (used at provisioning + reads). */
  getOrCreateForOwner(
    ownerUserId: string,
    tenantId: string | null,
  ): Promise<Result<ReferralCodeRow>>;
  /** Owner-facing overview (code, link, allocation, used, remaining, status). */
  getOverview(ctx: TenantContext): Promise<Result<ReferralOverview>>;
  /** The people who joined through the owner's code, newest first. */
  listUsages(ctx: TenantContext): Promise<Result<ReferralUsageView[]>>;
  /** Explain whether a code can currently admit another person. */
  validateCode(code: string): Promise<Result<ReferralValidation>>;
  /** Atomically reserve one invitation slot before tenant provisioning starts. */
  reserve(input: {
    code: string;
    referredUserId: string;
    referredEmail: string | null;
  }): Promise<
    Result<{
      outcome: ReferralReservationOutcome;
      reservationId: string | null;
    }>
  >;
  /** Attach a successful workspace provision to its reserved referral slot. */
  completeReservation(
    reservationId: string,
    referredTenantId: string,
  ): Promise<Result<void>>;
  /** Release a pending reservation when provisioning fails. */
  releaseReservation(reservationId: string): Promise<Result<void>>;
  /** Grant additional invitation uses (re-activates a suspended code). */
  topUp(ownerUserId: string, additional: number): Promise<Result<void>>;
}

export const referralService: ReferralService = {
  async getOrCreateForOwner(ownerUserId, tenantId) {
    const secret = createSupabaseSecretClient();

    const { data: existing, error: readErr } = await secret
      .from("referral_codes")
      .select(CODE_COLUMNS)
      .eq("owner_user_id", ownerUserId)
      .maybeSingle();
    if (readErr) return err(new AppError("internal", readErr.message));
    if (existing) return ok(existing as ReferralCodeRow);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      const { data, error } = await secret
        .from("referral_codes")
        .insert({
          owner_user_id: ownerUserId,
          tenant_id: tenantId,
          code,
          allocation: DEFAULT_REFERRAL_ALLOCATION,
          status: "active",
        })
        .select(CODE_COLUMNS)
        .single();

      if (!error && data) {
        await audit(secret, {
          tenantId,
          userId: ownerUserId,
          action: "referral.created",
          target: (data as ReferralCodeRow).id,
          metadata: { code },
        });
        return ok(data as ReferralCodeRow);
      }
      // 23505 = unique violation: either the owner already has one (race) or a
      // code collision. Re-check the owner; otherwise retry with a fresh code.
      if (error?.code === "23505") {
        const { data: race } = await secret
          .from("referral_codes")
          .select(CODE_COLUMNS)
          .eq("owner_user_id", ownerUserId)
          .maybeSingle();
        if (race) return ok(race as ReferralCodeRow);
        continue;
      }
      return err(new AppError("internal", error?.message ?? "referral_create_failed"));
    }
    return err(new AppError("internal", "referral_code_unavailable"));
  },

  async getOverview(ctx) {
    const created = await this.getOrCreateForOwner(ctx.userId, ctx.tenantId);
    if (!created.ok) return created;
    const codeRow = created.value;

    const secret = createSupabaseSecretClient();
    const used = await countUsages(secret, codeRow.id);
    const remaining = Math.max(0, codeRow.allocation - used);

    return ok({
      code: codeRow.code,
      link: referralLink(codeRow.code),
      allocation: codeRow.allocation,
      used,
      remaining,
      status: codeRow.status,
    });
  },

  async listUsages(ctx) {
    const created = await this.getOrCreateForOwner(ctx.userId, ctx.tenantId);
    if (!created.ok) return created;

    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("referral_usages")
      .select(
        "id, referred_user_id, referred_email, referred_tenant_id, onboarding_status, created_at",
      )
      .eq("referral_code_id", created.value.id)
      .order("created_at", { ascending: false });
    if (error) return err(new AppError("internal", error.message));

    interface UsageRow {
      id: string;
      referred_user_id: string | null;
      referred_email: string | null;
      referred_tenant_id: string | null;
      onboarding_status: ReferralOnboardingStatus;
      created_at: string;
    }
    const rows = (data as UsageRow[]) ?? [];

    // Resolve display names from public.user_profiles (no auth-schema access).
    const referredIds = [
      ...new Set(rows.map((r) => r.referred_user_id).filter((v): v is string => !!v)),
    ];
    const names = new Map<string, string>();
    if (referredIds.length > 0) {
      const { data: profiles } = await secret
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", referredIds);
      for (const p of (profiles as { user_id: string; display_name: string | null }[]) ?? []) {
        if (p.display_name) names.set(p.user_id, p.display_name);
      }
    }

    return ok(
      rows.map((r) => ({
        id: r.id,
        referredName: r.referred_user_id ? names.get(r.referred_user_id) ?? null : null,
        referredEmail: r.referred_email,
        onboardingStatus: r.onboarding_status,
        hasWorkspace: r.referred_tenant_id !== null,
        createdAt: r.created_at,
      })),
    );
  },

  async validateCode(code) {
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("referral_codes")
      .select("id, allocation, status, code")
      .eq("code", normaliseCode(code))
      .maybeSingle();
    if (error) return err(new AppError("internal", error.message));
    if (!data) {
      return ok({
        status: "not_found",
        code: null,
        allocation: null,
        used: null,
        remaining: null,
      });
    }

    const row = data as { id: string; allocation: number; status: ReferralStatus; code: string };
    const used = await countUsages(secret, row.id);
    const remaining = Math.max(0, row.allocation - used);

    return ok({
      status:
        used >= row.allocation
          ? "exhausted"
          : row.status === "suspended"
            ? "suspended"
            : "valid",
      code: row.code,
      allocation: row.allocation,
      used,
      remaining,
    });
  },

  async reserve(input) {
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret.rpc("reserve_referral", {
      p_code: normaliseCode(input.code),
      p_referred_user_id: input.referredUserId,
      p_referred_email: input.referredEmail,
    });
    if (error) return err(new AppError("internal", error.message));

    const row = (
      data as
        | { usage_id: string | null; outcome: ReferralReservationOutcome }[]
        | null
    )?.[0];
    if (!row) return err(new AppError("internal", "referral_reservation_failed"));

    return ok({
      outcome: row.outcome,
      reservationId: row.usage_id,
    });
  },

  async completeReservation(reservationId, referredTenantId) {
    const secret = createSupabaseSecretClient();
    const { error } = await secret
      .from("referral_usages")
      .update({
        referred_tenant_id: referredTenantId,
        onboarding_status: "completed",
      })
      .eq("id", reservationId)
      .eq("onboarding_status", "pending");
    if (error) return err(new AppError("internal", error.message));
    return ok(undefined);
  },

  async releaseReservation(reservationId) {
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("referral_usages")
      .delete()
      .eq("id", reservationId)
      .eq("onboarding_status", "pending")
      .select("referral_code_id")
      .maybeSingle();
    if (error) return err(new AppError("internal", error.message));

    if (data?.referral_code_id) {
      const { data: code } = await secret
        .from("referral_codes")
        .select("id, allocation")
        .eq("id", data.referral_code_id)
        .maybeSingle();
      if (code) {
        const used = await countUsages(secret, code.id as string);
        if (used < (code.allocation as number)) {
          await secret
            .from("referral_codes")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("id", code.id);
        }
      }
    }
    return ok(undefined);
  },

  async topUp(ownerUserId, additional) {
    if (!Number.isInteger(additional) || additional <= 0) {
      return err(new AppError("validation_failed", "Top-up must be a positive whole number."));
    }
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("referral_codes")
      .select(CODE_COLUMNS)
      .eq("owner_user_id", ownerUserId)
      .maybeSingle();
    if (error) return err(new AppError("internal", error.message));
    if (!data) return err(new AppError("not_found", "No referral code for that user."));

    const codeRow = data as ReferralCodeRow;
    const { error: updateErr } = await secret
      .from("referral_codes")
      .update({
        allocation: codeRow.allocation + additional,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", codeRow.id);
    if (updateErr) return err(new AppError("internal", updateErr.message));

    await audit(secret, {
      tenantId: codeRow.tenant_id,
      userId: ownerUserId,
      action: "referral.topped_up",
      target: codeRow.id,
      metadata: { additional },
    });
    return ok(undefined);
  },
};
