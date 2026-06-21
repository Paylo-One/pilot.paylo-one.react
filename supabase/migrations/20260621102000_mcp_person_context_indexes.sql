-- 20260621102000_mcp_person_context_indexes.sql
-- Keep MCP person-context lookups bounded and index-backed.

create index if not exists source_references_person_context_idx
  on public.source_references (tenant_id, person_id, item_timestamp desc)
  where person_id is not null;

create index if not exists suggested_actions_person_context_idx
  on public.suggested_actions (tenant_id, person_id, updated_at desc)
  where person_id is not null;
