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

// --- WhatsApp Web-session bridge (ADR-036) ----------------------------------
//
// The bridge is a long-lived runtime OUTSIDE Vercel/Supabase that maintains the
// real WhatsApp Web sessions (same boundary posture as the vLLM runtime,
// ADR-014). The app reaches it only over a private, authenticated path; it is
// never client- or tenant-facing. Production enablement remains gated on the
// ToS/legal/platform validation ADR-036 calls for — hence the feature flag,
// which is OFF by default (the app falls back to the persisted scaffold).

/**
 * Whether the real Web-session bridge is wired in. OFF by default: with the
 * flag off the WhatsApp UX uses the persisted scaffold (simulated scan, mock
 * discovery) and no real session, QR, or credentials are established.
 */
export function whatsappBridgeEnabled(): boolean {
  return process.env.WHATSAPP_BRIDGE_ENABLED === "true";
}

/** Private base URL of the bridge runtime (e.g. http://bridge.internal:8088). */
export function whatsappBridgeBaseUrl(): string {
  const url = process.env.WHATSAPP_BRIDGE_BASE_URL?.trim();
  if (!url) throw new Error("WHATSAPP_BRIDGE_BASE_URL is not set");
  return url.replace(/\/$/, "");
}

/** Bearer token the app presents to the bridge on every request (app → bridge). */
export function whatsappBridgeAuthToken(): string {
  const token = process.env.WHATSAPP_BRIDGE_AUTH_TOKEN?.trim();
  if (!token) throw new Error("WHATSAPP_BRIDGE_AUTH_TOKEN is not set");
  return token;
}

/**
 * Shared secret the bridge uses to authenticate its callbacks INTO the app
 * (message push + session-material persistence). Verified server-side on the
 * webhook / internal routes; never exposed to the browser.
 */
export function whatsappBridgeCallbackToken(): string {
  const token = process.env.WHATSAPP_BRIDGE_CALLBACK_TOKEN?.trim();
  if (!token) throw new Error("WHATSAPP_BRIDGE_CALLBACK_TOKEN is not set");
  return token;
}

/**
 * Absolute base URL for the reserved, tenant-neutral `app.` host that serves
 * auth + onboarding (sign-in, magic-link callbacks, OAuth callbacks). The bare
 * apex is the marketing site and never hosts app flows.
 */
export function appHostBaseUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}`
    : `https://app.${appApex()}`;
}

/** Absolute base URL for a tenant subdomain workspace. */
export function tenantBaseUrl(slug: string): string {
  return isDev()
    ? `http://${slug}.${devApex()}:${devPort()}`
    : `https://${slug}.${appApex()}`;
}
