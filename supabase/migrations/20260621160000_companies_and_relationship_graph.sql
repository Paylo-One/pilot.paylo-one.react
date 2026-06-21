-- ============================================================================
-- 20260621160000_companies_and_relationship_graph.sql
-- Companies as a first-class entity + a graph-ready, explainable edge model
-- (entity_links) connecting people, companies, topics, actions, decisions,
-- diary entries, briefings, and source items. Turns People into the relationship
-- intelligence layer: who matters, why, and how they are connected.
--
-- Tenant-isolated via public.auth_tenant_ids(); companies and links are never
-- matched across tenants (ADR-029/034; ../risks/security-risks.md SR-40).
-- Mirrors the people-context migration (20260607160007_people_context.sql).
-- Governance: docs/product/people-and-companies.md,
--   docs/services/company-context-service.md,
--   docs/architecture/people-context-architecture.md, data-architecture.md.
-- ============================================================================

-- --- companies --------------------------------------------------------------
create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  name              text not null,
  relationship_type text not null default 'other'
                    check (relationship_type in ('client','supplier','partner','investor','competitor','prospect','vendor','internal','other')),
  importance_level  text not null default 'normal'
                    check (importance_level in ('critical','high','normal','low')),
  status            text not null default 'active' check (status in ('active','inactive')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index companies_tenant_idx on public.companies (tenant_id, name);
create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- --- company_aliases (dedup / "may refer to the same company") --------------
create table public.company_aliases (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  alias      text not null,
  source     text,
  created_at timestamptz not null default now(),
  unique (company_id, alias)
);
create index company_aliases_company_idx on public.company_aliases (company_id);

-- --- company_domains (the matching anchor: email/source domain → company) ---
create table public.company_domains (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  domain     text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, domain)
);
create index company_domains_company_idx on public.company_domains (company_id);

-- --- company_tags (same behavioural taxonomy as person_tags) ----------------
create table public.company_tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  tag        text not null,
  unique (company_id, tag)
);
create index company_tags_company_idx on public.company_tags (company_id);

-- --- entity_links (graph-ready, explainable edges) --------------------------
-- The canonical relationship edge. Every edge is explainable: it carries a
-- relationship type, confidence, origin (system-suggested vs user-confirmed),
-- an evidence summary, provenance, and first/last-seen timestamps. Suggestions
-- live here as origin='system', status='suggested' — confirmed by the operator,
-- never silently applied (people-context-architecture.md §6).
create table public.entity_links (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  source_entity_type text not null
                     check (source_entity_type in ('person','company','topic','action','decision','diary_entry','briefing','source_item')),
  source_entity_id   uuid not null,
  target_entity_type text not null
                     check (target_entity_type in ('person','company','topic','action','decision','diary_entry','briefing','source_item')),
  target_entity_id   uuid not null,
  relationship_type  text not null,                       -- taxonomy lives in code (people.types.ts RELATIONSHIP_KINDS)
  confidence         numeric(4,3) not null default 0.5,
  origin             text not null default 'user' check (origin in ('system','user')),
  status             text not null default 'confirmed' check (status in ('suggested','confirmed','rejected')),
  evidence_summary   text,                                -- plain-language "why this link was proposed"
  source_reference   text,                                -- pointer to the strongest supporting item
  visibility         text not null default 'normal' check (visibility in ('normal','sensitive','hidden')),
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- One edge of a given type between the same two endpoints (re-observation
  -- updates confidence / last_seen rather than inserting a duplicate).
  unique (tenant_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type)
);
create index entity_links_source_idx on public.entity_links (tenant_id, source_entity_type, source_entity_id);
create index entity_links_target_idx on public.entity_links (tenant_id, target_entity_type, target_entity_id);
create index entity_links_status_idx on public.entity_links (tenant_id, status);
create trigger entity_links_set_updated_at before update on public.entity_links
  for each row execute function public.set_updated_at();

-- --- people.company_id (resolved primary employer) --------------------------
-- The free-text `organisation` stays as the pre-resolution value; a confirmed
-- works_at edge backfills `company_id`. Both can coexist during migration.
alter table public.people add column company_id uuid references public.companies(id) on delete set null;
create index people_company_idx on public.people (company_id);

-- --- suggested_actions: allow people-originated actions ----------------------
-- "Follow-up required" on a person proposes an action with created_from='people'.
alter table public.suggested_actions drop constraint if exists suggested_actions_created_from_check;
alter table public.suggested_actions
  add constraint suggested_actions_created_from_check
    check (created_from in ('manual', 'suggestion', 'diary', 'briefing', 'meeting', 'email', 'people'));

-- --- fix person_identities check drift (slack/discord were in code, not DB) --
alter table public.person_identities drop constraint if exists person_identities_identity_type_check;
alter table public.person_identities
  add constraint person_identities_identity_type_check
    check (identity_type in ('email','phone','whatsapp','teams','github','slack','discord','notion','alias'));

-- ============================================================================
-- Grants
-- ============================================================================
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.company_aliases to authenticated;
grant select, insert, update, delete on table public.company_domains to authenticated;
grant select, insert, update, delete on table public.company_tags to authenticated;
grant select, insert, update, delete on table public.entity_links to authenticated;

grant all on table public.companies to service_role;
grant all on table public.company_aliases to service_role;
grant all on table public.company_domains to service_role;
grant all on table public.company_tags to service_role;
grant all on table public.entity_links to service_role;

-- ============================================================================
-- RLS — tenant isolation on every table
-- ============================================================================
alter table public.companies       enable row level security;
alter table public.company_aliases enable row level security;
alter table public.company_domains enable row level security;
alter table public.company_tags    enable row level security;
alter table public.entity_links    enable row level security;

create policy companies_select on public.companies for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy companies_insert on public.companies for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy companies_update on public.companies for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy companies_delete on public.companies for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy calias_select on public.company_aliases for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy calias_insert on public.company_aliases for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy calias_delete on public.company_aliases for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy cdomain_select on public.company_domains for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy cdomain_insert on public.company_domains for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy cdomain_delete on public.company_domains for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy ctag_select on public.company_tags for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy ctag_insert on public.company_tags for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy ctag_delete on public.company_tags for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy elink_select on public.entity_links for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy elink_insert on public.entity_links for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy elink_update on public.entity_links for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy elink_delete on public.entity_links for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
