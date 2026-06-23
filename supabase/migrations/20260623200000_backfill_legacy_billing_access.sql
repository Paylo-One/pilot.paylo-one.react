-- Backfill billing access for tenants provisioned before the billing system
-- shipped (20260621144559_stripe_managed_billing.sql).
--
-- createTrialBillingAccess() runs at tenant provisioning / invitation
-- activation, so only tenants created on or after the billing rollout get a
-- billing_access row. Tenants created earlier are stuck on the "Billing is
-- being prepared" state because getBillingAccess() returns null for them.
--
-- This grants those legacy tenants the same 7-day trial a new tenant receives,
-- starting now (backdating to creation would mark them already-expired and
-- immediately restrict access). Idempotent: NOT EXISTS skips any tenant that
-- already has a row, so this is safe to re-run across environments.

insert into billing_access (tenant_id, user_id, billing_status, access_status,
                            free_access_started_at, free_access_ends_at,
                            current_period_start, current_period_end)
select t.id, tu.user_id, 'trialing', 'active',
       now(), now() + interval '7 days',
       now(), now() + interval '7 days'
from tenants t
join tenant_users tu on tu.tenant_id = t.id and tu.role = 'owner'
where t.status = 'active'
  and not exists (select 1 from billing_access ba where ba.tenant_id = t.id);

insert into tenant_subscriptions (tenant_id, plan_key, status, billing_interval,
                                  owner_user_id, provider, trial_ends_at,
                                  current_period_start, current_period_end, currency)
select t.id, 'plan_operator', 'trialing', 'month',
       tu.user_id, 'stripe', now() + interval '7 days',
       now(), now() + interval '7 days', 'EUR'
from tenants t
join tenant_users tu on tu.tenant_id = t.id and tu.role = 'owner'
where t.status = 'active'
  and not exists (
    select 1 from tenant_subscriptions ts
    where ts.tenant_id = t.id
      and ts.status in ('trialing','active','past_due','grace','suspended','cancelled','unpaid','incomplete')
  );
