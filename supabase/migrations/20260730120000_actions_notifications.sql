-- ============================================================================
-- 20260730120000_actions_notifications.sql
--
-- Three related capabilities for the Actions surface refresh:
--
-- 1. Semantic duplicate detection for suggested actions. The extraction
--    pipeline previously inserted every attributed suggestion; duplicates were
--    only caught client-side by token overlap. This adds a tenant-scoped
--    similarity RPC over the existing `knowledge_embeddings` table
--    (entity_type = 'action', vector(1536), text-embedding-3-small) joined to
--    open `suggested_actions`, plus a v2 persist function that returns the
--    inserted ids so the caller can write embeddings for new rows immediately.
--
-- 2. In-app notifications: a per-user, per-tenant `notifications` table with a
--    dedupe key so one underlying event never produces two rows. Reads and
--    read-state updates go through RLS (the user client); inserts are
--    service_role only (background jobs).
--
-- 3. Daily briefing email delivery log + per-user email preferences on
--    `user_profiles`. The unique dedupe key on the log is the second
--    idempotency guard (after Inngest's event idempotency): a claim row is
--    inserted before sending, so the same briefing can never be sent twice.
--
-- Rollback guidance (safe, no data loss to pre-existing tables):
--   drop function if exists public.match_open_action_embeddings(uuid, vector, text, int, int);
--   drop function if exists public.persist_suggested_actions_v2(uuid, jsonb);
--   drop table if exists public.notifications;
--   drop table if exists public.notification_deliveries;
--   alter table public.user_profiles
--     drop column if exists daily_briefing_email,
--     drop column if exists unsubscribe_token;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. Similarity search over open actions.
-- Always tenant-filtered; vector indexes do not isolate tenants by themselves.
-- Joins knowledge_embeddings (entity_type 'action') to suggested_actions so
-- status and recency are enforced in the database, not the caller.
-- ----------------------------------------------------------------------------
create or replace function public.match_open_action_embeddings(
  p_tenant_id uuid,
  p_query_embedding vector(1536),
  p_embedding_model text,
  p_match_count int default 5,
  p_recency_days int default 90
)
returns table (
  action_id uuid,
  title text,
  status text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sa.id as action_id,
    sa.title,
    sa.status,
    sa.created_at,
    1 - (ke.embedding operator(public.<=>) p_query_embedding) as similarity
  from public.knowledge_embeddings ke
  join public.suggested_actions sa
    on sa.id = ke.entity_id
   and sa.tenant_id = ke.tenant_id
  where ke.tenant_id = p_tenant_id
    and ke.entity_type = 'action'
    and ke.embedding_model = p_embedding_model
    and ke.visibility <> 'hidden'
    and sa.status in ('inbox', 'planned', 'in_progress', 'waiting', 'follow_up')
    and sa.created_at >= now() - make_interval(days => greatest(1, coalesce(p_recency_days, 90)))
  order by ke.embedding operator(public.<=>) p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 5), 20));
$$;

revoke all on function public.match_open_action_embeddings(uuid, vector, text, int, int) from public;
grant execute on function public.match_open_action_embeddings(uuid, vector, text, int, int) to service_role;

