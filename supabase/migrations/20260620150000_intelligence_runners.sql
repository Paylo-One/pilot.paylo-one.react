-- ============================================================================
-- 20260620150000_intelligence_runners.sql
-- Persistence homes for the remaining wired pipelines:
--   - signal_groups   — triage output: related items grouped under a theme with
--                       one recommended move (the "reduce overload" view).
--   - operating_reviews — the weekly operating review (tenant-level roll-up).
-- Plus the weekly_operating_review prompt template key.
--
-- Same tenant-scoped pattern as the rest of the intelligence layer: RLS read for
-- members, all writes via the service role. Governance:
-- ai-prompts/ai-prompts-redesign.md.
-- ============================================================================

-- --- signal_groups (triage) --------------------------------------------------
create table public.signal_groups (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  theme              text not null,
  item_ids           uuid[] not null default '{}',
  recommended_action text not null
                       check (recommended_action in
                         ('respond','delegate','schedule','escalate','turn_into_action','ignore')),
  urgency            text not null default 'none'
                       check (urgency in ('now','today','this_week','none')),
  draft_note         text not null default '',
  prompt_version_id  uuid references public.prompt_versions(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index signal_groups_tenant_idx on public.signal_groups (tenant_id, created_at desc);

-- --- operating_reviews (weekly) ----------------------------------------------
create table public.operating_reviews (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  week_start_date    date not null,
  summary            text not null default '',
  moved              text[] not null default '{}',
  stalled            text[] not null default '{}',
  decisions          text[] not null default '{}',
  open_risks         text[] not null default '{}',
  next_focus         text[] not null default '{}',
  prompt_version_id  uuid references public.prompt_versions(id) on delete set null,
  generated_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (tenant_id, week_start_date)
);
create index operating_reviews_tenant_idx on public.operating_reviews (tenant_id, week_start_date desc);

-- --- expand the prompt template catalogue ------------------------------------
alter table public.tenant_prompts
  drop constraint tenant_prompts_template_key_check;
alter table public.tenant_prompts
  add constraint tenant_prompts_template_key_check check (template_key in (
    'daily_memo','signal_classification','signal_ranking','signal_triage',
    'action_extraction','decision_extraction','risk_detection',
    'diary_reflection','people_memory','source_processing','memory_synthesis',
    'weekly_operating_review'
  ));

-- --- grants + RLS ------------------------------------------------------------
grant select on table public.signal_groups     to authenticated;
grant select on table public.operating_reviews to authenticated;
grant all    on table public.signal_groups     to service_role;
grant all    on table public.operating_reviews to service_role;

alter table public.signal_groups     enable row level security;
alter table public.operating_reviews enable row level security;

create policy signal_groups_select on public.signal_groups
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

create policy operating_reviews_select on public.operating_reviews
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
