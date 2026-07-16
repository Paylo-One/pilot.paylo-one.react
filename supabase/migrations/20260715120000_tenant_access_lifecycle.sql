-- Separate tenant access authority from subscription/payment lifecycle.
--
-- `tenants.status` is the application-access authority. Billing rows remain a
-- payment/provider projection and must never suspend or reactivate a tenant.

alter table public.tenants
  add column if not exists is_beta boolean not null default false,
  add column if not exists access_grant_type text not null default 'paid'
    check (access_grant_type in ('paid', 'complimentary', 'beta_exempt')),
  add column if not exists payment_enforcement_exempt boolean not null default false,
  add column if not exists manual_override_active boolean not null default false,
  add column if not exists suspension_reason_code text
    check (suspension_reason_code is null or suspension_reason_code in
      ('non_payment', 'abuse', 'compliance', 'security', 'administrative')),
  add column if not exists suspension_reason text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references auth.users(id) on delete set null,
  add column if not exists access_changed_at timestamptz,
  add column if not exists access_changed_by uuid references auth.users(id) on delete set null;

comment on column public.tenants.status is
  'Authoritative tenant lifecycle/access state. Only status=active may use protected application features.';
comment on column public.tenants.access_grant_type is
  'Commercial access basis; informational for billing enforcement and independent of tenants.status.';
comment on column public.tenants.payment_enforcement_exempt is
  'When true, payment state must not trigger an automated access-state change.';
comment on column public.tenants.manual_override_active is
  'Explicit administrator decision to retain access; billing automation must not remove access while set.';

-- Subscription lifecycle changes are intentionally billing-only. This replaces
-- the earlier function that also changed tenants.status as a side effect.
create or replace function public.admin_set_subscription_status(
  p_tenant_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_actor_roles text[];
  v_subscription public.tenant_subscriptions%rowtype;
  v_audit_id uuid;
  v_allowed boolean;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters' using errcode = '22023';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'expired') then
    raise exception 'unknown subscription status' using errcode = '22023';
  end if;

  perform 1 from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  select * into v_subscription
  from public.tenant_subscriptions
  where tenant_id = p_tenant_id
    and status in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  order by created_at desc limit 1 for update;
  if v_subscription.id is null then
    raise exception 'tenant has no mutable subscription' using errcode = 'P0002';
  end if;
  if v_subscription.status = p_status then
    raise exception 'subscription already has the requested status' using errcode = '22023';
  end if;

  select actor_email, actor_roles into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations', 'admin_finance']
  );

  v_allowed := case v_subscription.status
    when 'trialing' then p_status = any(array['active', 'grace', 'suspended', 'cancelled', 'expired'])
    when 'active' then p_status = any(array['past_due', 'grace', 'suspended', 'cancelled', 'expired'])
    when 'past_due' then p_status = any(array['active', 'grace', 'suspended', 'cancelled', 'expired'])
    when 'grace' then p_status = any(array['active', 'past_due', 'suspended', 'cancelled', 'expired'])
    when 'suspended' then p_status = any(array['active', 'cancelled', 'expired'])
    when 'cancelled' then p_status = any(array['active', 'expired'])
    else false
  end;
  if not v_allowed then
    raise exception 'subscription transition from % to % is not allowed',
      v_subscription.status, p_status using errcode = '22023';
  end if;

  update public.tenant_subscriptions
  set status = p_status,
      cancelled_at = case
        when p_status = 'cancelled' then now()
        when v_subscription.status = 'cancelled' then null
        else cancelled_at
      end,
      updated_at = now()
  where id = v_subscription.id;

  insert into public.admin_audit_events (
    actor_user_id, actor_email, actor_roles, action, entity_type, entity_id,
    tenant_id, before_state, after_state, reason, severity, correlation_id
  ) values (
    p_actor_user_id, v_actor_email, v_actor_roles,
    'tenant.subscription_status_changed', 'subscription', v_subscription.id::text,
    p_tenant_id,
    jsonb_build_object('subscriptionStatus', v_subscription.status),
    jsonb_build_object('subscriptionStatus', p_status),
    trim(p_reason),
    case when p_status in ('suspended', 'cancelled', 'expired') then 'risk' else 'warn' end,
    coalesce(p_correlation_id, gen_random_uuid())
  ) returning id into v_audit_id;

  return jsonb_build_object('tenantId', p_tenant_id, 'subscriptionId', v_subscription.id, 'auditEventId', v_audit_id);
end;
$$;

