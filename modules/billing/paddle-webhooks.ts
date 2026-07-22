import "server-only";

/**
 * modules/billing/paddle-webhooks.ts
 *
 * Paddle webhook processing: ledger-first idempotency (billing_events keyed on
 * the Paddle event id), an out-of-order guard per subscription, and mirror
 * upserts into paddle_customers / tenant_subscriptions /
 * paddle_subscriptions_unlinked.
 *
 * Anonymous-checkout linking: marketing-site checkouts carry no custom_data,
 * so subscriptions can arrive before any tenant exists. Those are staged in
 * paddle_subscriptions_unlinked and PROMOTED by linkPaddleCustomerToTenant
 * (called when a customer.updated carries custom_data.tenant_id, or via
 * linkPaddleCustomerByEmail from tenant provisioning). Staged rows are marked
 * promoted, never deleted.
 *
 * ADR-053: payment states are operational signals only. Nothing in this module
 * reads or writes tenants.status.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { mapPaddleSubscriptionStatus } from "./paddle-status";
import { paddlePlanKeyForPriceId } from "./paddle-plans";

type Db = ReturnType<typeof createSupabaseSecretClient>;

// --- Structural event types (match @paddle/paddle-node-sdk entities) --------

export interface PaddleWebhookEvent<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly data: T;
}

interface PaddleCustomData {
  readonly [key: string]: unknown;
}

export interface PaddleCustomerNotification {
  readonly id: string;
  readonly email: string;
  readonly customData?: PaddleCustomData | null;
}

interface PaddleTimePeriod {
  readonly startsAt: string;
  readonly endsAt: string;
}

interface PaddleScheduledChangeNotification {
  readonly action: "cancel" | "pause" | "resume";
  readonly effectiveAt: string;
  readonly resumeAt?: string | null;
}

export interface PaddleSubscriptionNotification {
  readonly id: string;
  readonly status: string;
  readonly customerId: string;
  readonly currencyCode?: string | null;
  readonly canceledAt?: string | null;
  readonly customData?: PaddleCustomData | null;
  readonly currentBillingPeriod?: PaddleTimePeriod | null;
  readonly billingCycle?: { readonly interval?: string | null } | null;
  readonly scheduledChange?: PaddleScheduledChangeNotification | null;
  readonly items?: ReadonlyArray<{
    readonly price?: {
      readonly id?: string | null;
      readonly productId?: string | null;
    } | null;
    readonly trialDates?: PaddleTimePeriod | null;
  }>;
}

export interface PaddleTransactionNotification {
  readonly id: string;
  readonly customerId?: string | null;
  readonly subscriptionId?: string | null;
  readonly billingPeriod?: PaddleTimePeriod | null;
  readonly customData?: PaddleCustomData | null;
}

/** The six event types this app subscribes to; everything else is ledger-only. */
export const HANDLED_PADDLE_EVENT_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "customer.created",
  "customer.updated",
  "transaction.completed",
] as const;

// --- Ledger (idempotency) ----------------------------------------------------

