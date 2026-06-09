-- ============================================================================
-- 20260607160007_people_context.sql
-- People Context: people + cross-source identities, aliases, relationships,
-- tags, notes, merge events, link suggestions. The relationship layer that
-- turns fragmented information into relationship-aware operating intelligence.
-- Tenant-isolated via public.auth_tenant_ids(); people are never matched across
-- tenants (ADR-029/034; ../risks/security-risks.md SR-40).
-- Governance: architecture/people-context-architecture.md, data-architecture.md.
-- ============================================================================

-- --- people -----------------------------------------------------------------
create table public.people (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  display_name      text not null,
  role_title        text,
  organisation      text,
  relationship_type text not null default 'other'
                    check (relationship_type in ('report','manager','peer','investor','customer','vendor','partner','external','other')),
  importance_level  text not null default 'normal'
                    check (importance_level in ('critical','high','normal','low')),
  status            text not null default 'active' check (status in ('active','inactive')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index people_tenant_idx on public.people (tenant_id, display_name);
create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();

-- --- person_identities (per-source mapping; verified = trust anchor) --------
create table public.person_identities (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  person_id            uuid not null references public.people(id) on delete cascade,
  source_type          text not null,                 -- source_system or 'generic'
  source_connection_id uuid references public.source_connections(id) on delete set null,
  identity_type        text not null
                       check (identity_type in ('email','phone','whatsapp','teams','github','notion','alias')),
  identity_value       text not null,
  provider_user_id     text,
  confidence           numeric(4,3) not null default 0.5,
  verified_by_user     boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, source_type, identity_value)
);
create index person_identities_tenant_idx on public.person_identities (tenant_id);
create index person_identities_person_idx on public.person_identities (person_id);
create trigger person_identities_set_updated_at before update on public.person_identities
  for each row execute function public.set_updated_at();

-- --- person_aliases ---------------------------------------------------------
create table public.person_aliases (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  alias     text not null,
  source    text,
  created_at timestamptz not null default now()
);
create index person_aliases_person_idx on public.person_aliases (person_id);

-- --- person_relationships (person → person/project/topic) -------------------
create table public.person_relationships (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  related_type  text not null check (related_type in ('person','project','topic')),
  related_id    text not null,
  related_label text,
  kind          text,
  created_at    timestamptz not null default now()
);
create index person_relationships_person_idx on public.person_relationships (person_id);

-- --- person_tags ------------------------------------------------------------
create table public.person_tags (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  tag       text not null,
  unique (person_id, tag)
);
create index person_tags_person_idx on public.person_tags (person_id);

-- --- person_notes (sensitive; SR-38) ----------------------------------------
create table public.person_notes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index person_notes_person_idx on public.person_notes (person_id);

-- --- person_merge_events (append-only; reversible merges) -------------------
create table public.person_merge_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  from_person_id uuid not null,
  into_person_id uuid not null,
  performed_by   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index person_merge_events_tenant_idx on public.person_merge_events (tenant_id, created_at desc);

-- --- person_link_suggestions (confirmable; never auto-applied) --------------
create table public.person_link_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  source_item_id     uuid references public.source_items(id) on delete cascade,
  source_system      text,
  observed_identity  text not null,
  candidate_person_id uuid references public.people(id) on delete set null,
  confidence         numeric(4,3) not null default 0,
  reason             text,
  status             text not null default 'pending'
                     check (status in ('pending','confirmed','rejected','new_person')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index person_link_suggestions_tenant_idx on public.person_link_suggestions (tenant_id, status);
create trigger person_link_suggestions_set_updated_at before update on public.person_link_suggestions
  for each row execute function public.set_updated_at();

-- --- cross-cutting: person-linked provenance --------------------------------
alter table public.source_references add column person_id uuid references public.people(id) on delete set null;
alter table public.suggested_actions  add column person_id uuid references public.people(id) on delete set null;

-- ============================================================================
-- Grants
-- ============================================================================
grant select, insert, update, delete on table public.people to authenticated;
grant select, insert, update, delete on table public.person_identities to authenticated;
grant select, insert, update, delete on table public.person_aliases to authenticated;
grant select, insert, update, delete on table public.person_relationships to authenticated;
grant select, insert, update, delete on table public.person_tags to authenticated;
grant select, insert, update, delete on table public.person_notes to authenticated;
grant select, insert on table public.person_merge_events to authenticated; -- append-only
grant select, insert, update, delete on table public.person_link_suggestions to authenticated;

grant all on table public.people to service_role;
grant all on table public.person_identities to service_role;
grant all on table public.person_aliases to service_role;
grant all on table public.person_relationships to service_role;
grant all on table public.person_tags to service_role;
grant all on table public.person_notes to service_role;
grant all on table public.person_merge_events to service_role;
grant all on table public.person_link_suggestions to service_role;

-- ============================================================================
-- RLS — tenant isolation on every table
-- ============================================================================
alter table public.people                  enable row level security;
alter table public.person_identities        enable row level security;
alter table public.person_aliases           enable row level security;
alter table public.person_relationships     enable row level security;
alter table public.person_tags              enable row level security;
alter table public.person_notes             enable row level security;
alter table public.person_merge_events       enable row level security;
alter table public.person_link_suggestions   enable row level security;

-- Helper: standard tenant CRUD policies (select/insert/update/delete).
create policy people_select on public.people for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy people_insert on public.people for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy people_update on public.people for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy people_delete on public.people for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy pid_select on public.person_identities for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy pid_insert on public.person_identities for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy pid_update on public.person_identities for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy pid_delete on public.person_identities for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy palias_select on public.person_aliases for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy palias_insert on public.person_aliases for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy palias_delete on public.person_aliases for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy prel_select on public.person_relationships for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy prel_insert on public.person_relationships for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy prel_delete on public.person_relationships for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy ptag_select on public.person_tags for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy ptag_insert on public.person_tags for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy ptag_delete on public.person_tags for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy pnote_select on public.person_notes for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy pnote_insert on public.person_notes for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy pnote_delete on public.person_notes for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy pmerge_select on public.person_merge_events for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy pmerge_insert on public.person_merge_events for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );

create policy psug_select on public.person_link_suggestions for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy psug_insert on public.person_link_suggestions for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy psug_update on public.person_link_suggestions for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy psug_delete on public.person_link_suggestions for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
