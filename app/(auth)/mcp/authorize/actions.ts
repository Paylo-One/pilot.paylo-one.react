"use server";

import { redirect } from "next/navigation";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { createAuthorizationCode, parseScopes } from "@/modules/mcp";
import type { TenantContext, TenantRole } from "@/modules/shared";

async function resolveSelectedTenantContext(
  userId: string,
  tenantId: string,
): Promise<TenantContext | null> {
  const secret = createSupabaseSecretClient();
  const { data: membership, error: membershipError } = await secret
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership) return null;

  const { data: tenant, error: tenantError } = await secret
    .from("tenants")
    .select("id, slug, status")
    .eq("id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (tenantError || !tenant) return null;

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId,
    role: membership.role as TenantRole,
  };
}

export async function approveMcpClientAction(formData: FormData) {
  const user = await getSignedInUser();
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = String(formData.get("state") ?? "");
  const url = new URL(redirectUri);

  if (!user) {
    url.searchParams.set("error", "login_required");
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }

  const ctx = await resolveSelectedTenantContext(
    user.userId,
    String(formData.get("tenantId") ?? ""),
  );

  if (!ctx) {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set(
      "error_description",
      "You do not have access to the selected Pilot workspace.",
    );
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }

  const result = await createAuthorizationCode({
    ctx,
    clientId: String(formData.get("clientId") ?? ""),
    redirectUri,
    scopes: parseScopes(String(formData.get("scope") ?? "")),
    codeChallenge: String(formData.get("codeChallenge") ?? ""),
    codeChallengeMethod: String(formData.get("codeChallengeMethod") ?? "plain"),
  });

  if (!result.ok) {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", result.error.message);
  } else {
    url.searchParams.set("code", result.value);
  }
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
