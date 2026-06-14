-- ============================================================================
-- 20260614150000_admin_operations_safety.sql
-- Safety-critical admin operations:
--   * first-class audit evidence columns;
--   * RLS-scoped platform-admin reads for shared operational tables;
--   * atomic tenant plan, subscription lifecycle, entitlement override, and
--     access-request provisioning operations.
--
-- All mutation functions are callable by service_role only. They still verify
-- that the supplied actor is an active platform admin holding an allowed role,
-- then commit the business mutation and audit event in the same transaction.
-- ============================================================================

-- --- Rich admin audit evidence ----------------------------------------------

alter table public.admin_audit_events
  add column actor_email text,
  add column actor_roles text[],
  add column tenant_id uuid references public.tenants(id) on delete set null,
  add column before_state jsonb,
  add column after_state jsonb,
  add column reason text,
  add column notes text,
  add column severity text not null default 'info'
    check (severity in ('info', 'warn', 'risk')),
  add column correlation_id uuid;

create index admin_audit_events_tenant_idx
  on public.admin_audit_events (tenant_id, occurred_at desc);
create index admin_audit_events_severity_idx
  on public.admin_audit_events (severity, occurred_at desc);
create index admin_audit_events_correlation_idx
  on public.admin_audit_events (correlation_id)
  where correlation_id is not null;

-- --- RLS-scoped admin reads over shared operational data --------------------

create policy tenants_platform_admin_select on public.tenants
  for select to authenticated
  using (public.is_platform_admin());

create policy tenant_users_platform_admin_select on public.tenant_users
  for select to authenticated
  using (public.is_platform_admin());

create policy tenant_domains_platform_admin_select on public.tenant_domains
  for select to authenticated
  using (public.is_platform_admin());

create policy user_profiles_platform_admin_select on public.user_profiles
  for select to authenticated
  using (public.is_platform_admin());

grant select on table public.access_requests to authenticated;
create policy access_requests_platform_admin_select on public.access_requests
  for select to authenticated
  using (public.is_platform_admin());

-- --- Shared actor assertion -------------------------------------------------

