import "server-only";

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { TenantContext } from "@/modules/shared";
import {
  mapStripeSubscriptionStatus,
  tenantSubscriptionStatus,
  type BillingAccessStatus,
  type BillingStatus,
} from "./status";
import {
  configuredPlanFromPriceId,
  configuredStripePlan,
  stripeApi,
  type StripeCheckoutSession,
  type StripeInvoice,
  type StripePrice,
  type StripeSubscription,
} from "./stripe";
import type { PlanKey } from "./plans";
import type { StripeBillingPriceOption } from "./stripe-plans";

const DEFAULT_BILLING_CURRENCY = "EUR";

function billingIntervalFromStripePrice(
  price: StripePrice | null,
  configuredPlan: ReturnType<typeof configuredPlanFromPriceId>,
): "month" | "year" {
  if (configuredPlan?.priceOption.interval === "annual") return "year";
  if (configuredPlan?.priceOption.interval === "monthly") return "month";
  return price?.recurring?.interval === "year" ? "year" : "month";
}

function currencyFromStripePrice(price: StripePrice | null): string {
  return price?.currency?.trim().toUpperCase() || DEFAULT_BILLING_CURRENCY;
}

export interface BillingAccessRecord {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly billingStatus: BillingStatus;
  readonly accessStatus: BillingAccessStatus;
  readonly freeAccessStartedAt: string;
  readonly freeAccessEndsAt: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripeCheckoutSessionId: string | null;
  readonly stripeProductId: string | null;
  readonly stripePriceId: string | null;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly lastPaymentStatus: string | null;
  readonly lastPaymentError: string | null;
}

interface BillingAccessRow {
  tenant_id: string;
  user_id: string | null;
  billing_status: BillingStatus;
  access_status: BillingAccessStatus;
  free_access_started_at: string;
  free_access_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_payment_status: string | null;
  last_payment_error: string | null;
}

function mapAccess(row: BillingAccessRow): BillingAccessRecord {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    billingStatus: row.billing_status,
    accessStatus: row.access_status,
    freeAccessStartedAt: row.free_access_started_at,
    freeAccessEndsAt: row.free_access_ends_at,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeProductId: row.stripe_product_id,
    stripePriceId: row.stripe_price_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    lastPaymentStatus: row.last_payment_status,
    lastPaymentError: row.last_payment_error,
  };
}

function isoFromUnix(seconds?: number | null): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function trialEnd(start = new Date()): string {
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function createTrialBillingAccess(input: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const now = new Date();
  const endsAt = trialEnd(now);
  const db = createSupabaseSecretClient();

  await db.from("billing_access").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      billing_status: "trialing",
      access_status: "active",
      free_access_started_at: now.toISOString(),
      free_access_ends_at: endsAt,
      current_period_start: now.toISOString(),
      current_period_end: endsAt,
    },
    { onConflict: "tenant_id" },
  );

  const { data: existing } = await db
    .from("tenant_subscriptions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .in("status", ["trialing", "active", "past_due", "grace", "suspended", "cancelled", "unpaid", "incomplete"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    plan_key: "plan_operator",
    status: "trialing",
    billing_interval: "month",
    owner_user_id: input.userId,
    provider: "stripe",
    trial_ends_at: endsAt,
    current_period_start: now.toISOString(),
    current_period_end: endsAt,
    currency: DEFAULT_BILLING_CURRENCY,
  };

  if (existing?.id) {
    await db.from("tenant_subscriptions").update(payload).eq("id", existing.id);
  } else {
    await db
      .from("tenant_subscriptions")
      .insert({ tenant_id: input.tenantId, ...payload });
  }
}

