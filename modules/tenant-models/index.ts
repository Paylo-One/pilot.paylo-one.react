/**
 * modules/tenant-models — bring-your-own-key model providers (ADR-038).
 *
 * A tenant can register its own Anthropic or OpenAI API key + model and route
 * the workspace's AI processing through it instead of the Paylo-hosted default.
 * The active, verified provider is surfaced to the Model Gateway as a
 * tenant-owned catalogue model (ownerType "tenant"); the key stays server-only
 * and is reached only through the Gateway's adapter (ADR-013/014).
 *
 * This file holds the pure types + display metadata importable by both server
 * and client (the settings UI). Secrets and DB access live in `./server`.
 */

/** The frontier providers a tenant may bring a key for. */
export type TenantModelProviderKind = "openai" | "anthropic";

/** Verification lifecycle — a key is not routable until a test call succeeds. */
export type TenantModelStatus = "untested" | "verified" | "failed";

/**
 * A tenant's registered model provider, MASKED for the UI: the API key is never
 * included — only a `keyHint` (last 4 characters) for recognition.
 */
export interface TenantModelProvider {
  readonly id: string;
  readonly provider: TenantModelProviderKind;
  readonly modelId: string;
  readonly displayName: string;
  readonly keyHint: string;
  readonly status: TenantModelStatus;
  readonly lastError: string | null;
  readonly lastVerifiedAt: string | null;
  /** Whether this provider is the tenant's active routing choice. */
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PROVIDER_LABELS: Record<TenantModelProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/** Where the operator gets a key, shown as helper copy in the form. */
export const PROVIDER_KEY_HINTS: Record<TenantModelProviderKind, string> = {
  openai: "Create a key at platform.openai.com → API keys (starts with sk-…).",
  anthropic: "Create a key at console.anthropic.com → API keys (starts with sk-ant-…).",
};

/** Suggested model ids per provider (free-text is allowed; these are shortcuts). */
export const SUGGESTED_MODELS: Record<TenantModelProviderKind, readonly string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
};

/** Compute the non-secret display hint for a key (provider-prefix … last 4). */
export function keyHintFor(apiKey: string): string {
  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);
  return last4 ? `…${last4}` : "…";
}