function customDataTenantId(
  customData?: PaddleCustomData | null,
): string | null {
  const value = customData?.["tenant_id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function recordEvent(
  db: Db,
  event: PaddleWebhookEvent,
): Promise<{ duplicate: boolean }> {
  const { error } = await db.from("billing_events").insert({
    provider: "paddle",
    provider_event_id: event.eventId,
    type: event.eventType,
    payload: {
      event_id: event.eventId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      data: event.data,
    },
  });
  if (!error) return { duplicate: false };
  if (error.code === "23505") return { duplicate: true };
  throw new Error(error.message);
}

async function markProcessed(
  db: Db,
  input: { eventId: string; tenantId: string | null; error?: string | null },
): Promise<void> {
  await db
    .from("billing_events")
    .update({
      tenant_id: input.tenantId,
      processed: !input.error,
      processed_at: new Date().toISOString(),
      error: input.error ?? null,
    })
    .eq("provider", "paddle")
    .eq("provider_event_id", input.eventId);
}

// --- Customer mirror -----------------------------------------------------------

async function handleCustomerEvent(
  db: Db,
  event: PaddleWebhookEvent<PaddleCustomerNotification>,
): Promise<{ tenantId: string | null }> {
  const customer = event.data;
  const { data: existing, error: readError } = await db
    .from("paddle_customers")
    .select("customer_id, tenant_id")
    .eq("customer_id", customer.id)
    .maybeSingle<{ customer_id: string; tenant_id: string | null }>();
  if (readError) throw new Error(readError.message);

  // Never blank an established link: custom_data wins, existing link second.
  const tenantId =
    customDataTenantId(customer.customData) ?? existing?.tenant_id ?? null;

  const { error } = await db
    .from("paddle_customers")
    .upsert(
      { customer_id: customer.id, email: customer.email, tenant_id: tenantId },
      { onConflict: "customer_id" },
    );
  if (error) throw new Error(error.message);

  // A newly-arrived link promotes any staged subscriptions for this customer.
  if (tenantId && tenantId !== (existing?.tenant_id ?? null)) {
    await promoteUnlinkedSubscriptions(db, customer.id, tenantId);
  }
  return { tenantId };
}

// --- Subscription mirror -------------------------------------------------------

const LIVE_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "grace",
  "suspended",
  "cancelled",
  "unpaid",
  "incomplete",
] as const;

interface SubscriptionMirror {
  status: string;
  plan_key: string;
  billing_interval: "month" | "year";
  provider_customer_id: string;
  provider_subscription_id: string;
  paddle_price_id: string | null;
  paddle_product_id: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  scheduled_change_action: string | null;
  scheduled_change_effective_at: string | null;
  scheduled_change_resume_at: string | null;
  currency: string;
  last_paddle_event_id: string;
  last_paddle_event_occurred_at: string;
}

function subscriptionMirror(
  event: PaddleWebhookEvent<PaddleSubscriptionNotification>,
): SubscriptionMirror {
  const subscription = event.data;
  const item = subscription.items?.[0];
  const priceId = item?.price?.id ?? null;
  const scheduled = subscription.scheduledChange ?? null;
  return {
    status: mapPaddleSubscriptionStatus(subscription.status),
    // TODO(plan-keys): provisional mapping until plan_starter/plan_pro/
    // plan_advanced exist — see modules/billing/paddle-plans.ts.
    plan_key: paddlePlanKeyForPriceId(priceId),
    billing_interval:
      subscription.billingCycle?.interval === "year" ? "year" : "month",
    provider_customer_id: subscription.customerId,
    provider_subscription_id: subscription.id,
    paddle_price_id: priceId,
    paddle_product_id: item?.price?.productId ?? null,
    trial_ends_at: item?.trialDates?.endsAt ?? null,
    current_period_start: subscription.currentBillingPeriod?.startsAt ?? null,
    current_period_end: subscription.currentBillingPeriod?.endsAt ?? null,
    cancel_at_period_end: scheduled?.action === "cancel",
    cancelled_at: subscription.canceledAt ?? null,
    scheduled_change_action: scheduled?.action ?? null,
    scheduled_change_effective_at: scheduled?.effectiveAt ?? null,
    scheduled_change_resume_at: scheduled?.resumeAt ?? null,
    currency: subscription.currencyCode?.trim().toUpperCase() || "USD",
    last_paddle_event_id: event.eventId,
    last_paddle_event_occurred_at: event.occurredAt,
  };
}

async function resolveTenantForCustomer(
  db: Db,
  customerId: string,
  customData?: PaddleCustomData | null,
): Promise<string | null> {
  const fromCustomData = customDataTenantId(customData);
  if (fromCustomData) return fromCustomData;
  const { data, error } = await db
    .from("paddle_customers")
    .select("tenant_id")
    .eq("customer_id", customerId)
    .maybeSingle<{ tenant_id: string | null }>();
  if (error) throw new Error(error.message);
  return data?.tenant_id ?? null;
}

/**
 * Upsert the tenant's Paddle subscription mirror, keyed on
 * provider_subscription_id. Falls back to taking over the tenant's single live
 * subscription row (the schema enforces at most one live row per tenant, and
 * provisioning may have seeded a trial row) before inserting a fresh one.
 */
