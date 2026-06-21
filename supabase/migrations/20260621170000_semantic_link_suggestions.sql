-- ============================================================================
-- 20260621170000_semantic_link_suggestions.sql
-- Tenant-scoped semantic embeddings + nearest-neighbour matching for suggested
-- entity_links. Embeddings are a retrieval/index layer only; the explainable,
-- confirmable graph edge remains public.entity_links.
-- ============================================================================

create extension if not exists vector;

create table if not exists public.knowledge_embeddings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  entity_type     text not null
                  check (entity_type in ('person','company','action','diary_entry','source_item')),
  entity_id       uuid not null,
  owner_user_id   uuid references auth.users(id) on delete set null,
  content_hash    text not null,
  embedding_model text not null,
  embedding       vector(1536) not null,
  visibility      text not null default 'normal'
                  check (visibility in ('normal','diary_private','sensitive','hidden')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id, embedding_model)
);

create index if not exists knowledge_embeddings_tenant_entity_idx
  on public.knowledge_embeddings (tenant_id, entity_type, entity_id);

create index if not exists knowledge_embeddings_tenant_visibility_idx
  on public.knowledge_embeddings (tenant_id, visibility);

create index if not exists knowledge_embeddings_embedding_hnsw_idx
  on public.knowledge_embeddings
  using hnsw (embedding vector_cosine_ops);

drop trigger if exists knowledge_embeddings_set_updated_at on public.knowledge_embeddings;
create trigger knowledge_embeddings_set_updated_at before update on public.knowledge_embeddings
  for each row execute function public.set_updated_at();

grant select on table public.knowledge_embeddings to authenticated;
grant all on table public.knowledge_embeddings to service_role;

alter table public.knowledge_embeddings enable row level security;

drop policy if exists kemb_select on public.knowledge_embeddings;
create policy kemb_select on public.knowledge_embeddings
  for select to authenticated
  using (
    tenant_id in (select public.auth_tenant_ids())
    and visibility <> 'hidden'
    and (
      visibility <> 'diary_private'
      or owner_user_id = auth.uid()
    )
  );

-- Server-side semantic matching. Always tenant-filtered; vector indexes do not
-- isolate tenants by themselves.
create or replace function public.match_knowledge_embeddings(
  p_tenant_id uuid,
  p_query_embedding vector(1536),
  p_embedding_model text,
  p_excluded_entity_type text,
  p_excluded_entity_id uuid,
  p_match_count int default 12
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  owner_user_id uuid,
  visibility text,
  content_hash text,
  similarity double precision
)
language sql
stable
as $$
  select
    ke.id,
    ke.entity_type,
    ke.entity_id,
    ke.owner_user_id,
    ke.visibility,
    ke.content_hash,
    1 - (ke.embedding <=> p_query_embedding) as similarity
  from public.knowledge_embeddings ke
  where ke.tenant_id = p_tenant_id
    and ke.embedding_model = p_embedding_model
    and ke.visibility <> 'hidden'
    and not (
      ke.entity_type = p_excluded_entity_type
      and ke.entity_id = p_excluded_entity_id
    )
  order by ke.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 12), 50));
$$;

grant execute on function public.match_knowledge_embeddings(
  uuid,
  vector(1536),
  text,
  text,
  uuid,
  int
) to service_role;
