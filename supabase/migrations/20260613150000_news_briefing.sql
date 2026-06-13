-- ============================================================================
-- 20260613150000_news_briefing.sql
-- Optional, tenant-scoped News Briefing (ADR-039). News is an external-signal
-- source — off by default, per-tenant, relevance-filtered. Items run the
-- standard signal pipeline (fetch → normalise → dedupe → classify → rank →
-- store → brief). Compliance-first: we store title/url/source/timestamp/
-- language/snippet/metadata/classification — NEVER full article bodies unless a
-- provider's terms allow (content_hash supports dedupe without storing text).
--
-- Posture: every table tenant-scoped + RLS. Reads via the authenticated (RLS)
-- client; ingestion writes via the service role with an explicit tenant_id.
-- news_provider is a small PLATFORM registry (not tenant-owned).
-- Governance: ADR-039, architecture/news-briefing-architecture.md.
-- ============================================================================

-- --- news_provider (platform registry) --------------------------------------
create table public.news_provider (
  provider_key text primary key,
  name         text not null,
  tier         text not null check (tier in ('production','development')),
  enabled      boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  docs_url     text,
  created_at   timestamptz not null default now()
);
-- Platform registry: readable by authenticated, writable only by service_role.
grant select on table public.news_provider to authenticated;
grant all on table public.news_provider to service_role;

insert into public.news_provider (provider_key, name, tier, enabled, capabilities, docs_url) values
  ('rss',      'RSS feeds',          'production',  true,
     '{"byCategory":true,"byKeyword":true,"byRegion":false,"bySource":true}'::jsonb, null),
  ('gdelt',    'GDELT 2.0',          'production',  true,
     '{"byCategory":true,"byKeyword":true,"byRegion":true,"bySource":false}'::jsonb, 'https://www.gdeltproject.org/'),
  ('guardian', 'Guardian Open Platform','production', false,
     '{"byCategory":true,"byKeyword":true,"byRegion":false,"bySource":true}'::jsonb, 'https://open-platform.theguardian.com/'),
  ('newsapi',  'NewsAPI.org (dev only)','development', false,
     '{"byCategory":true,"byKeyword":true,"byRegion":true,"bySource":true}'::jsonb, 'https://newsapi.org/'),
  ('newsdata', 'NewsData.io',        'production', false,
     '{"byCategory":true,"byKeyword":true,"byRegion":true,"bySource":true}'::jsonb, 'https://newsdata.io/');

-- --- news_tenant_preferences -------------------------------------------------
create table public.news_tenant_preferences (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  enabled                 boolean not null default false,
  briefing_enabled        boolean not null default false,
  categories              text[]  not null default '{}',
  regions                 text[]  not null default '{}',
  countries               text[]  not null default '{}',
  keywords                text[]  not null default '{}',
  people_to_monitor       text[]  not null default '{}',
  companies_to_monitor    text[]  not null default '{}',
  preferred_sources       text[]  not null default '{}',
  blocked_sources         text[]  not null default '{}',
  languages               text[]  not null default '{en}',
  max_items_per_briefing  int     not null default 5,
  min_relevance_score     numeric(3,2) not null default 0.50,
  include_global_headlines boolean not null default true,
  include_market_news     boolean not null default true,
  include_regulatory_news boolean not null default true,
  include_ai_news         boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id) on delete set null,
  updated_by              uuid references auth.users(id) on delete set null
);
create trigger news_tenant_preferences_set_updated_at
  before update on public.news_tenant_preferences
  for each row execute function public.set_updated_at();

-- --- news_item (normalised, deduplicated) ------------------------------------
create table public.news_item (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  provider_key  text not null references public.news_provider(provider_key),
  external_id   text,
  canonical_url text not null,
  url_hash      text not null,           -- normalised-URL hash; the dedupe key
  title         text not null,
  snippet       text,                    -- summary/snippet only; NEVER full body
  source_name   text not null,
  language      text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  content_hash  text,                    -- optional; dedupe when full text seen
  raw_payload   jsonb,                   -- audit/debug; retained per provider terms
  created_at    timestamptz not null default now(),
  unique (tenant_id, url_hash)
);
create index news_item_tenant_idx on public.news_item (tenant_id, published_at desc);