create or replace function public.admin_assert_actor(
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns table (actor_email text, actor_roles text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_roles text[];
begin
  select
    au.email,
    array(
      select aur.role_key
      from public.admin_user_roles aur
      where aur.user_id = au.user_id
      order by aur.role_key
    )
  into v_email, v_roles
  from public.admin_users au
  where au.user_id = p_actor_user_id
    and au.status = 'active'
    and exists (
      select 1
      from public.admin_user_roles allowed
      where allowed.user_id = au.user_id
        and allowed.role_key = any(p_allowed_roles)
    );

  if not found then
    raise exception 'active admin actor does not hold an allowed role'
      using errcode = '42501';
  end if;

  return query select v_email, v_roles;
end;
$$;

revoke all on function public.admin_assert_actor(uuid, text[]) from public;
grant execute on function public.admin_assert_actor(uuid, text[]) to service_role;

-- --- Atomic tenant plan change ---------------------------------------------

create or replace function public.admin_change_tenant_plan(
  p_tenant_id uuid,
  p_plan_key text,
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
  v_subscription public.tenant_subscriptions%rowtype;
  v_audit_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations', 'admin_finance']
  );

  if not exists (
    select 1
    from public.subscription_plans
    where plan_key = p_plan_key and is_active = true
  ) then
    raise exception 'active subscription plan not found'
      using errcode = '22023';
  end if;

  select *
  into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  select *
  into v_subscription
  from public.tenant_subscriptions
  where tenant_id = p_tenant_id
    and status in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  order by created_at desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'tenant has no mutable subscription' using errcode = 'P0002';
  end if;

  if v_subscription.plan_key = p_plan_key then
    raise exception 'subscription is already on the requested plan'
      using errcode = '22023';
  end if;

  v_before := jsonb_build_object(
    'tenantPlan', v_tenant.plan,
    'subscriptionId', v_subscription.id,
    'subscriptionPlan', v_subscription.plan_key,
    'subscriptionStatus', v_subscription.status
  );

  update public.tenants
  set plan = p_plan_key,
      updated_at = now()
  where id = p_tenant_id;

  update public.tenant_subscriptions
  set plan_key = p_plan_key,
      updated_at = now()
  where id = v_subscription.id;

  v_after := jsonb_build_object(
    'tenantPlan', p_plan_key,
    'subscriptionId', v_subscription.id,
    'subscriptionPlan', p_plan_key,
    'subscriptionStatus', v_subscription.status
  );

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    'tenant.plan_changed',
    'tenant',
    p_tenant_id::text,
    p_tenant_id,
    v_before,
    v_after,
    trim(p_reason),
    'warn',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'subscriptionId', v_subscription.id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_change_tenant_plan(uuid, text, text, uuid, uuid) from public;
grant execute on function public.admin_change_tenant_plan(uuid, text, text, uuid, uuid) to service_role;

-- --- Atomic subscription lifecycle transition -------------------------------

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
  v_tenant public.tenants%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_audit_id uuid;
  v_allowed boolean;
  v_requires_suspension_role boolean;
  v_tenant_status text;
  v_before jsonb;
  v_after jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  if p_status not in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'expired') then
    raise exception 'unknown subscription status' using errcode = '22023';
  end if;

  select *
  into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  select *
  into v_subscription
  from public.tenant_subscriptions
  where tenant_id = p_tenant_id
    and status in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  order by created_at desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'tenant has no mutable subscription' using errcode = 'P0002';
  end if;

  if v_subscription.status = p_status then
    raise exception 'subscription already has the requested status'
      using errcode = '22023';
  end if;

  v_requires_suspension_role :=
    v_subscription.status = 'suspended' or p_status = 'suspended';

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    case
      when v_requires_suspension_role
        then array['admin_owner', 'admin_operations']
      else array['admin_owner', 'admin_operations', 'admin_finance']
    end
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
      v_subscription.status, p_status
      using errcode = '22023';
  end if;

  v_before := jsonb_build_object(
    'subscriptionId', v_subscription.id,
    'subscriptionStatus', v_subscription.status,
    'tenantStatus', v_tenant.status
  );

  update public.tenant_subscriptions
  set status = p_status,
      cancelled_at = case
        when p_status = 'cancelled' then now()
        when v_subscription.status = 'cancelled' then null
        else cancelled_at
      end,
      updated_at = now()
  where id = v_subscription.id;

  v_tenant_status := v_tenant.status;
  if p_status = 'suspended' then
    v_tenant_status := 'suspended';
  elsif v_subscription.status = 'suspended'
    and p_status = 'active'
    and v_tenant.status = 'suspended' then
    v_tenant_status := 'active';
  end if;

  if v_tenant_status <> v_tenant.status then
    update public.tenants
    set status = v_tenant_status,
        updated_at = now()
    where id = p_tenant_id;
  end if;

  v_after := jsonb_build_object(
    'subscriptionId', v_subscription.id,
    'subscriptionStatus', p_status,
    'tenantStatus', v_tenant_status
  );

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    'tenant.subscription_status_changed',
    'subscription',
    v_subscription.id::text,
    p_tenant_id,
    v_before,
    v_after,
    trim(p_reason),
    case when p_status in ('suspended', 'cancelled', 'expired') then 'risk' else 'warn' end,
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'subscriptionId', v_subscription.id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_set_subscription_status(uuid, text, text, uuid, uuid) from public;
grant execute on function public.admin_set_subscription_status(uuid, text, text, uuid, uuid) to service_role;

-- --- Atomic entitlement override upsert -------------------------------------

create or replace function public.admin_set_tenant_override(
  p_tenant_id uuid,
  p_entitlement_key text,
  p_value jsonb,
  p_expires_at timestamptz,
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
  v_existing public.tenant_entitlement_overrides%rowtype;
  v_override_id uuid;
  v_duplicate_count integer;
  v_audit_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_entitlement_key, ''))) = 0 then
    raise exception 'entitlement key is required' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'override expiry must be in the future'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations', 'admin_finance']
  );

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || trim(p_entitlement_key), 0)
  );

  select count(*)::integer
  into v_duplicate_count
  from public.tenant_entitlement_overrides
  where tenant_id = p_tenant_id
    and entitlement_key = trim(p_entitlement_key);

  if v_duplicate_count > 1 then
    raise exception 'duplicate entitlement overrides require manual cleanup'
      using errcode = '23505';
  end if;

  select *
  into v_existing
  from public.tenant_entitlement_overrides
  where tenant_id = p_tenant_id
    and entitlement_key = trim(p_entitlement_key)
  limit 1
  for update;

  if v_existing.id is null then
    v_before := null;
    insert into public.tenant_entitlement_overrides (
      tenant_id,
      entitlement_key,
      value,
      reason,
      expires_at,
      created_by
    )
    values (
      p_tenant_id,
      trim(p_entitlement_key),
      p_value,
      trim(p_reason),
      p_expires_at,
      p_actor_user_id
    )
    returning id into v_override_id;
  else
    v_before := jsonb_build_object(
      'id', v_existing.id,
      'entitlementKey', v_existing.entitlement_key,
      'value', v_existing.value,
      'reason', v_existing.reason,
      'expiresAt', v_existing.expires_at
    );

    update public.tenant_entitlement_overrides
    set value = p_value,
        reason = trim(p_reason),
        expires_at = p_expires_at
    where id = v_existing.id
      and tenant_id = p_tenant_id
    returning id into v_override_id;
  end if;

  v_after := jsonb_build_object(
    'id', v_override_id,
    'entitlementKey', trim(p_entitlement_key),
    'value', p_value,
    'reason', trim(p_reason),
    'expiresAt', p_expires_at
  );

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    'tenant.override_modified',
    'entitlement_override',
    v_override_id::text,
    p_tenant_id,
    v_before,
    v_after,
    trim(p_reason),
    'warn',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'overrideId', v_override_id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_set_tenant_override(uuid, text, jsonb, timestamptz, text, uuid, uuid) from public;
