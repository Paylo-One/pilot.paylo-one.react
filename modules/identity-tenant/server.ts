import "server-only";

/**
 * modules/identity-tenant/server.ts
 *
 * Concrete, server-only implementation of tenant-context resolution and tenant
 * provisioning against Supabase. This is the operational counterpart to the
 * documented interfaces in resolution.ts / provisioning.ts / subdomain.ts.
 *
 * Security model (multi-tenancy-design.md, authentication-architecture.md §8):
 *   - Identity comes from the verified session (getClaims → auth.users id).
 *   - The tenant comes from the request host slug, attached by proxy.ts as the
 *     x-paylo-tenant-slug header. The client value is a hint only.
 *   - Session↔tenant binding is enforced by reading `tenants` through the
 *     USER's RLS-scoped client: a row is returned ONLY if the user is a member
 *     (RLS policy tenants_member_select). Non-member ⇒ no row ⇒ denied.
 *   - Provisioning + cross-tenant subdomain availability use the secret client
 *     (service_role, BYPASSRLS), always with explicit predicates.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { apexBaseUrl, tenantBaseUrl } from "@/lib/config";
import { isSelectableSubdomain } from "@/lib/tenant/host";

/** Header set by proxy.ts for a valid tenant subdomain (untrusted hint). */
const TENANT_SLUG_HEADER = "x-paylo-tenant-slug";

/** A verified signed-in user (from getClaims). */
export interface SignedInUser {
  readonly userId: string;
  readonly email: string | null;
}

/** Discriminated outcome of resolving tenant context for the current request. */
export type TenantContextResolution =
  | { readonly kind: "unauthenticated" }
  /** Authenticated, but the host is the apex/neutral (no tenant slug). */
  | { readonly kind: "no_tenant_host"; readonly user: SignedInUser }
  /** Authenticated, tenant host, but the user is not a member (fail closed). */
  | { readonly kind: "forbidden"; readonly user: SignedInUser; readonly slug: string }
  | { readonly kind: "ok"; readonly context: TenantContext };

/** Read the verified current user via getClaims (never getSession). */
export async function getSignedInUser(): Promise<SignedInUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    userId: claims.sub as string,
    email: (claims.email as string | undefined) ?? null,
  };
}

/** The (untrusted) tenant slug from the proxy-set request header, if any. */
async function requestTenantSlug(): Promise<string | null> {
  const h = await headers();
  return h.get(TENANT_SLUG_HEADER);
}

/**
 * Re-derive the trusted tenant context for the current request. Uses the user's
 * RLS-scoped client so membership is enforced by the database, not trusted from
 * the host.
 */
export async function resolveTenantContext(): Promise<TenantContextResolution> {
  const user = await getSignedInUser();
  if (!user) return { kind: "unauthenticated" };

  const slug = await requestTenantSlug();
  if (!slug) return { kind: "no_tenant_host", user };

  const supabase = await createSupabaseServerClient();

  // RLS: this returns a row ONLY if the user is a member of the tenant.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!tenant || tenant.status !== "active") {
    return { kind: "forbidden", user, slug };
  }

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.userId)
    .maybeSingle();

  if (!membership) return { kind: "forbidden", user, slug };

  return {
    kind: "ok",
    context: {
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId: user.userId,
      role: membership.role as TenantRole,
    },
  };
}

/**
 * Require a trusted tenant context inside the (app) tenant surfaces. Redirects
 * (fail closed) when not signed in, not on a tenant host, or not a member.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const resolution = await resolveTenantContext();
  switch (resolution.kind) {
    case "ok":
      return resolution.context;
    case "unauthenticated":
      redirect(`${apexBaseUrl()}/sign-in`);
    case "no_tenant_host":
      redirect(`${apexBaseUrl()}/onboarding`);
    case "forbidden":
      redirect(`${apexBaseUrl()}/sign-in?error=not_a_member`);
  }
  // Unreachable: the switch above is exhaustive and non-ok cases redirect().
  throw new Error("unreachable tenant-context resolution");
}

/** Cross-tenant subdomain availability (secret client; checks all tenants). */
export async function isSubdomainAvailable(slug: string): Promise<boolean> {
  const normalised = slug.toLowerCase().trim();
  if (!isSelectableSubdomain(normalised)) return false;

  const secret = createSupabaseSecretClient();
  const { data } = await secret
    .from("tenant_domains")
    .select("id")
    .eq("subdomain", normalised)
    .maybeSingle();

  return !data;
}

/** Find the user's primary tenant slug, if they already have one. */
export async function findPrimaryTenantSlug(
  userId: string,
): Promise<string | null> {
  const secret = createSupabaseSecretClient();
  const { data } = await secret
    .from("tenant_users")
    .select("tenants!inner(slug)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  // tenants!inner is returned as an object under the relationship key.
  const tenant = (data as { tenants?: { slug?: string } } | null)?.tenants;
  return tenant?.slug ?? null;
}

export interface ProvisionResult {
  readonly slug: string;
  /** Absolute URL of the provisioned tenant workspace. */
  readonly redirectTo: string;
}

/**
 * Provision a tenant for a signed-in user (onboarding). Runs server-side with
 * the secret client because it must create rows across tenant tables before any
 * membership exists. Idempotent-ish: if the user already has a tenant, returns
 * it instead of creating a second one.
 *
 * Order: create tenant → owner membership → tenant_domain(subdomain) →
 * user_profile(default_tenant). Mirrors multi-tenancy-design.md provisioning.
 */
export async function provisionTenantForUser(input: {
  userId: string;
  email: string | null;
  desiredSubdomain: string;
  tenantName?: string;
  displayName?: string;
}): Promise<ProvisionResult> {
  const slug = input.desiredSubdomain.toLowerCase().trim();
  if (!isSelectableSubdomain(slug)) {
    throw new Error("invalid_subdomain");
  }

  const secret = createSupabaseSecretClient();

  // If the user is already provisioned, return their existing workspace.
  const existing = await findPrimaryTenantSlug(input.userId);
  if (existing) {
    return { slug: existing, redirectTo: tenantBaseUrl(existing) };
  }

  if (!(await isSubdomainAvailable(slug))) {
    throw new Error("subdomain_taken");
  }

  const tenantName = input.tenantName?.trim() || slug;

  const { data: tenant, error: tenantErr } = await secret
    .from("tenants")
    .insert({ slug, name: tenantName, status: "active" })
    .select("id, slug")
    .single();
  if (tenantErr || !tenant) {
    throw new Error(tenantErr?.message ?? "tenant_create_failed");
  }

  const { error: memberErr } = await secret
    .from("tenant_users")
    .insert({ tenant_id: tenant.id, user_id: input.userId, role: "owner" });
  if (memberErr) throw new Error(memberErr.message);

  const { error: domainErr } = await secret
    .from("tenant_domains")
    .insert({
      tenant_id: tenant.id,
      kind: "subdomain",
      subdomain: slug,
      is_primary: true,
      verified: true,
    });
  if (domainErr) throw new Error(domainErr.message);

  await secret.from("user_profiles").upsert(
    {
      user_id: input.userId,
      display_name: input.displayName ?? input.email ?? null,
      default_tenant_id: tenant.id,
    },
    { onConflict: "user_id" },
  );

  await secret.from("audit_events").insert({
    tenant_id: tenant.id,
    user_id: input.userId,
    action: "tenant.provisioned",
    target: slug,
    metadata: { via: "onboarding" },
  });

  return { slug: tenant.slug as string, redirectTo: tenantBaseUrl(tenant.slug as string) };
}
