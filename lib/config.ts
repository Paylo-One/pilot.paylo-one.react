/**
 * lib/config.ts
 *
 * Centralised, typed access to configuration. Per project convention, only
 * SECRETS belong in environment variables; non-sensitive configuration is read
 * here with sensible defaults so the scaffold runs without any env file.
 *
 * Scaffold note: nothing here connects to a service.
 */

/** Registrable apex used for tenant subdomain routing. */
export function appApex(): string {
  return process.env.NEXT_PUBLIC_APP_APEX?.trim() || "paylo.one";
}

/** Local development apex (e.g. lvh.me) for subdomain testing without DNS. */
export function devApex(): string {
  return process.env.NEXT_PUBLIC_DEV_APEX?.trim() || "lvh.me";
}

/** True when running outside production (drives the dev apex + relaxed checks). */
export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The apex to resolve hosts against for the current environment. */
export function activeApex(): string {
  return isDev() ? devApex() : appApex();
}

/** Supabase project URL (local: http://127.0.0.1:54321). */
export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url;
}

/** Browser-safe publishable key (sb_publishable_...). */
export function supabasePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  return key;
}

/** Server-only secret key (sb_secret_...). Bypasses RLS. Never expose. */
export function supabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return key;
}

/** Dev server port (used to build absolute cross-host URLs locally). */
export function devPort(): string {
  return process.env.PORT?.trim() || "3000";
}

/** Absolute base URL for the apex (auth/onboarding) host. */
export function apexBaseUrl(): string {
  return isDev() ? `http://${devApex()}:${devPort()}` : `https://${appApex()}`;
}

/** Absolute base URL for a tenant subdomain workspace. */
export function tenantBaseUrl(slug: string): string {
  return isDev()
    ? `http://${slug}.${devApex()}:${devPort()}`
    : `https://${slug}.${appApex()}`;
}