grant execute on function public.admin_set_tenant_override(uuid, text, jsonb, timestamptz, text, uuid, uuid) to service_role;

-- --- Atomic entitlement override removal -----------------------------------

create or replace function public.admin_remove_tenant_override(
  p_tenant_id uuid,
  p_override_id uuid,
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
  v_existing public.tenant_entitlement_overrides%rowtype;
  v_audit_id uuid;
  v_before jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations', 'admin_finance']
  );

  select *
  into v_existing
  from public.tenant_entitlement_overrides
  where id = p_override_id
    and tenant_id = p_tenant_id
  for update;

  if v_existing.id is null then
    raise exception 'entitlement override not found for tenant'
      using errcode = 'P0002';
  end if;

  v_before := jsonb_build_object(
    'id', v_existing.id,
    'entitlementKey', v_existing.entitlement_key,
    'value', v_existing.value,
    'reason', v_existing.reason,
    'expiresAt', v_existing.expires_at
  );

  delete from public.tenant_entitlement_overrides
  where id = p_override_id
    and tenant_id = p_tenant_id;

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    'tenant.override_removed',
    'entitlement_override',
    p_override_id::text,
    p_tenant_id,
    v_before,
    null,
    trim(p_reason),
    'warn',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'overrideId', p_override_id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_remove_tenant_override(uuid, uuid, text, uuid, uuid) from public;
grant execute on function public.admin_remove_tenant_override(uuid, uuid, text, uuid, uuid) to service_role;