export async function getBillingAccess(tenantId: string): Promise<BillingAccessRecord | null> {
  const db = createSupabaseSecretClient();
  const { data, error } = await db
    .from("billing_access")
    .select(
      "tenant_id, user_id, billing_status, access_status, free_access_started_at, free_access_ends_at, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, stripe_product_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end, last_payment_status, last_payment_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle<BillingAccessRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const mapped = mapAccess(data);
  if (
    mapped.billingStatus === "trialing" &&
    Date.parse(mapped.freeAccessEndsAt) <= Date.now() &&
    !mapped.stripeSubscriptionId
  ) {
    const db = createSupabaseSecretClient();
    await db
      .from("billing_access")
      .update({
        billing_status: "expired",
        access_status: "restricted",
        current_period_end: mapped.freeAccessEndsAt,
      })
      .eq("tenant_id", tenantId);
    return {
      ...mapped,
      billingStatus: "expired",
      accessStatus: "restricted",
      currentPeriodEnd: mapped.freeAccessEndsAt,
    };
  }
  return mapped;
}

export async function getOrCreateStripeCustomer(input: {
  ctx: TenantContext;
  email: string | null;
}): Promise<string> {
  const db = createSupabaseSecretClient();
  const { data: existing, error } = await db
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("tenant_id", input.ctx.tenantId)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (error) throw new Error(error.message);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripeApi.createCustomer({
    email: input.email,
    name: `${input.ctx.tenantSlug}.paylo.one`,
    tenantId: input.ctx.tenantId,
    userId: input.ctx.userId,
  });

  await db.from("billing_customers").upsert(
    {
      tenant_id: input.ctx.tenantId,
      user_id: input.ctx.userId,
      stripe_customer_id: customer.id,
      email: input.email,
      name: customer.name ?? `${input.ctx.tenantSlug}.paylo.one`,
    },
    { onConflict: "tenant_id" },
  );

  await db
    .from("billing_access")
    .update({ stripe_customer_id: customer.id, user_id: input.ctx.userId })
    .eq("tenant_id", input.ctx.tenantId);

  return customer.id;
}

export async function createSubscriptionCheckout(input: {
  ctx: TenantContext;
  email: string | null;
  priceOptionKey: StripeBillingPriceOption["key"];
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckoutSession> {
  const customerId = await getOrCreateStripeCustomer({
    ctx: input.ctx,
    email: input.email,
  });
  const plan = await configuredStripePlan(input.priceOptionKey);
  const session = await stripeApi.createCheckoutSession({
    customerId,
    priceId: plan.priceId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    tenantId: input.ctx.tenantId,
    userId: input.ctx.userId,
    planKey: plan.planKey,
    priceOptionKey: plan.priceOption.key,
    interval: plan.priceOption.interval,
  });

  const db = createSupabaseSecretClient();
  await db
    .from("billing_access")
    .update({
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      stripe_product_id: plan.productId,
      stripe_price_id: plan.priceId,
    })
    .eq("tenant_id", input.ctx.tenantId);

  return session;
}

export async function createSubscriptionPortal(input: {
  ctx: TenantContext;
  returnUrl: string;
}): Promise<string> {
  const access = await getBillingAccess(input.ctx.tenantId);
  const customerId = access?.stripeCustomerId;
  if (!customerId) throw new Error("No Stripe customer is linked to this workspace.");
  const session = await stripeApi.createCustomerPortalSession(customerId, input.returnUrl);
  return session.url;
}

async function upsertTenantSubscription(input: {
  tenantId: string;
  userId: string | null;
  customerId: string;
  subscriptionId: string;
  planKey: PlanKey;
  productId: string | null;
  priceId: string | null;
  billingStatus: BillingStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingInterval: "month" | "year";
  currency: string;
  lastPaymentStatus?: string | null;
  lastPaymentError?: string | null;
  eventId: string;
}) {
  const db = createSupabaseSecretClient();
  const status = tenantSubscriptionStatus(input.billingStatus);
  const payload = {
    plan_key: input.planKey,
    status,
    billing_interval: input.billingInterval,
    owner_user_id: input.userId,
    provider: "stripe",
    provider_customer_id: input.customerId,
    provider_subscription_id: input.subscriptionId,
    stripe_product_id: input.productId,
    stripe_price_id: input.priceId,
    current_period_start: input.currentPeriodStart,
    current_period_end: input.currentPeriodEnd,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    last_payment_status: input.lastPaymentStatus ?? null,
    last_payment_error: input.lastPaymentError ?? null,
    last_stripe_event_id: input.eventId,
    currency: input.currency,
  };

  const { data: existing, error } = await db
    .from("tenant_subscriptions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .in("status", ["trialing", "active", "past_due", "grace", "suspended", "cancelled", "unpaid", "incomplete"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);

  if (existing?.id) {
    await db.from("tenant_subscriptions").update(payload).eq("id", existing.id);
  } else {
    await db
      .from("tenant_subscriptions")
      .insert({ tenant_id: input.tenantId, ...payload });
  }
}

async function tenantFromStripeCustomer(customerId: string): Promise<{
  tenantId: string;
  userId: string | null;
} | null> {
  const db = createSupabaseSecretClient();
  const { data, error } = await db
    .from("billing_customers")
    .select("tenant_id, user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<{ tenant_id: string; user_id: string | null }>();
  if (error) throw new Error(error.message);
  return data ? { tenantId: data.tenant_id, userId: data.user_id } : null;
}

export async function syncStripeSubscription(input: {
  subscription: StripeSubscription;
  eventId: string;
  paymentStatus?: string | null;
  paymentError?: string | null;
}): Promise<{ tenantId: string | null; userId: string | null }> {
  const mapped = mapStripeSubscriptionStatus(input.subscription.status);
  const customerId = input.subscription.customer;
  const metadataTenantId = input.subscription.metadata?.tenant_id;
  const metadataUserId = input.subscription.metadata?.user_id ?? null;
  const owner =
    metadataTenantId && metadataUserId
      ? { tenantId: metadataTenantId, userId: metadataUserId }
      : await tenantFromStripeCustomer(customerId);
  if (!owner) return { tenantId: null, userId: null };

  const price = input.subscription.items?.data?.[0]?.price ?? null;
  const productId = price
    ? typeof price.product === "string"
      ? price.product
      : price.product.id
    : null;
  const priceId = price?.id ?? null;
  const configuredPlan = configuredPlanFromPriceId(priceId);
  const billingInterval = billingIntervalFromStripePrice(price, configuredPlan);
  const currency = currencyFromStripePrice(price);
  const planKey =
    configuredPlan?.planKey ??
    (input.subscription.metadata?.plan_key as PlanKey | undefined) ??
    "plan_operator";
  const currentPeriodStart = isoFromUnix(input.subscription.current_period_start);
  const currentPeriodEnd = isoFromUnix(input.subscription.current_period_end);
  const cancelAtPeriodEnd = input.subscription.cancel_at_period_end ?? false;
  const db = createSupabaseSecretClient();

  await db.from("billing_subscriptions").upsert(
    {
      tenant_id: owner.tenantId,
      user_id: owner.userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: input.subscription.id,
      stripe_price_id: priceId,
      stripe_product_id: productId,
      stripe_status: input.subscription.status,
      billing_status: mapped.billingStatus,
      access_status: mapped.accessStatus,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      last_payment_status: input.paymentStatus ?? null,
      last_payment_error: input.paymentError ?? null,
      last_stripe_event_id: input.eventId,
      raw: input.subscription,
    },
    { onConflict: "stripe_subscription_id" },
  );

  await db.from("billing_access").upsert(
    {
      tenant_id: owner.tenantId,
      user_id: owner.userId,
      billing_status: mapped.billingStatus,
      access_status: mapped.accessStatus,
      stripe_customer_id: customerId,
      stripe_subscription_id: input.subscription.id,
      stripe_product_id: productId,
      stripe_price_id: priceId,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      last_payment_status: input.paymentStatus ?? null,
      last_payment_error: input.paymentError ?? null,
      last_stripe_event_id: input.eventId,
    },
    { onConflict: "tenant_id" },
  );

  await upsertTenantSubscription({
    tenantId: owner.tenantId,
    userId: owner.userId,
    customerId,
    subscriptionId: input.subscription.id,
    planKey,
    productId,
    priceId,
    billingStatus: mapped.billingStatus,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    billingInterval,
    currency,
    lastPaymentStatus: input.paymentStatus,
    lastPaymentError: input.paymentError,
    eventId: input.eventId,
  });

  return owner;
}

export async function syncStripeInvoice(input: {
  invoice: StripeInvoice;
  eventId: string;
  failed: boolean;
}): Promise<{ tenantId: string | null; userId: string | null }> {
  const subscriptionId = input.invoice.subscription;
  if (!subscriptionId) {
    const owner = input.invoice.customer
      ? await tenantFromStripeCustomer(input.invoice.customer)
      : null;
    return owner ?? { tenantId: null, userId: null };
  }
  const subscription = await stripeApi.retrieveSubscription(subscriptionId);
  return syncStripeSubscription({
    subscription,
    eventId: input.eventId,
    paymentStatus: input.failed ? "failed" : input.invoice.status ?? "succeeded",
    paymentError: input.failed
      ? input.invoice.last_payment_error?.message ?? "Payment failed."
      : null,
  });
}
