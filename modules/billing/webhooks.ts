import "server-only";

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  stripeApi,
  type StripeCheckoutSession,
  type StripeEvent,
  type StripeInvoice,
  type StripeSubscription,
} from "./stripe";
import { syncStripeInvoice, syncStripeSubscription } from "./access";

function eventStripeRefs(event: StripeEvent): {
  customerId: string | null;
  subscriptionId: string | null;
} {
  const object = event.data.object as Record<string, unknown>;
  const customer =
    typeof object.customer === "string" ? object.customer : null;
  const subscription =
    typeof object.subscription === "string" ? object.subscription : null;
  if (event.type.startsWith("customer.subscription.")) {
    return {
      customerId: customer,
      subscriptionId: typeof object.id === "string" ? object.id : subscription,
    };
  }
  return { customerId: customer, subscriptionId: subscription };
}

async function recordEvent(event: StripeEvent): Promise<{
  duplicate: boolean;
  rowId: string | null;
}> {
  const db = createSupabaseSecretClient();
  const refs = eventStripeRefs(event);
  const { data, error } = await db
    .from("billing_events")
    .insert({
      provider: "stripe",
      provider_event_id: event.id,
      type: event.type,
      payload: event,
      stripe_customer_id: refs.customerId,
      stripe_subscription_id: refs.subscriptionId,
    })
    .select("id")
    .single<{ id: string }>();

  if (!error) return { duplicate: false, rowId: data.id };
  if (error.code === "23505") return { duplicate: true, rowId: null };
  throw new Error(error.message);
}

async function markProcessed(input: {
  eventId: string;
  tenantId: string | null;
  userId: string | null;
  error?: string | null;
}) {
  const db = createSupabaseSecretClient();
  await db
    .from("billing_events")
    .update({
      tenant_id: input.tenantId,
      user_id: input.userId,
      processed: !input.error,
      processed_at: new Date().toISOString(),
      error: input.error ?? null,
    })
    .eq("provider", "stripe")
    .eq("provider_event_id", input.eventId);
}

async function handleCheckoutCompleted(event: StripeEvent<StripeCheckoutSession>) {
  const session = event.data.object;
  const subscriptionId = session.subscription;
  const customerId = session.customer;
  if (!subscriptionId || !customerId) {
    return { tenantId: null, userId: null };
  }

  const subscription = await stripeApi.retrieveSubscription(subscriptionId);
  const owner = await syncStripeSubscription({
    subscription,
    eventId: event.id,
    paymentStatus: "checkout_completed",
  });

  if (owner.tenantId) {
    const db = createSupabaseSecretClient();
    await db
      .from("billing_access")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        last_stripe_event_id: event.id,
      })
      .eq("tenant_id", owner.tenantId);
  }

  return owner;
}

export async function processStripeWebhookEvent(event: StripeEvent): Promise<{
  duplicate: boolean;
  handled: boolean;
}> {
  const recorded = await recordEvent(event);
  if (recorded.duplicate) return { duplicate: true, handled: true };

  try {
    let owner: { tenantId: string | null; userId: string | null } = {
      tenantId: null,
      userId: null,
    };

    switch (event.type) {
      case "checkout.session.completed":
        owner = await handleCheckoutCompleted(event as StripeEvent<StripeCheckoutSession>);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        owner = await syncStripeSubscription({
          subscription: event.data.object as StripeSubscription,
          eventId: event.id,
        });
        break;
      case "invoice.payment_succeeded":
        owner = await syncStripeInvoice({
          invoice: event.data.object as StripeInvoice,
          eventId: event.id,
          failed: false,
        });
        break;
      case "invoice.payment_failed":
        owner = await syncStripeInvoice({
          invoice: event.data.object as StripeInvoice,
          eventId: event.id,
          failed: true,
        });
        break;
      default:
        await markProcessed({
          eventId: event.id,
          tenantId: null,
          userId: null,
        });
        return { duplicate: false, handled: false };
    }

    await markProcessed({
      eventId: event.id,
      tenantId: owner.tenantId,
      userId: owner.userId,
    });
    return { duplicate: false, handled: true };
  } catch (error) {
    await markProcessed({
      eventId: event.id,
      tenantId: null,
      userId: null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
