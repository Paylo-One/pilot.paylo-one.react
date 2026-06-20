-- ============================================================================
-- 20260620140000_intelligence_layer.sql
-- The Intelligence layer: the configuration substrate behind how Pilot reads,
-- remembers, prioritises, and acts on a workspace's information.
--
-- This migration adds, all tenant-scoped:
--   1. Custom Skills — reusable, versioned instruction sets that compose into
--      prompts (custom_skills + custom_skill_versions, same append-only /
--      single-active machine as prompts; linked to prompts via
--      prompt_skill_links).
--   2. Manager Manifesto — one per tenant, versioned: the guiding principles
--      that are prepended to every governed AI call (manager_manifesto +
--      manifesto_versions).
--   3. Pipeline persistence — the data homes the previously-dormant pipelines
--      write into: signals (durable classification), decisions, risks, and a
--      first-class topics vocabulary (topics + entity_topics).
--   4. An expanded prompt template catalogue (new template_key values for the
--      action / decision / risk / diary / people / source / memory workflows).
--   5. Evaluation evidence on prompt_test_runs (LLM-judge scores + the version
--      a draft was compared against).
--
-- Invariants enforced here, not in app code (mirrors 20260612100000):
--   - versions are append-only (no authenticated UPDATE policies);
--   - at most one ACTIVE version per skill / per manifesto (partial unique idx);
--   - activation is atomic (archive previous + activate target in one txn).
-- Writes happen server-side with the service role; authenticated may only read
-- its own tenant's rows.
-- Governance: ai-prompts/ai-prompts-redesign.md.
-- ============================================================================

-- ===========================================================================
-- 1. CUSTOM SKILLS
-- ===========================================================================

-- One row per skill per tenant. Metadata is editable; behaviour lives in
-- custom_skill_versions. `skill_key` is stable for seeded defaults (so the
-- catalogue can be re-seeded idempotently); custom skills get a generated key.
create table public.custom_skills (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  skill_key         text not null,
  name              text not null,
  purpose           text not null default '',
  origin            text not null default 'custom'
                      check (origin in ('system_default','custom')),
  catalogue_version text not null default '1.0.0',
  archived_at       timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, skill_key)
);
create index custom_skills_tenant_idx on public.custom_skills (tenant_id, skill_key);
create trigger custom_skills_set_updated_at before update on public.custom_skills
  for each row execute function public.set_updated_at();

-- Append-only version history. Behavioural fields are immutable once written;
-- only the status lifecycle (draft -> active -> archived) changes, via the
-- service role / activate_custom_skill_version().
create table public.custom_skill_versions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  custom_skill_id           uuid not null references public.custom_skills(id) on delete cascade,
  version_number            int  not null,
  instructions              text not null,
  when_to_use               text not null default '',
  when_not_to_use           text not null default '',
  output_format             text not null default '',
  tone_guidance             text not null default '',
  required_context          text not null default '',
  safety_constraints        text not null default '',
  status                    text not null default 'draft'
                              check (status in ('draft','active','archived')),
  change_note               text,
  restored_from_version_id  uuid references public.custom_skill_versions(id) on delete set null,
  created_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  activated_at              timestamptz,
  activated_by              uuid references auth.users(id) on delete set null,
  archived_at               timestamptz,
  unique (custom_skill_id, version_number)
);
create unique index custom_skill_versions_one_active
  on public.custom_skill_versions (custom_skill_id) where status = 'active';
create index custom_skill_versions_tenant_idx
  on public.custom_skill_versions (tenant_id, custom_skill_id, version_number desc);

-- M:N — which skills compose into which prompts (and in what order).
create table public.prompt_skill_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  tenant_prompt_id  uuid not null references public.tenant_prompts(id) on delete cascade,
  custom_skill_id   uuid not null references public.custom_skills(id) on delete cascade,
  position          int  not null default 0,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (tenant_prompt_id, custom_skill_id)
);
create index prompt_skill_links_tenant_idx
  on public.prompt_skill_links (tenant_id, tenant_prompt_id, position);

-- ===========================================================================
-- 2. MANAGER MANIFESTO
-- ===========================================================================

-- Exactly one manifesto per tenant — the guiding-principles document.
create table public.manager_manifesto (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  catalogue_version text not null default '1.0.0',
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id)
);
create trigger manager_manifesto_set_updated_at before update on public.manager_manifesto
  for each row execute function public.set_updated_at();

create table public.manifesto_versions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  manifesto_id              uuid not null references public.manager_manifesto(id) on delete cascade,
  version_number            int  not null,
  body                      text not null,
  principles                jsonb not null default '[]'::jsonb,
  status                    text not null default 'draft'
                              check (status in ('draft','active','archived')),
  change_note               text,
  restored_from_version_id  uuid references public.manifesto_versions(id) on delete set null,
  created_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  activated_at              timestamptz,
  activated_by              uuid references auth.users(id) on delete set null,
  archived_at               timestamptz,
  unique (manifesto_id, version_number)
);
create unique index manifesto_versions_one_active
  on public.manifesto_versions (manifesto_id) where status = 'active';