-- ----------------------------------------------------------------------------
-- 1b. persist_suggested_actions_v2: same atomic action+references write as
-- persist_suggested_actions (kept for compatibility), but returns the inserted
-- ids and accepts optional duplicate-review metadata so an uncertain semantic
-- match is preserved for review rather than silently merged.
-- ----------------------------------------------------------------------------
create or replace function public.persist_suggested_actions_v2(
  p_tenant_id uuid,
  p_actions jsonb
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
  v_ref jsonb;
  v_action_id uuid;
begin
  for v_action in
    select value from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb))
  loop
    insert into public.suggested_actions (
      tenant_id, status, created_from, title, rationale, due_at,
      duplicate_group_id, duplicate_confidence, duplicate_reason
    )
    values (
      p_tenant_id,
      coalesce(v_action ->> 'status', 'inbox'),
      coalesce(v_action ->> 'created_from', 'suggestion'),
      v_action ->> 'title',
      v_action ->> 'rationale',
      nullif(v_action ->> 'due_at', '')::timestamptz,
      nullif(v_action ->> 'duplicate_group_id', '')::uuid,
      nullif(v_action ->> 'duplicate_confidence', '')::numeric,
      nullif(v_action ->> 'duplicate_reason', '')
    )
    returning id into v_action_id;

    for v_ref in
      select value from jsonb_array_elements(coalesce(v_action -> 'references', '[]'::jsonb))
    loop
      insert into public.source_references (
        tenant_id, suggested_action_id, source_item_id, source_system,
        item_timestamp, confidence, excerpt_or_pointer
      )
      values (
        p_tenant_id,
        v_action_id,
        nullif(v_ref ->> 'source_item_id', '')::uuid,
        v_ref ->> 'source_system',
        nullif(v_ref ->> 'item_timestamp', '')::timestamptz,
        nullif(v_ref ->> 'confidence', '')::numeric,
        v_ref ->> 'excerpt_or_pointer'
      );
    end loop;

    return next v_action_id;
  end loop;
end;
$$;

revoke all on function public.persist_suggested_actions_v2(uuid, jsonb) from public;
grant execute on function public.persist_suggested_actions_v2(uuid, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 2. In-app notifications.
-- One row per user-visible nudge. `dedupe_key` collapses repeats of the same
-- underlying event (e.g. one review nudge per pipeline run, one overdue nudge
-- per local calendar day).
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'actions_to_review', 'actions_overdue', 'briefing_ready', 'action_assigned'
  )),
  title text not null,
  body text,
  action_id uuid references public.suggested_actions(id) on delete cascade,
  href text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, kind, dedupe_key)
);

create index if not exists notifications_unread_idx
  on public.notifications (tenant_id, user_id, created_at desc)
  where read_at is null;
create index if not exists notifications_user_idx
  on public.notifications (tenant_id, user_id, created_at desc);

alter table public.notifications enable row level security;

-- Users read and mark-read their own notifications; only jobs create them.
-- drop-then-create keeps the whole migration safe to re-run.
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    user_id = (select auth.uid())
    and tenant_id in (select public.auth_tenant_ids())
  );
create policy notifications_update on public.notifications
  for update using (
    user_id = (select auth.uid())
    and tenant_id in (select public.auth_tenant_ids())
  ) with check (
    user_id = (select auth.uid())
    and tenant_id in (select public.auth_tenant_ids())
  );

grant select, update on public.notifications to authenticated;

-- ----------------------------------------------------------------------------
-- 3a. Notification delivery log (email). The unique dedupe key makes scheduled
-- delivery idempotent: the sender claims (tenant, user, kind, dedupe_key)
-- before calling the provider; a conflict means the briefing was already
-- handled today. `status` records what happened for observability
-- ('sending' -> 'sent' | 'failed' | 'skipped_empty').
-- ----------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('daily_briefing')),
  dedupe_key text not null,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed', 'skipped_empty', 'skipped_unconfigured')),
  error text,
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, user_id, kind, dedupe_key)
);

create index if not exists notification_deliveries_tenant_idx
  on public.notification_deliveries (tenant_id, created_at desc);

alter table public.notification_deliveries enable row level security;
-- Service-role only: no policies, no grants to authenticated/anon.

-- ----------------------------------------------------------------------------
-- 3b. Email preferences on user_profiles. `unsubscribe_token` is a capability
-- token used in the email's unsubscribe link; rotating it invalidates old
-- links. Defaults keep the daily briefing on, matching briefing_time intent.
-- ----------------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists daily_briefing_email boolean not null default true,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists user_profiles_unsubscribe_token_idx
  on public.user_profiles (unsubscribe_token);