-- --- Atomic access-request preparation -------------------------------------
-- This deliberately prepares, rather than activates, a workspace. A tenant
-- cannot become active until a verified auth user is attached as owner by the
-- customer-app provisioning workflow.

create or replace function public.admin_prepare_access_request(
  p_access_request_id uuid,
  p_plan_key text,
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
  v_request public.access_requests%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_workspace_name text;
  v_slug_base text;
  v_slug text;
  v_tenant_id uuid;
  v_subscription_id uuid;
  v_onboarding_id uuid;
  v_audit_id uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations']
  );

  select *
  into v_request
  from public.access_requests
  where id = p_access_request_id
  for update;

  if v_request.id is null then
    raise exception 'access request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'access request has already been processed'
      using errcode = '22023';
  end if;

  select *
  into v_plan
  from public.subscription_plans
  where plan_key = p_plan_key
    and is_active = true;

  if v_plan.plan_key is null then
    raise exception 'active subscription plan not found'
      using errcode = '22023';
  end if;

  v_workspace_name := left(
    coalesce(
      nullif(trim(v_request.company_or_role), ''),
      trim(v_request.name) || '''s Workspace'
    ),
    120
  );

  v_slug_base := trim(both '-' from regexp_replace(
    lower(coalesce(nullif(trim(v_request.company_or_role), ''), trim(v_request.name))),
    '[^a-z0-9]+',
    '-',
    'g'
  ));
  if length(v_slug_base) < 2 then
    v_slug_base := 'workspace';
  end if;
  v_slug_base := left(v_slug_base, 48);
  v_slug := v_slug_base;

  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := left(v_slug_base, 39) || '-' ||
      left(replace(gen_random_uuid()::text, '-', ''), 8);
  end loop;

  insert into public.tenants (name, slug, status, plan)
  values (v_workspace_name, v_slug, 'provisioning', p_plan_key)
  returning id into v_tenant_id;

  insert into public.tenant_subscriptions (
    tenant_id,
    plan_key,
    status,
    billing_interval,
    provider,
    currency
  )
  values (
    v_tenant_id,
    p_plan_key,
    'trialing',
    'month',
    'manual',
    'USD'
  )
  returning id into v_subscription_id;

  insert into public.onboarding_requests (
    access_request_id,
    business_name,
    contact_name,
    contact_email,
    details,
    status,
    tenant_id,
    decided_at,
    decided_by
  )
  values (
    v_request.id,
    v_workspace_name,
    v_request.name,
    lower(trim(v_request.email)),
    jsonb_build_object(
      'source', v_request.source,
      'customerReason', v_request.reason,
      'requestedPlan', p_plan_key,
      'reservedTrialDays', v_plan.trial_days,
      'provisioningStage', 'awaiting_owner_identity'
    ),
    'provisioning',
    v_tenant_id,
    now(),
    p_actor_user_id
  )
  returning id into v_onboarding_id;

  update public.access_requests
  set status = 'approved',
      updated_at = now()
  where id = v_request.id;

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    'waitlist.request.approved_for_provisioning',
    'access_request',
    v_request.id::text,
    v_tenant_id,
    jsonb_build_object('status', v_request.status),
    jsonb_build_object(
      'status', 'approved',
      'tenantId', v_tenant_id,
      'tenantStatus', 'provisioning',
      'subscriptionId', v_subscription_id,
      'subscriptionStatus', 'trialing',
      'onboardingRequestId', v_onboarding_id,
      'provisioningStage', 'awaiting_owner_identity'
    ),
    trim(p_reason),
    'info',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'accessRequestId', v_request.id,
    'tenantId', v_tenant_id,
    'subscriptionId', v_subscription_id,
    'onboardingRequestId', v_onboarding_id,
    'slug', v_slug,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_prepare_access_request(uuid, text, text, uuid, uuid) from public;
grant execute on function public.admin_prepare_access_request(uuid, text, text, uuid, uuid) to service_role;
