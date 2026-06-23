-- Keep local subscription defaults aligned with Stripe-managed EUR pricing.

alter table public.tenant_subscriptions
  alter column currency set default 'EUR';

alter table public.subscription_discounts
  alter column currency set default 'EUR';

update public.tenant_subscriptions
set currency = 'EUR',
    updated_at = now()
where provider = 'stripe'
  and currency = 'USD'
  and stripe_price_id is not null;
