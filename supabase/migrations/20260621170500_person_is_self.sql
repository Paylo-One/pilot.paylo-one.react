-- ============================================================================
-- 20260621170500_person_is_self.sql
-- Let the operator mark one person record as themselves ("This is me"). Used to
-- distinguish self in the relationship layer (graph root, correlation, briefing).
-- At most one self per tenant, enforced by a partial unique index.
-- Governance: docs/product/people-and-companies.md, ADR-044.
-- ============================================================================

alter table public.people add column if not exists is_self boolean not null default false;

-- At most one "self" person per tenant.
create unique index if not exists people_one_self_per_tenant
  on public.people (tenant_id)
  where is_self;