async function upsertLinkedSubscription(
  db: Db,
  tenantId: string,
  mirror: SubscriptionMirror,
): Promise<void> {
  const payload = { ...mirror, provider: "paddle", tenant_id: tenantId };

  const { data: byProviderId, error: byProviderIdError } = await db
    .from("tenant_subscriptions")
    .select("id")
    .eq("provider", "paddle")
    .eq("provider_subscription_id", mirror.provider_subscription_id)
    .maybeSingle<{ id: string }>();
  if (byProviderIdError) throw new Error(byProviderIdError.message);

  if (byProviderId?.id) {
    const { error } = await db
      .from("tenant_subscriptions")
      .update(payload)
      .eq("id", byProviderId.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: live, error: liveError } = await db
    .from("tenant_subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("status", [...LIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (liveError) throw new Error(liveError.message);

  if (live?.id) {
    const { error } = await db
      .from("tenant_subscriptions")
      .update(payload)
      .eq("id", live.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await db.from("tenant_subscriptions").insert(payload);
  if (error) throw new Error(error.message);
}

/** Stage a subscription whose customer has no tenant yet (anonymous checkout). */
async function upsertUnlinkedSubscription(
  db: Db,
  mirror: SubscriptionMirror,
  rawStatus: string,
  payload: unknown,
): Promise<void> {
  const { error } = await db.from("paddle_subscriptions_unlinked").upsert(
    {
      subscription_id: mirror.provider_subscription_id,
      customer_id: mirror.provider_customer_id,
      status: rawStatus,
      price_id: mirror.paddle_price_id,
      product_id: mirror.paddle_product_id,
      billing_interval: mirror.billing_interval,
      currency: mirror.currency,
      trial_ends_at: mirror.trial_ends_at,
      current_period_start: mirror.current_period_start,
      current_period_end: mirror.current_period_end,
      cancelled_at: mirror.cancelled_at,
      scheduled_change_action: mirror.scheduled_change_action,
      scheduled_change_effective_at: mirror.scheduled_change_effective_at,
      scheduled_change_resume_at: mirror.scheduled_change_resume_at,
      last_event_id: mirror.last_paddle_event_id,
      last_event_occurred_at: mirror.last_paddle_event_occurred_at,
      payload,
    },
    { onConflict: "subscription_id" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Out-of-order guard: true when an event for this subscription with a NEWER
 * occurred_at has already been applied (Paddle delivery is unordered).
 */
async function isStaleSubscriptionEvent(
  db: Db,
  subscriptionId: string,
  occurredAt: string,
): Promise<boolean> {
  const eventTime = Date.parse(occurredAt);

  const { data: linked, error: linkedError } = await db
    .from("tenant_subscriptions")
    .select("last_paddle_event_occurred_at")
    .eq("provider", "paddle")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle<{ last_paddle_event_occurred_at: string | null }>();
  if (linkedError) throw new Error(linkedError.message);
  if (
    linked?.last_paddle_event_occurred_at &&
    eventTime < Date.parse(linked.last_paddle_event_occurred_at)
  ) {
    return true;
  }

  const { data: staged, error: stagedError } = await db
    .from("paddle_subscriptions_unlinked")
    .select("last_event_occurred_at")
    .eq("subscription_id", subscriptionId)
    .maybeSingle<{ last_event_occurred_at: string | null }>();
  if (stagedError) throw new Error(stagedError.message);
  return Boolean(
    staged?.last_event_occurred_at &&
    eventTime < Date.parse(staged.last_event_occurred_at),
  );
}

async function handleSubscriptionEvent(
  db: Db,
  event: PaddleWebhookEvent<PaddleSubscriptionNotification>,
): Promise<{ tenantId: string | null; skipped?: boolean }> {
  const subscription = event.data;

  if (await isStaleSubscriptionEvent(db, subscription.id, event.occurredAt)) {
    return { tenantId: null, skipped: true };
  }

  const mirror = subscriptionMirror(event);
  const tenantId = await resolveTenantForCustomer(
    db,
    subscription.customerId,
    subscription.customData,
  );

  if (tenantId) {
    await upsertLinkedSubscription(db, tenantId, mirror);
    return { tenantId };
  }

  await upsertUnlinkedSubscription(db, mirror, subscription.status, {
    event_id: event.eventId,
    occurred_at: event.occurredAt,
    data: subscription,
  });
  return { tenantId: null };
}

// --- transaction.completed -----------------------------------------------------

async function handleTransactionCompleted(
  db: Db,
  event: PaddleWebhookEvent<PaddleTransactionNotification>,
): Promise<{ tenantId: string | null }> {
  const transaction = event.data;
  const tenantId = transaction.customerId
    ? await resolveTenantForCustomer(
        db,
        transaction.customerId,
        transaction.customData,
      )
    : null;

  // Ledger + period touch only; no status or access side effects.
  if (transaction.subscriptionId && transaction.billingPeriod) {
    const period = {
      current_period_start: transaction.billingPeriod.startsAt,
      current_period_end: transaction.billingPeriod.endsAt,
    };
    const { error } = await db
      .from("tenant_subscriptions")
      .update(period)
      .eq("provider", "paddle")
      .eq("provider_subscription_id", transaction.subscriptionId);
    if (error) throw new Error(error.message);

    const { error: stagedError } = await db
      .from("paddle_subscriptions_unlinked")
      .update(period)
      .eq("subscription_id", transaction.subscriptionId);
    if (stagedError) throw new Error(stagedError.message);
  }

  return { tenantId };
}

// --- Linking / promotion ---------------------------------------------------------

interface UnlinkedRow {
  subscription_id: string;
  customer_id: string;
  status: string;
  price_id: string | null;
  product_id: string | null;
  billing_interval: "month" | "year";
  currency: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  scheduled_change_action: string | null;
  scheduled_change_effective_at: string | null;
  scheduled_change_resume_at: string | null;
  last_event_id: string | null;
  last_event_occurred_at: string | null;
}

async function promoteUnlinkedSubscriptions(
  db: Db,
  customerId: string,
  tenantId: string,
): Promise<number> {
  const { data: staged, error } = await db
    .from("paddle_subscriptions_unlinked")
    .select(
      "subscription_id, customer_id, status, price_id, product_id, billing_interval, currency, trial_ends_at, current_period_start, current_period_end, cancelled_at, scheduled_change_action, scheduled_change_effective_at, scheduled_change_resume_at, last_event_id, last_event_occurred_at",
    )
    .eq("customer_id", customerId)
    .is("promoted_at", null);
  if (error) throw new Error(error.message);

  const rows = (staged ?? []) as UnlinkedRow[];
  for (const row of rows) {
    await upsertLinkedSubscription(db, tenantId, {
      status: mapPaddleSubscriptionStatus(row.status),
      plan_key: paddlePlanKeyForPriceId(row.price_id),
      billing_interval: row.billing_interval,
      provider_customer_id: row.customer_id,
      provider_subscription_id: row.subscription_id,
      paddle_price_id: row.price_id,
      paddle_product_id: row.product_id,
      trial_ends_at: row.trial_ends_at,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
      cancel_at_period_end: row.scheduled_change_action === "cancel",
      cancelled_at: row.cancelled_at,
      scheduled_change_action: row.scheduled_change_action,
      scheduled_change_effective_at: row.scheduled_change_effective_at,
      scheduled_change_resume_at: row.scheduled_change_resume_at,
      currency: row.currency ?? "USD",
      last_paddle_event_id: row.last_event_id ?? "",
      last_paddle_event_occurred_at:
        row.last_event_occurred_at ?? new Date(0).toISOString(),
    });

    // Promotion stamps the staged row; it is never deleted (fulfilment state).
    const { error: stampError } = await db
      .from("paddle_subscriptions_unlinked")
      .update({
        promoted_tenant_id: tenantId,
        promoted_at: new Date().toISOString(),
      })
      .eq("subscription_id", row.subscription_id);
    if (stampError) throw new Error(stampError.message);
  }
  return rows.length;
}

/**
 * Link a Paddle customer to a tenant and promote any staged (anonymous)
 * subscriptions into tenant_subscriptions. Safe to call repeatedly.
 */
export async function linkPaddleCustomerToTenant(
  customerId: string,
  tenantId: string,
  db: Db = createSupabaseSecretClient(),
): Promise<{ promoted: number }> {
  const { error } = await db
    .from("paddle_customers")
    .update({ tenant_id: tenantId })
    .eq("customer_id", customerId);
  if (error) throw new Error(error.message);
  const promoted = await promoteUnlinkedSubscriptions(db, customerId, tenantId);
  return { promoted };
}

/**
 * Link any unlinked Paddle customers whose email matches the registering
 * user's email (case-insensitive) to the freshly provisioned tenant. Called
 * best-effort when registration/onboarding completes; anonymous marketing-site
 * checkouts are identified by email only.
 */
export async function linkPaddleCustomerByEmail(
  email: string,
  tenantId: string,
  db: Db = createSupabaseSecretClient(),
): Promise<{ linked: number; promoted: number }> {
  const normalised = email.trim();
  if (!normalised) return { linked: 0, promoted: 0 };

  const { data, error } = await db
    .from("paddle_customers")
    .select("customer_id")
    .ilike("email", normalised)
    .is("tenant_id", null);
  if (error) throw new Error(error.message);

  let promoted = 0;
  const customers = (data ?? []) as Array<{ customer_id: string }>;
  for (const customer of customers) {
    const result = await linkPaddleCustomerToTenant(
      customer.customer_id,
      tenantId,
      db,
    );
    promoted += result.promoted;
  }
  return { linked: customers.length, promoted };
}

/**
 * Whether a verified email owns an anonymous Paddle subscription that can be
 * linked during self-service onboarding. This is deliberately a server-only
 * lookup: raw Paddle customer and subscription rows are never exposed through
 * end-user RLS policies.
 */
export async function hasUnlinkedPaddleSubscriptionForEmail(
  email: string,
  db: Db = createSupabaseSecretClient(),
): Promise<boolean> {
  const normalised = email.trim();
  if (!normalised) return false;

  const { data: customerRows, error: customerError } = await db
    .from("paddle_customers")
    .select("customer_id")
    .ilike("email", normalised)
    .is("tenant_id", null);
  if (customerError) throw new Error(customerError.message);

  const customerIds = (customerRows ?? []).map(
    (row: { customer_id: string }) => row.customer_id,
  );
  if (customerIds.length === 0) return false;

  const { data: subscriptions, error: subscriptionError } = await db
    .from("paddle_subscriptions_unlinked")
    .select("subscription_id")
    .in("customer_id", customerIds)
    .in("status", ["active", "trialing", "past_due"])
    .is("promoted_at", null)
    .limit(1);
  if (subscriptionError) throw new Error(subscriptionError.message);

  return (subscriptions ?? []).length > 0;
}

// --- Entry point -----------------------------------------------------------------

export async function processPaddleWebhookEvent(
  event: PaddleWebhookEvent,
): Promise<{ duplicate: boolean; handled: boolean; skipped?: boolean }> {
  const db = createSupabaseSecretClient();

  // Ledger EVERY event before processing; a replayed event id is acknowledged
  // without reprocessing (Paddle delivers at-least-once).
  const recorded = await recordEvent(db, event);
  if (recorded.duplicate) return { duplicate: true, handled: true };

  try {
    let outcome: { tenantId: string | null; skipped?: boolean } = {
      tenantId: null,
    };
    let handled = true;

    switch (event.eventType) {
      case "customer.created":
      case "customer.updated":
        outcome = await handleCustomerEvent(
          db,
          event as PaddleWebhookEvent<PaddleCustomerNotification>,
        );
        break;
      case "subscription.created":
      case "subscription.updated":
      case "subscription.canceled":
        outcome = await handleSubscriptionEvent(
          db,
          event as PaddleWebhookEvent<PaddleSubscriptionNotification>,
        );
        break;
      case "transaction.completed":
        outcome = await handleTransactionCompleted(
          db,
          event as PaddleWebhookEvent<PaddleTransactionNotification>,
        );
        break;
      default:
        // Unexpected event types: ledger + acknowledge, no state change.
        handled = false;
        break;
    }

    await markProcessed(db, {
      eventId: event.eventId,
      tenantId: outcome.tenantId,
    });
    return { duplicate: false, handled, skipped: outcome.skipped };
  } catch (error) {
    await markProcessed(db, {
      eventId: event.eventId,
      tenantId: null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
