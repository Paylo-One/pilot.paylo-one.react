-- ============================================================================
-- 20260607160003_storage_buckets.sql
-- Private storage buckets + tenant-prefixed object isolation.
-- Object keys are `{tenantId}/{...}`; a user may only read/write objects whose
-- first path segment is a tenant they belong to (multi-tenancy-design.md
-- §"Tenant-Scoped Storage").
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false),
       ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

-- The first folder segment of the object name must be one of the caller's
-- tenant ids. storage.foldername(name) returns the path segments as text[].
create policy "tenant_objects_select" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('uploads', 'voice-notes')
    and ((storage.foldername(name))[1])::uuid in (select public.auth_tenant_ids())
  );

create policy "tenant_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('uploads', 'voice-notes')
    and ((storage.foldername(name))[1])::uuid in (select public.auth_tenant_ids())
  );

create policy "tenant_objects_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('uploads', 'voice-notes')
    and ((storage.foldername(name))[1])::uuid in (select public.auth_tenant_ids())
  )
  with check (
    bucket_id in ('uploads', 'voice-notes')
    and ((storage.foldername(name))[1])::uuid in (select public.auth_tenant_ids())
  );

create policy "tenant_objects_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('uploads', 'voice-notes')
    and ((storage.foldername(name))[1])::uuid in (select public.auth_tenant_ids())
  );
