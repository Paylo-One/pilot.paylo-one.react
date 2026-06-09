-- ============================================================================
-- 20260607160009_refinement.sql
-- User-guided refinement loop: explicit, inspectable, tenant-scoped rules and
-- preferences (NOT hidden model learning — ADR-033). Applied deterministically
-- by correlation/triage/memo. RLS-isolated via public.auth_tenant_ids().
-- Governance: architecture/information-refinement-loop.md,
-- services/refinement-rules-service.md, data-architecture.md.
-- ============================================================================

-- --- refinement_rules -------------------------------------------------------
create table public.refinement_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  rule_type   text not null
              check (rule_type in ('include_in_memo','exclude_from_memo','priority','person_link','topic_link','summarise_when_action','ignore_casual')),
  scope_type  text not null
              check (scope_type in ('person','source','chat','domain','topic','project','global')),
  scope_id    text not null,
  scope_label text,
  condition   text,
  action      text,
  statement   text,
  priority    int not null default 50,
  status      text not null default 'active' check (status in ('active','paused')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index refinement_rules_tenant_idx on public.refinement_rules (tenant_id, status, priority desc);
create trigger refinement_rules_set_updated_at before update on public.refinement_rules
  for each row execute function public.set_updated_at();

-- --- user_feedback_events (append-only) -------------------------------------
create table public.user_feedback_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  feedback_type text not null,
  target_type   text not null check (target_type in ('source_item','action','person','memo_section','chat')),
  target_id     text not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index user_feedback_events_tenant_idx on public.user_feedback_events (tenant_id, created_at desc);

-- --- triage_preferences -----------------------------------------------------
create table public.triage_preferences (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  scope_type                text not null,
  scope_id                  text not null,
  scope_label               text,
  importance                text not null default 'normal'
                            check (importance in ('critical','high','normal','low','muted')),
  summarise_only_when_action boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (tenant_id, scope_type, scope_id)
);
create trigger triage_preferences_set_updated_at before update on public.triage_preferences
  for each row execute function public.set_updated_at();

-- --- memo_preferences -------------------------------------------------------
create table public.memo_preferences (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  scope_type      text not null,
  scope_id        text not null,
  scope_label     text,
  include_in_memo boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, scope_type, scope_id)
);
create trigger memo_preferences_set_updated_at before update on public.memo_preferences
  for each row execute function public.set_updated_at();

-- --- correlation_feedback (append-only) -------------------------------------
create table public.correlation_feedback (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  source_item_id      uuid references public.source_items(id) on delete set null,
  proposed_person_id  uuid references public.people(id) on delete set null,
  corrected_person_id uuid references public.people(id) on delete set null,
  verdict             text not null check (verdict in ('correct','wrong','new_person')),
  created_at          timestamptz not null default now()
);
create index correlation_feedback_tenant_idx on public.correlation_feedback (tenant_id, created_at desc);

-- ============================================================================
-- Grants
-- ============================================================================
grant select, insert, update, delete on table public.refinement_rules to authenticated;
grant select, insert on table public.user_feedback_events to authenticated;       -- append-only
grant select, insert, update, delete on table public.triage_preferences to authenticated;
grant select, insert, update, delete on table public.memo_preferences to authenticated;
grant select, insert on table public.correlation_feedback to authenticated;       -- append-only

grant all on table public.refinement_rules to service_role;
grant all on table public.user_feedback_events to service_role;
grant all on table public.triage_preferences to service_role;
grant all on table public.memo_preferences to service_role;
grant all on table public.correlation_feedback to service_role;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.refinement_rules    enable row level security;
alter table public.user_feedback_events enable row level security;
alter table public.triage_preferences   enable row level security;
alter table public.memo_preferences     enable row level security;
alter table public.correlation_feedback enable row level security;

create policy rrules_select on public.refinement_rules for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy rrules_insert on public.refinement_rules for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy rrules_update on public.refinement_rules for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy rrules_delete on public.refinement_rules for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy ufe_select on public.user_feedback_events for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy ufe_insert on public.user_feedback_events for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );

create policy triage_select on public.triage_preferences for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy triage_insert on public.triage_preferences for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy triage_update on public.triage_preferences for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy triage_delete on public.triage_preferences for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy memopref_select on public.memo_preferences for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy memopref_insert on public.memo_preferences for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy memopref_update on public.memo_preferences for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy memopref_delete on public.memo_preferences for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy corrfb_select on public.correlation_feedback for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy corrfb_insert on public.correlation_feedback for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
