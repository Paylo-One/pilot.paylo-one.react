"use server";

import { redirect } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createAuthorizationCode, parseScopes } from "@/modules/mcp";

export async function approveMcpClientAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = String(formData.get("state") ?? "");
  const result = await createAuthorizationCode({
    ctx,
    clientId: String(formData.get("clientId") ?? ""),
    redirectUri,
    scopes: parseScopes(String(formData.get("scope") ?? "")),
    codeChallenge: String(formData.get("codeChallenge") ?? ""),
    codeChallengeMethod: String(formData.get("codeChallengeMethod") ?? "plain"),
  });
  const url = new URL(redirectUri);
  if (!result.ok) {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", result.error.message);
  } else {
    url.searchParams.set("code", result.value);
  }
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
