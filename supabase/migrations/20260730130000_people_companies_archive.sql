-- People & Companies: archive (soft delete) support.
-- Archiving is the default destructive action in the UI; hard delete remains
-- for privileged roles. Mirrors the archived_at pattern used by tenant_prompts
-- and custom_skills (20260612100000, 20260620140000).

alter table public.people add column if not exists archived_at timestamptz;
alter table public.companies add column if not exists archived_at timestamptz;

-- Directory reads filter on (tenant, archived_at is null); keep them indexed.
create index if not exists people_archived_idx on public.people (tenant_id, archived_at);
create index if not exists companies_archived_idx on public.companies (tenant_id, archived_at);
