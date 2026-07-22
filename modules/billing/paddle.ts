import "server-only";

/**
 * modules/billing/paddle.ts
 *
 * Server-only Paddle SDK surface: webhook signature verification (unmarshal)
 * and customer-portal session minting. Mirrors the Stripe module's role.
 *
 * The SDK environment follows PADDLE_ENV explicitly (sandbox|production) and
 * never defaults silently — paddleEnv() throws when unset/invalid.
 */

import { Environment, NodeRuntime, Paddle, Webhooks } from "@paddle/paddle-node-sdk";
import { paddleApiKey, paddleEnv, paddleWebhookSecret } from "@/lib/config";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { PaddleWebhookEvent } from "./paddle-webhooks";

/** Configured Paddle API client. Environment is explicit, never defaulted. */
export function createPaddleClient(): Paddle {
  return new Paddle(paddleApiKey(), {
    environment:
      paddleEnv() === "production" ? Environment.production : Environment.sandbox,
  });
}

/**
 * Verify + parse a raw webhook body against the Paddle-Signature header using
 * the notification destination's signing secret. The RAW body is what is
 * verified — callers must pass `await request.text()` untouched. Throws when
 * the signature is missing/invalid or the secret is not configured.
 */
export async function unmarshalPaddleWebhook(
  rawBody: string,
  signature: string,
): Promise<PaddleWebhookEvent> {
  // The SDK registers its crypto provider in the Paddle constructor only;
  // standalone Webhooks usage (no API key needed) must initialise it here.
  NodeRuntime.initialize();
  const event = await new Webhooks().unmarshal(
    rawBody,
    paddleWebhookSecret(),
    signature,
  );
  return event as unknown as PaddleWebhookEvent;
}

interface PaddlePortalDeps {
  readonly db: ReturnType<typeof createSupabaseSecretClient>;
  readonly createPortalSession: (
    customerId: string,
    subscriptionIds: string[],
  ) => Promise<{ urls: { general: { overview: string } } }>;
}

function defaultPortalDeps(): PaddlePortalDeps {
  const paddle = createPaddleClient();
  return {
    db: createSupabaseSecretClient(),
    createPortalSession: (customerId, subscriptionIds) =>
      paddle.customerPortalSessions.create(customerId, subscriptionIds),
  };
}

/**
 * Resolve the tenant's Paddle customer id SERVER-SIDE. Never accepts a
 * customer id from the client: the linkage comes from paddle_customers first,
 * falling back to the tenant's live Paddle subscription row.
 */
export async function resolvePaddleCustomerIdForTenant(
  tenantId: string,
  db = createSupabaseSecretClient(),
): Promise<string | null> {
  const { data: customer, error } = await db
    .from("paddle_customers")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle<{ customer_id: string }>();
  if (error) throw new Error(error.message);
  if (customer?.customer_id) return customer.customer_id;

  const { data: subscription, error: subError } = await db
    .from("tenant_subscriptions")
    .select("provider_customer_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "paddle")
    .not("provider_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ provider_customer_id: string | null }>();
  if (subError) throw new Error(subError.message);
  return subscription?.provider_customer_id ?? null;
}

/** True when the tenant has a linked Paddle billing relationship. */
export async function tenantHasPaddleBilling(tenantId: string): Promise<boolean> {
  return (await resolvePaddleCustomerIdForTenant(tenantId)) !== null;
}

/**
 * Mint a Paddle customer-portal session for the tenant and return its overview
 * URL. The customer id and subscription ids are resolved server-side from the
 * mirror tables for THIS tenant only.
 */
export async function createPaddlePortalSession(
  input: { tenantId: string },
  deps: PaddlePortalDeps = defaultPortalDeps(),
): Promise<string> {
  const customerId = await resolvePaddleCustomerIdForTenant(input.tenantId, deps.db);
  if (!customerId) {
    throw new Error("No Paddle customer is linked to this workspace.");
  }

  const { data: rows, error } = await deps.db
    .from("tenant_subscriptions")
    .select("provider_subscription_id")
    .eq("tenant_id", input.tenantId)
    .eq("provider", "paddle")
    .not("provider_subscription_id", "is", null);
  if (error) throw new Error(error.message);

  const subscriptionIds = (rows ?? [])
    .map((row) => (row as { provider_subscription_id: string | null }).provider_subscription_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const session = await deps.createPortalSession(customerId, subscriptionIds);
  return session.urls.general.overview;
}