-- The only administrative write path for active/suspended application access.
create or replace function public.admin_set_tenant_access(
  p_tenant_id uuid,
  p_active boolean,
  p_reason_code text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_actor_roles text[];
  v_tenant public.tenants%rowtype;
  v_new_status text;
  v_audit_id uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters' using errcode = '22023';
  end if;
  if not p_active and (p_reason_code is null or p_reason_code not in
    ('non_payment', 'abuse', 'compliance', 'security', 'administrative')) then
    raise exception 'a valid suspension reason is required' using errcode = '22023';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if v_tenant.status not in ('active', 'suspended') then
    raise exception 'tenant lifecycle state % cannot be changed here', v_tenant.status using errcode = '22023';
  end if;
  if not p_active and v_tenant.manual_override_active then
    raise exception 'remove the manual active override before suspending this tenant' using errcode = '22023';
  end if;

  v_new_status := case when p_active then 'active' else 'suspended' end;
  if v_tenant.status = v_new_status then
    raise exception 'tenant already has the requested access status' using errcode = '22023';
  end if;

  select actor_email, actor_roles into v_actor_email, v_actor_roles
  from public.admin_assert_actor(p_actor_user_id, array['admin_owner', 'admin_operations']);

  update public.tenants set
    status = v_new_status,
    suspension_reason_code = case when p_active then null else p_reason_code end,
    suspension_reason = case when p_active then null else trim(p_reason) end,
    suspended_at = case when p_active then suspended_at else now() end,
    suspended_by = case when p_active then suspended_by else p_actor_user_id end,
    reactivated_at = case when p_active then now() else reactivated_at end,
    reactivated_by = case when p_active then p_actor_user_id else reactivated_by end,
    access_changed_at = now(),
    access_changed_by = p_actor_user_id,
    updated_at = now()
  where id = p_tenant_id;

  -- Compatibility projection for older billing screens. Runtime authorization
  -- reads tenants.status and never reads this value.
  update public.billing_access
  set access_status = case when p_active then 'active' else 'restricted' end,
      manual_override = case when p_active then 'restore_access_after_manual_review' else 'restrict_access' end,
      manual_override_reason = trim(p_reason),
      updated_at = now()
  where tenant_id = p_tenant_id;

  insert into public.admin_audit_events (
    actor_user_id, actor_email, actor_roles, action, entity_type, entity_id,
    tenant_id, before_state, after_state, reason, severity, correlation_id
  ) values (
    p_actor_user_id, v_actor_email, v_actor_roles,
    case when p_active then 'tenant.reactivated' else 'tenant.suspended' end,
    'tenant', p_tenant_id::text, p_tenant_id,
    jsonb_build_object('status', v_tenant.status, 'suspensionReasonCode', v_tenant.suspension_reason_code),
    jsonb_build_object('status', v_new_status, 'suspensionReasonCode', case when p_active then null else p_reason_code end),
    trim(p_reason), case when p_active then 'info' else 'risk' end,
    coalesce(p_correlation_id, gen_random_uuid())
  ) returning id into v_audit_id;

  return jsonb_build_object('tenantId', p_tenant_id, 'status', v_new_status, 'auditEventId', v_audit_id);
end;
$$;

create or replace function public.admin_set_tenant_access_policy(
  p_tenant_id uuid,
  p_is_beta boolean,
  p_access_grant_type text,
  p_payment_enforcement_exempt boolean,
  p_manual_override_active boolean,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_actor_roles text[];
  v_tenant public.tenants%rowtype;
  v_audit_id uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters' using errcode = '22023';
  end if;
  if p_access_grant_type not in ('paid', 'complimentary', 'beta_exempt') then
    raise exception 'unknown access grant type' using errcode = '22023';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if p_manual_override_active and v_tenant.status <> 'active' then
    raise exception 'manual active override requires an active tenant' using errcode = '22023';
  end if;
  select actor_email, actor_roles into v_actor_email, v_actor_roles
  from public.admin_assert_actor(p_actor_user_id, array['admin_owner', 'admin_operations']);

  update public.tenants set
    is_beta = p_is_beta or p_access_grant_type = 'beta_exempt',
    access_grant_type = p_access_grant_type,
    payment_enforcement_exempt = p_payment_enforcement_exempt
      or p_access_grant_type in ('complimentary', 'beta_exempt'),
    manual_override_active = p_manual_override_active,
    updated_at = now()
  where id = p_tenant_id;

  insert into public.admin_audit_events (
    actor_user_id, actor_email, actor_roles, action, entity_type, entity_id,
    tenant_id, before_state, after_state, reason, severity, correlation_id
  ) values (
    p_actor_user_id, v_actor_email, v_actor_roles,
    'tenant.access_policy_changed', 'tenant', p_tenant_id::text, p_tenant_id,
    jsonb_build_object('isBeta', v_tenant.is_beta, 'accessGrantType', v_tenant.access_grant_type,
      'paymentEnforcementExempt', v_tenant.payment_enforcement_exempt, 'manualOverrideActive', v_tenant.manual_override_active),
    jsonb_build_object('isBeta', p_is_beta or p_access_grant_type = 'beta_exempt', 'accessGrantType', p_access_grant_type,
      'paymentEnforcementExempt', p_payment_enforcement_exempt or p_access_grant_type in ('complimentary', 'beta_exempt'),
      'manualOverrideActive', p_manual_override_active),
    trim(p_reason), 'warn', coalesce(p_correlation_id, gen_random_uuid())
  ) returning id into v_audit_id;

  return jsonb_build_object('tenantId', p_tenant_id, 'auditEventId', v_audit_id);
end;
$$;

revoke all on function public.admin_set_tenant_access(uuid, boolean, text, text, uuid, uuid) from public;
revoke all on function public.admin_set_tenant_access_policy(uuid, boolean, text, boolean, boolean, text, uuid, uuid) from public;
grant execute on function public.admin_set_tenant_access(uuid, boolean, text, text, uuid, uuid) to service_role;
grant execute on function public.admin_set_tenant_access_policy(uuid, boolean, text, boolean, boolean, text, uuid, uuid) to service_role;