create index manifesto_versions_tenant_idx
  on public.manifesto_versions (tenant_id, manifesto_id, version_number desc);

-- ===========================================================================
-- 3. ACTIVATION RPCs (mirror activate_prompt_version)
-- ===========================================================================

create or replace function public.activate_custom_skill_version(
  p_tenant_id  uuid,
  p_version_id uuid,
  p_user_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skill_id uuid;
  v_status   text;
begin
  select custom_skill_id, status into v_skill_id, v_status
  from public.custom_skill_versions
  where id = p_version_id and tenant_id = p_tenant_id
  for update;

  if v_skill_id is null then
    raise exception 'custom skill version not found for tenant';
  end if;
  if v_status = 'active' then
    raise exception 'custom skill version is already active';
  end if;

  update public.custom_skill_versions
  set status = 'archived', archived_at = now()
  where custom_skill_id = v_skill_id and status = 'active';

  update public.custom_skill_versions
  set status = 'active', activated_at = now(), activated_by = p_user_id,
      archived_at = null
  where id = p_version_id;
end;
$$;

revoke all on function public.activate_custom_skill_version(uuid, uuid, uuid) from public;
grant execute on function public.activate_custom_skill_version(uuid, uuid, uuid) to service_role;

create or replace function public.activate_manifesto_version(
  p_tenant_id  uuid,
  p_version_id uuid,
  p_user_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifesto_id uuid;
  v_status       text;
begin
  select manifesto_id, status into v_manifesto_id, v_status
  from public.manifesto_versions
  where id = p_version_id and tenant_id = p_tenant_id
  for update;

  if v_manifesto_id is null then
    raise exception 'manifesto version not found for tenant';
  end if;
  if v_status = 'active' then
    raise exception 'manifesto version is already active';
  end if;

  update public.manifesto_versions
  set status = 'archived', archived_at = now()
  where manifesto_id = v_manifesto_id and status = 'active';

  update public.manifesto_versions
  set status = 'active', activated_at = now(), activated_by = p_user_id,
      archived_at = null
  where id = p_version_id;
end;
$$;

revoke all on function public.activate_manifesto_version(uuid, uuid, uuid) from public;
grant execute on function public.activate_manifesto_version(uuid, uuid, uuid) to service_role;

-- ===========================================================================
-- 4. PIPELINE PERSISTENCE — the data homes for the wired pipelines
-- ===========================================================================

-- 4a. signals — durable classification of one source item (one row per item).
create table public.signals (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  source_item_id     uuid not null references public.source_items(id) on delete cascade,
  category           text not null
                       check (category in
                         ('decision_request','fyi','risk','commitment','question','noise')),
  importance         numeric(3,2) not null default 0 check (importance between 0 and 1),
  urgency            numeric(3,2) not null default 0 check (urgency between 0 and 1),
  action_required    boolean not null default false,
  linked_people      text[] not null default '{}',
  topics             text[] not null default '{}',
  confidence         numeric(3,2) not null default 0 check (confidence between 0 and 1),
  rationale          text not null default '',
  priority_score     numeric(3,2) check (priority_score between 0 and 1),
  priority_tier      text check (priority_tier in ('act_now','today','this_week','background')),
  prompt_version_id  uuid references public.prompt_versions(id) on delete set null,
  classified_at      timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source_item_id)
);
create index signals_tenant_idx on public.signals (tenant_id, classified_at desc);
create index signals_tenant_category_idx on public.signals (tenant_id, category);
create trigger signals_set_updated_at before update on public.signals
  for each row execute function public.set_updated_at();

-- 4b. decisions — the workspace decision log.
create table public.decisions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  title              text not null,
  rationale          text not null default '',
  context            text not null default '',
  status             text not null default 'open'
                       check (status in ('open','made','deferred','reversed')),
  decided_at         timestamptz,
  person_id          uuid references public.people(id) on delete set null,
  source_item_id     uuid references public.source_items(id) on delete set null,
  diary_entry_id     uuid references public.diary_entries(id) on delete set null,
  prompt_version_id  uuid references public.prompt_versions(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index decisions_tenant_idx on public.decisions (tenant_id, created_at desc);
create trigger decisions_set_updated_at before update on public.decisions
  for each row execute function public.set_updated_at();

-- 4c. risks — the workspace risk register (stays visible until resolved).
create table public.risks (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  title              text not null,
  description        text not null default '',
  category           text not null default 'operational',
  severity           text not null default 'medium'
                       check (severity in ('critical','high','medium','low')),
  likelihood         text not null default 'possible'
                       check (likelihood in ('certain','very_likely','likely','possible','unlikely')),
  status             text not null default 'active'
                       check (status in ('active','mitigating','accepted','resolved','closed')),
  mitigation_notes   text not null default '',
  owner_id           uuid references auth.users(id) on delete set null,
  person_id          uuid references public.people(id) on delete set null,
  source_item_id     uuid references public.source_items(id) on delete set null,
  diary_entry_id     uuid references public.diary_entries(id) on delete set null,
  prompt_version_id  uuid references public.prompt_versions(id) on delete set null,
  review_at          timestamptz,
  resolved_at        timestamptz,
  resolution_note    text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index risks_tenant_idx on public.risks (tenant_id, status, created_at desc);
create trigger risks_set_updated_at before update on public.risks
  for each row execute function public.set_updated_at();

-- 4d. topics — first-class topic vocabulary + a polymorphic join.
create table public.topics (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  description   text not null default '',
  importance    text not null default 'normal'
                  check (importance in ('critical','high','normal','low')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
create index topics_tenant_idx on public.topics (tenant_id, name);
create trigger topics_set_updated_at before update on public.topics
  for each row execute function public.set_updated_at();

create table public.entity_topics (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  topic_id     uuid not null references public.topics(id) on delete cascade,
  entity_type  text not null
                 check (entity_type in ('source_item','signal','action','decision','risk','person')),
  entity_id    uuid not null,
  created_at   timestamptz not null default now(),
  unique (topic_id, entity_type, entity_id)
);
create index entity_topics_tenant_idx on public.entity_topics (tenant_id, entity_type, entity_id);

-- ===========================================================================
-- 5. EXPANDED PROMPT TEMPLATE CATALOGUE
-- ===========================================================================
-- Widen the tenant_prompts.template_key check so the library can carry the
-- new purpose-grouped workflows. (The inline check is auto-named
-- tenant_prompts_template_key_check.)
alter table public.tenant_prompts
  drop constraint tenant_prompts_template_key_check;
alter table public.tenant_prompts
  add constraint tenant_prompts_template_key_check check (template_key in (
    'daily_memo','signal_classification','signal_ranking','signal_triage',
    'action_extraction','decision_extraction','risk_detection',
    'diary_reflection','people_memory','source_processing','memory_synthesis'
  ));

-- A human-readable purpose group on each prompt (denormalised for grouping in
-- the library UI; the canonical mapping also lives in code).
alter table public.tenant_prompts
  add column purpose text not null default 'Custom workflows';

-- ===========================================================================
-- 6. EVALUATION EVIDENCE ON TEST RUNS
-- ===========================================================================
-- The Testing Lab compares a version against the active one and records an
-- LLM-judge evaluation (per-dimension scores). Append-only evidence.
alter table public.prompt_test_runs
  add column evaluation jsonb,
  add column compared_version_id uuid references public.prompt_versions(id) on delete set null;

-- ===========================================================================
-- 7. GRANTS + RLS
-- ===========================================================================
grant select on table public.custom_skills          to authenticated;
grant select on table public.custom_skill_versions   to authenticated;
grant select on table public.prompt_skill_links      to authenticated;
grant select on table public.manager_manifesto       to authenticated;
grant select on table public.manifesto_versions      to authenticated;
grant select on table public.signals                 to authenticated;
grant select on table public.decisions               to authenticated;
grant select on table public.risks                   to authenticated;
grant select on table public.topics                  to authenticated;
grant select on table public.entity_topics           to authenticated;

grant all on table public.custom_skills          to service_role;
grant all on table public.custom_skill_versions   to service_role;
grant all on table public.prompt_skill_links      to service_role;
grant all on table public.manager_manifesto       to service_role;
grant all on table public.manifesto_versions      to service_role;
grant all on table public.signals                 to service_role;
grant all on table public.decisions               to service_role;
grant all on table public.risks                   to service_role;
grant all on table public.topics                  to service_role;
grant all on table public.entity_topics           to service_role;

alter table public.custom_skills          enable row level security;
alter table public.custom_skill_versions   enable row level security;
alter table public.prompt_skill_links      enable row level security;
alter table public.manager_manifesto       enable row level security;
alter table public.manifesto_versions      enable row level security;
alter table public.signals                 enable row level security;
alter table public.decisions               enable row level security;
alter table public.risks                   enable row level security;
alter table public.topics                  enable row level security;
alter table public.entity_topics           enable row level security;

-- Read: tenant members see their tenant's rows. Write: none for authenticated;
-- all mutations route through server actions (service role) so the append-only
-- and single-active invariants hold.
create policy custom_skills_select on public.custom_skills
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy custom_skill_versions_select on public.custom_skill_versions
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy prompt_skill_links_select on public.prompt_skill_links
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy manager_manifesto_select on public.manager_manifesto
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy manifesto_versions_select on public.manifesto_versions
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy signals_select on public.signals
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy decisions_select on public.decisions
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy risks_select on public.risks
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy topics_select on public.topics
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy entity_topics_select on public.entity_topics
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
