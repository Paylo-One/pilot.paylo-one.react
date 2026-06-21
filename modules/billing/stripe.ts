import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  stripePriceBasicMonthly,
  stripeProductBasic,
  stripeSecretKey,
  stripeWebhookSecret,
} from "@/lib/config";

export const STRIPE_MANAGED_PAYMENTS_VERSION = "2026-02-25.preview";

const STRIPE_API_BASE = "https://api.stripe.com";

export interface StripePrice {
  readonly id: string;
  readonly product: string | { id: string };
  readonly unit_amount: number | null;
  readonly currency: string;
  readonly recurring?: { interval?: string } | null;
}

export interface StripeProduct {
  readonly id: string;
  readonly name: string;
  readonly default_price?: string | StripePrice | null;
}

export interface StripeCustomer {
  readonly id: string;
  readonly email?: string | null;
  readonly name?: string | null;
}

export interface StripeCheckoutSession {
  readonly id: string;
  readonly url: string | null;
  readonly customer?: string | null;
  readonly subscription?: string | null;
  readonly metadata?: Record<string, string> | null;
}

export interface StripePortalSession {
  readonly id: string;
  readonly url: string;
}

export interface StripeSubscription {
  readonly id: string;
  readonly customer: string;
  readonly status: string;
  readonly current_period_start?: number | null;
  readonly current_period_end?: number | null;
  readonly cancel_at_period_end?: boolean;
  readonly metadata?: Record<string, string> | null;
  readonly items?: {
    data?: Array<{
      price?: StripePrice | null;
    }>;
  };
}

export interface StripeInvoice {
  readonly id: string;
  readonly customer?: string | null;
  readonly subscription?: string | null;
  readonly status?: string | null;
  readonly last_payment_error?: { message?: string | null } | null;
}

export interface StripeEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly data: { object: T };
}

type StripeParams = Record<string, unknown>;

function appendParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendParam(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendParam(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.append(key, String(value));
}

function formBody(input: StripeParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) appendParam(params, key, value);
  return params;
}

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params?: StripeParams,
  options: {
    stripeVersion?: string;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${stripeSecretKey()}`,
  };
  if (options.stripeVersion) headers["stripe-version"] = options.stripeVersion;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let url = `${STRIPE_API_BASE}${path}`;
  let body: URLSearchParams | undefined;
  if (method === "GET" && params) {
    const query = formBody(params).toString();
    if (query) url += `?${query}`;
  } else if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = formBody(params ?? {});
  }

  const response = await fetch(url, { method, headers, body, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message)
        : `Stripe request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export const stripeApi = {
  retrieveProduct(id: string) {
    return stripeRequest<StripeProduct>("GET", `/v1/products/${id}`);
  },

  retrievePrice(id: string) {
    return stripeRequest<StripePrice>("GET", `/v1/prices/${id}`);
  },

  createManagedPaymentsProduct() {
    return stripeRequest<StripeProduct>(
      "POST",
      "/v1/products",
      {
        name: "Paylo One Personal Operator",
        description: "A monthly subscription for the Paylo One Personal Operator workspace.",
        tax_code: "txcd_10103100",
        default_price_data: {
          unit_amount: 1000,
          currency: "usd",
          recurring: { interval: "month" },
        },
      },
      { stripeVersion: STRIPE_MANAGED_PAYMENTS_VERSION },
    );
  },

  createCustomer(input: {
    email: string | null;
    name: string;
    tenantId: string;
    userId: string;
  }) {
    return stripeRequest<StripeCustomer>("POST", "/v1/customers", {
      email: input.email ?? undefined,
      name: input.name,
      metadata: {
        tenant_id: input.tenantId,
        user_id: input.userId,
      },
    });
  },

  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    tenantId: string;
    userId: string;
  }) {
    return stripeRequest<StripeCheckoutSession>(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        managed_payments: { enabled: true },
        metadata: {
          tenant_id: input.tenantId,
          user_id: input.userId,
        },
        subscription_data: {
          metadata: {
            tenant_id: input.tenantId,
            user_id: input.userId,
          },
        },
      },
      {
        stripeVersion: STRIPE_MANAGED_PAYMENTS_VERSION,
        idempotencyKey: `checkout:${input.tenantId}:${input.priceId}`,
      },
    );
  },

  createCustomerPortalSession(customerId: string, returnUrl: string) {
    return stripeRequest<StripePortalSession>("POST", "/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: returnUrl,
    });
  },

  retrieveSubscription(id: string) {
    return stripeRequest<StripeSubscription>("GET", `/v1/subscriptions/${id}`, {
      expand: ["items.data.price"],
    });
  },
};

export async function configuredStripePlan(): Promise<{
  productId: string;
  priceId: string;
}> {
  const productId = stripeProductBasic();
  const priceId = stripePriceBasicMonthly();
  const [product, price] = await Promise.all([
    stripeApi.retrieveProduct(productId),
    stripeApi.retrievePrice(priceId),
  ]);
  const priceProductId =
    typeof price.product === "string" ? price.product : price.product.id;
  if (priceProductId !== product.id) {
    throw new Error("Configured Stripe price does not belong to the configured product.");
  }
  if (price.unit_amount !== 1000 || price.currency !== "usd" || price.recurring?.interval !== "month") {
    throw new Error("Configured Stripe price is not the Paylo One monthly USD subscription.");
  }
  return { productId: product.id, priceId: price.id };
}

export async function createOrVerifyManagedPaymentsPlan(): Promise<{
  productId: string;
  priceId: string;
  created: boolean;
}> {
  const productId = process.env.STRIPE_PRODUCT_BASIC?.trim();
  const priceId = process.env.STRIPE_PRICE_BASIC_MONTHLY?.trim();
  if (productId && priceId) {
    const verified = await configuredStripePlan();
    return { ...verified, created: false };
  }

  const product = await stripeApi.createManagedPaymentsProduct();
  const defaultPrice = product.default_price;
  const newPriceId = typeof defaultPrice === "string" ? defaultPrice : defaultPrice?.id;
  if (!newPriceId) throw new Error("Stripe did not return a default price for the created product.");
  return { productId: product.id, priceId: newPriceId, created: true };
}

export function verifyStripeWebhookPayload(payload: string, signature: string | null): StripeEvent {
  if (!signature) throw new Error("Missing Stripe signature.");

  const timestamp = signature
    .split(",")
    .map((part) => part.split("="))
    .find(([key]) => key === "t")?.[1];
  const signatures = signature
    .split(",")
    .map((part) => part.split("="))
    .filter(([key]) => key === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe signature header.");
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    throw new Error("Stripe signature timestamp is outside tolerance.");
  }

  const expected = createHmac("sha256", stripeWebhookSecret())
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const matches = signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "hex");
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });

  if (!matches) throw new Error("Stripe signature verification failed.");
  return JSON.parse(payload) as StripeEvent;
}
