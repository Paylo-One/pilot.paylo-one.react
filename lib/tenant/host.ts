/**
 * lib/tenant/host.ts
 *
 * Pure, dependency-free host parsing used by BOTH tenant-subdomain selection
 * (identity-tenant module) and request routing (proxy.ts). Keeping one shared
 * blocklist + parser means selection and routing can never diverge
 * (multi-tenancy-design.md §"Reserved subdomain collision").
 *
 * Security: this only PARSES a host string. The caller must have already
 * validated that the host was served by our edge/origin — a client-supplied
 * Host / X-Forwarded-Host is never trusted (technical-design.md §"Tenant
 * Resolution Strategy", anti host-header-spoofing).
 *
 * Scaffold note: no DNS, no DB lookup here.
 */

/**
 * Reserved subdomains that can never be claimed by a tenant. Shared between
 * subdomain selection and routing. Add operational names here BEFORE using them.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "status",
  "mail",
  "static",
  "assets",
  "help",
  "docs",
  "blog",
  "paylo",
  "auth",
  "login",
]);

/** DNS-safe subdomain pattern (multi-tenancy-design.md §"Subdomain Selection"). */
export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Result of resolving a request host to a routing decision. */
export type HostResolution =
  | { readonly kind: "apex" } // paylo.one / www — marketing/auth
  | { readonly kind: "reserved"; readonly label: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "tenant"; readonly slug: string };

/** True if `label` is syntactically valid and not reserved. */
export function isSelectableSubdomain(label: string): boolean {
  return SUBDOMAIN_PATTERN.test(label) && !RESERVED_SUBDOMAINS.has(label);
}

/**
 * Resolve a (already-trusted) host against the configured apex. Returns a
 * routing decision; never throws. Strips an optional port.
 *
 * @param host  e.g. "alex.paylo.one" or "alex.lvh.me:3000"
 * @param apex  the registrable apex, e.g. "paylo.one" (or "lvh.me" locally)
 */
export function resolveHost(host: string | null, apex: string): HostResolution {
  if (!host) return { kind: "invalid" };

  const hostname = host.split(":")[0]?.toLowerCase().trim() ?? "";
  if (hostname.length === 0) return { kind: "invalid" };

  // Apex itself or www -> marketing/auth, not a tenant.
  if (hostname === apex || hostname === `www.${apex}`) {
    return { kind: "apex" };
  }

  // Must be exactly one label deep under the apex (wildcard certs cover one label).
  const suffix = `.${apex}`;
  if (!hostname.endsWith(suffix)) return { kind: "invalid" };

  const label = hostname.slice(0, -suffix.length);
  if (label.length === 0 || label.includes(".")) return { kind: "invalid" };
  if (RESERVED_SUBDOMAINS.has(label)) return { kind: "reserved", label };
  if (!SUBDOMAIN_PATTERN.test(label)) return { kind: "invalid" };

  return { kind: "tenant", slug: label };
}
