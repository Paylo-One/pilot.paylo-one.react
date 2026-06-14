-- Migration: Actions Command Centre Schema Expansion
-- Refines and expands public.suggested_actions to support the full action command centre lifecycle.

-- 1. Evolve existing statuses to match the refined, simple state machine:
--    'suggested' -> 'inbox'
--    'approved'  -> 'planned'
--    'edited'    -> 'planned'
--    'deferred'  -> 'follow_up'
--    'dismissed' -> 'cancelled'

-- Temporary disable check constraint by dropping it first (we will replace it with the new constraint)
alter table public.suggested_actions drop constraint if exists suggested_actions_status_check;

-- Perform status data migration
update public.suggested_actions set status = 'inbox' where status = 'suggested';
update public.suggested_actions set status = 'planned' where status in ('approved', 'edited');
update public.suggested_actions set status = 'follow_up' where status = 'deferred';
update public.suggested_actions set status = 'cancelled' where status = 'dismissed';

-- 2. Add columns to public.suggested_actions
alter table public.suggested_actions 
  add column if not exists description text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists priority text not null default 'normal',
  add column if not exists completed_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_from text not null default 'manual',
  add column if not exists topics text[] not null default '{}',
  add column if not exists snooze_metadata jsonb,
  add column if not exists completion_metadata jsonb;

-- 3. Add check constraints
alter table public.suggested_actions
  add constraint suggested_actions_status_check 
    check (status in ('inbox', 'planned', 'in_progress', 'waiting', 'follow_up', 'completed', 'cancelled')),
  add constraint suggested_actions_priority_check 
    check (priority in ('critical', 'high', 'normal', 'low')),
  add constraint suggested_actions_created_from_check 
    check (created_from in ('manual', 'suggestion', 'diary', 'briefing', 'meeting', 'email'));

-- 4. Enable inserts and deletes for authenticated users on suggested_actions (since users can now capture and manage)
grant insert, delete on table public.suggested_actions to authenticated;

create policy actions_insert on public.suggested_actions
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) );

create policy actions_delete on public.suggested_actions
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

-- 5. Add indexes for command centre grouping and filtering performance
create index if not exists suggested_actions_due_idx on public.suggested_actions (tenant_id, due_at);
create index if not exists suggested_actions_follow_idx on public.suggested_actions (tenant_id, follow_up_at);
create index if not exists suggested_actions_topics_idx on public.suggested_actions using gin (topics);
create index if not exists suggested_actions_person_idx on public.suggested_actions (tenant_id, person_id);