-- --- news_item_entity --------------------------------------------------------
create table public.news_item_entity (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  news_item_id    uuid not null references public.news_item(id) on delete cascade,
  entity_type     text not null check (entity_type in ('company','person','topic','place')),
  value           text not null,
  matched_monitor boolean not null default false,  -- matched a tenant watch list
  confidence      numeric(3,2) not null default 0.50
);
create index news_item_entity_item_idx on public.news_item_entity (news_item_id);

-- --- news_item_classification ------------------------------------------------
create table public.news_item_classification (
  news_item_id        uuid primary key references public.news_item(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  category            text,
  region              text,
  country             text,
  strategic_relevance numeric(3,2),
  urgency             text check (urgency in ('now','today','this_week','none')),
  risk_level          text check (risk_level in ('high','medium','low','none')),
  sentiment           text check (sentiment in ('positive','neutral','negative')),
  confidence          numeric(3,2),
  topic_tags          text[] not null default '{}',
  method              text not null default 'heuristic' check (method in ('heuristic','llm')),
  created_at          timestamptz not null default now()
);

-- --- news_briefing_item (ranked candidates) ----------------------------------
create table public.news_briefing_item (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  news_item_id          uuid not null references public.news_item(id) on delete cascade,
  relevance_score       numeric(4,3) not null,
  rank_reason           jsonb not null default '{}'::jsonb,  -- factor breakdown → "why included"
  category              text,
  included_in_briefing_id uuid references public.briefings(id) on delete set null,
  shown_at              timestamptz,
  status                text not null default 'candidate'
                          check (status in ('candidate','shown','suppressed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, news_item_id)
);
create index news_briefing_item_rank_idx
  on public.news_briefing_item (tenant_id, status, relevance_score desc);
create trigger news_briefing_item_set_updated_at
  before update on public.news_briefing_item
  for each row execute function public.set_updated_at();

-- --- news_feedback -----------------------------------------------------------
create table public.news_feedback (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  news_item_id uuid references public.news_item(id) on delete set null,
  source_name  text,
  topic        text,
  signal       text not null check (signal in
                 ('more_like_this','less_like_this','hide_source','follow_topic',
                  'unfollow_topic','important','not_relevant')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index news_feedback_tenant_idx on public.news_feedback (tenant_id, created_at desc);

-- --- news_config_audit -------------------------------------------------------
create table public.news_config_audit (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  actor_user_id  uuid references auth.users(id) on delete set null,
  field          text not null,
  previous_value jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);
create index news_config_audit_tenant_idx on public.news_config_audit (tenant_id, created_at desc);

-- --- grants ------------------------------------------------------------------
grant select on table public.news_tenant_preferences  to authenticated;
grant select on table public.news_item                 to authenticated;
grant select on table public.news_item_entity          to authenticated;
grant select on table public.news_item_classification  to authenticated;
grant select on table public.news_briefing_item        to authenticated;
grant select on table public.news_feedback             to authenticated;
grant select on table public.news_config_audit         to authenticated;

grant all on table public.news_tenant_preferences  to service_role;
grant all on table public.news_item                 to service_role;
grant all on table public.news_item_entity          to service_role;
grant all on table public.news_item_classification  to service_role;
grant all on table public.news_briefing_item        to service_role;
grant all on table public.news_feedback             to service_role;
grant all on table public.news_config_audit         to service_role;

-- --- RLS (read = own tenant; all writes are service-role) --------------------
alter table public.news_tenant_preferences  enable row level security;
alter table public.news_item                 enable row level security;
alter table public.news_item_entity          enable row level security;
alter table public.news_item_classification  enable row level security;
alter table public.news_briefing_item        enable row level security;
alter table public.news_feedback             enable row level security;
alter table public.news_config_audit         enable row level security;

create policy news_prefs_select on public.news_tenant_preferences
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_item_select on public.news_item
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_item_entity_select on public.news_item_entity
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_item_classification_select on public.news_item_classification
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_briefing_item_select on public.news_briefing_item
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_feedback_select on public.news_feedback
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy news_config_audit_select on public.news_config_audit
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
