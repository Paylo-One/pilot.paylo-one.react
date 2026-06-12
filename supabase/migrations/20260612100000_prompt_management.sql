-- ============================================================================
-- 20260612100000_prompt_management.sql
-- Tenant-scoped prompt management: each tenant owns a prompt library (seeded
-- from the in-code default catalogue) for the AI workflows — daily memo,
-- signal classification, signal ranking, signal triage — with append-only
-- versioning, an activation state machine, test runs, and execution linkage
-- so every AI output traces back to the exact prompt version that produced it.
--
-- Invariants enforced here, not in app code:
--  - versions are append-only (no authenticated UPDATE policies at all);
--  - at most one ACTIVE version per tenant prompt (partial unique index);
--  - activation is atomic (activate_prompt_version archives + activates in
--    one transaction).
--
-- Writes happen server-side with the service role (server actions); the
-- authenticated role may only read its tenant's rows.
-- Governance: services/prompt-versioning-service.md,
-- architecture/model-inference-architecture.md §11.
-- ============================================================================

-- --- tenant_prompts ----------------------------------------------------------
-- One row per workflow template per tenant — the tenant's own copy of a
-- catalogue template. Metadata is editable; content lives in prompt_versions.

create table public.tenant_prompts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  template_key      text not null check (template_key in
                      ('daily_memo','signal_classification','signal_ranking','signal_triage')),
  name              text not null,
  description       text,
  workflow          text not null,
  catalogue_version text not null,
  archived_at       timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, template_key)
);
create index tenant_prompts_tenant_idx on public.tenant_prompts (tenant_id, template_key);
create trigger tenant_prompts_set_updated_at before update on public.tenant_prompts
  for each row execute function public.set_updated_at();

-- --- prompt_versions ---------------------------------------------------------
-- Append-only version history. Content fields are immutable once written;
-- only the status lifecycle (draft → active → archived) ever changes, and only
-- via the service role / activate_prompt_version().

create table public.prompt_versions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  tenant_prompt_id          uuid not null references public.tenant_prompts(id) on delete cascade,
  version_number            int  not null,
  content                   text not null,
  input_variables           jsonb not null default '[]'::jsonb,
  output_format             jsonb not null default '{}'::jsonb,
  model_settings            jsonb not null default '{}'::jsonb,
  status                    text not null default 'draft'
                              check (status in ('draft','active','archived')),
  change_note               text,
  restored_from_version_id  uuid references public.prompt_versions(id) on delete set null,
  created_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  activated_at              timestamptz,
  activated_by              uuid references auth.users(id) on delete set null,
  archived_at               timestamptz,
  unique (tenant_prompt_id, version_number)
);
create unique index prompt_versions_one_active
  on public.prompt_versions (tenant_prompt_id) where status = 'active';
create index prompt_versions_tenant_idx
  on public.prompt_versions (tenant_id, tenant_prompt_id, version_number desc);

-- --- activate_prompt_version -------------------------------------------------
-- Atomic activation: archive the currently active version (if any) and
-- activate the target, in one transaction. Raises on tenant mismatch or when
-- the target is already active. SECURITY DEFINER so the service role calls it
-- via RPC; the tenant predicate is explicit and mandatory.

create or replace function public.activate_prompt_version(
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
  v_prompt_id uuid;
  v_status    text;
begin
  select tenant_prompt_id, status into v_prompt_id, v_status
  from public.prompt_versions
  where id = p_version_id and tenant_id = p_tenant_id
  for update;

  if v_prompt_id is null then
    raise exception 'prompt version not found for tenant';
  end if;
  if v_status = 'active' then
    raise exception 'prompt version is already active';
  end if;

  update public.prompt_versions
  set status = 'archived', archived_at = now()
  where tenant_prompt_id = v_prompt_id and status = 'active';

  update public.prompt_versions
  set status = 'active', activated_at = now(), activated_by = p_user_id,
      archived_at = null
  where id = p_version_id;
end;
$$;

revoke all on function public.activate_prompt_version(uuid, uuid, uuid) from public;
grant execute on function public.activate_prompt_version(uuid, uuid, uuid) to service_role;

-- --- prompt_test_runs --------------------------------------------------------
-- Full record of a pre-activation test: input sent, version + settings used,
-- output, validation outcome, and errors. Append-only evidence.

create table public.prompt_test_runs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  tenant_prompt_id   uuid not null references public.tenant_prompts(id) on delete cascade,
  prompt_version_id  uuid not null references public.prompt_versions(id) on delete cascade,
  requested_by       uuid references auth.users(id) on delete set null,
  input_kind         text not null check (input_kind in ('source_items','pasted')),
  input_payload      jsonb not null,
  model_id           text,
  model_settings     jsonb,
  status             text not null check (status in ('ok','failed')),
  output             jsonb,
  validation         jsonb,
  error              text,
  latency_ms         int,
  total_tokens       int,
  created_at         timestamptz not null default now()
);
create index prompt_test_runs_tenant_idx
  on public.prompt_test_runs (tenant_id, tenant_prompt_id, created_at desc);

-- --- execution linkage -------------------------------------------------------
-- Trace every metered invocation (and every briefing) back to the exact prompt
-- version that produced it. Null = the in-code default/fallback served the call.

alter table public.model_usage
  add column prompt_template_key text,
  add column prompt_version_id uuid references public.prompt_versions(id) on delete set null,
  add column is_test boolean not null default false;

alter table public.briefings
  add column prompt_version_id uuid references public.prompt_versions(id) on delete set null;

-- --- grants ------------------------------------------------------------------
grant select on table public.tenant_prompts to authenticated;
grant select on table public.prompt_versions to authenticated;
grant select on table public.prompt_test_runs to authenticated;

grant all on table public.tenant_prompts to service_role;
grant all on table public.prompt_versions to service_role;
grant all on table public.prompt_test_runs to service_role;

-- --- RLS ----------------------------------------------------------------------
alter table public.tenant_prompts  enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.prompt_test_runs enable row level security;

-- Read: tenant members see their tenant's prompts/versions/test runs.
-- Write: none for authenticated — the append-only and single-active invariants
-- are enforced by routing all mutations through server actions (service role).
create policy tenant_prompts_select on public.tenant_prompts
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy prompt_versions_select on public.prompt_versions
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy prompt_test_runs_select on public.prompt_test_runs
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
