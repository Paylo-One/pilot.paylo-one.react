/**
 * /api/model-gateway — the internal boundary of the Paylo Model Gateway
 * (architecture/model-inference-architecture.md §5, §43; services/
 * model-gateway-service.md "MVP implementation").
 *
 * SECURITY BOUNDARY (security-and-privacy.md §"Model Gateway & Inference
 * Security"):
 *  - Provider API keys and the (future) vLLM endpoint are SERVER-SIDE ONLY
 *    (env/Vault) — never sent to the browser, never in tenant-readable tables,
 *    never logged.
 *  - The browser/tenant NEVER reaches a model provider or vLLM directly: the
 *    browser calls the app; the app/agents call the Gateway module
 *    (`@/modules/model-gateway`); only the Gateway reaches providers/vLLM via
 *    server-side adapters.
 *  - For the MVP, inference is driven in-process by agents/workflows through the
 *    `modelGateway` service, not over HTTP. This endpoint exists to mark the
 *    `/api/model-gateway` boundary and is intentionally NOT a public inference
 *    API.
 *
 * Scaffold note: returns 501 Not Implemented. No provider/vLLM call is wired.
 */

import { NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { resolveTenantContext } from "@/modules/identity-tenant/server";
import { resolveEntitlements, requireWithinLimit } from "@/modules/billing";

/** Shared 501 response for every method on this not-yet-built boundary. */
function notImplemented() {
  return NextResponse.json(
    {
      status: "not_implemented",
      service: "model-gateway",
      scaffold: true,
      message:
        "Model Gateway boundary is not implemented. Provider/vLLM access is server-side only; the browser and tenants never reach a provider or vLLM directly.",
    },
    { status: 501 },
  );
}

async function runBillingChecks(tenantId: string) {
  try {
    const resolved = await resolveEntitlements({ tenantId });
    if (!resolved.ok) {
      console.warn(
        "[billing][observe] Model gateway checks: entitlement resolution failed; allowing (fail-open)",
        { tenantId, error: resolved.error.code },
      );
      return;
    }

    const entitlements = resolved.value;

    // 1. check canUseBYOApiKeys capability (observe-only)
    if (!entitlements.canUseBYOApiKeys) {
      console.warn(
        "[billing][observe] canUseBYOApiKeys: WOULD block API gateway request (observe-only; allowing)",
        { tenantId }
      );
    }

    // 2. check monthlyAiTokenAllowance limit (observe-only)
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const startOfMonthStr = startOfMonth.toISOString();

    const secret = createSupabaseSecretClient();
    const { data: usageRows, error: usageError } = await secret
      .from("model_usage")
      .select("total_tokens")
      .eq("tenant_id", tenantId)
      .gte("created_at", startOfMonthStr);

    if (usageError) {
      console.warn(
        "[billing][observe] monthlyAiTokenAllowance: failed to count token usage; allowing (fail-open)",
        { tenantId, error: usageError.message }
      );
      return;
    }

    const currentTokens = (usageRows ?? []).reduce((sum, row) => sum + (row.total_tokens ?? 0), 0);
    const decision = requireWithinLimit(entitlements, "monthlyAiTokenAllowance", currentTokens, 1);
    if (!decision.ok) {
      const detail = decision.error.detail ?? {};
      console.warn(
        "[billing][observe] monthlyAiTokenAllowance: WOULD block API gateway request (observe-only; allowing)",
        {
          tenantId,
          currentTokens,
          ...detail,
        }
      );
    }
  } catch (cause) {
    console.warn(
      "[billing][observe] Model gateway checks: check errored; allowing (fail-open)",
      {
        tenantId,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
}

export async function GET() {
  const resolution = await resolveTenantContext();
  if (resolution.kind === "ok") {
    await runBillingChecks(resolution.context.tenantId);
  }
  return notImplemented();
}

export async function POST() {
  const resolution = await resolveTenantContext();
  if (resolution.kind === "ok") {
    await runBillingChecks(resolution.context.tenantId);
  }
  return notImplemented();
}
