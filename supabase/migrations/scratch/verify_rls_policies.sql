-- ============================================================================
-- Row-Level Security (RLS) and Policy Audit Verification Script
-- Path: /Users/bernardwiller/Projects/paylo_one/app/supabase/migrations/scratch/verify_rls_policies.sql
-- Description: Audits all public tables for RLS enablement, tenant isolation via
--              auth_tenant_ids(), and admin isolation via is_platform_admin().
-- ============================================================================

with public_tables as (
    -- Retrieve all regular user tables from the public schema
    select 
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        exists (
            select 1 
            from information_schema.columns col 
            where col.table_schema = 'public' 
              and col.table_name = c.relname 
              and col.column_name = 'tenant_id'
        ) as has_tenant_id,
        (c.relname = 'tenants') as is_tenants_registry
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' 
      and c.relkind = 'r'
      and c.relname not in ('pg_stat_statements', 'spatial_ref_sys')
),
policies_summary as (
    -- Aggregate security policies defined on public tables
    select 
        tablename as table_name,
        bool_or(qual like '%auth_tenant_ids()%' or with_check like '%auth_tenant_ids()%') as has_tenant_policy,
        bool_or(qual like '%is_platform_admin()%' or with_check like '%is_platform_admin()%') as has_admin_policy,
        bool_or(qual like '%auth.uid()%' or with_check like '%auth.uid()%') as has_user_policy,
        count(*) as policy_count,
        array_agg(policyname) as policy_names
    from pg_policies
    where schemaname = 'public'
    group by tablename
),
audit_base as (
    -- Combine table structural info with defined policies
    select 
        pt.table_name,
        pt.rls_enabled,
        (pt.has_tenant_id or pt.is_tenants_registry) as is_tenant_table,
        -- Admin platform tables defined in admin_foundation.sql
        pt.table_name in (
            'admin_users', 'admin_roles', 'admin_user_roles',
            'catalogue_items', 'catalogue_prices',
            'billing_requests', 'onboarding_requests', 'admin_notes', 'admin_audit_events'
        ) as is_admin_platform_table,
        coalesce(ps.has_tenant_policy, false) as has_tenant_policy,
        coalesce(ps.has_admin_policy, false) as has_admin_policy,
        coalesce(ps.has_user_policy, false) as has_user_policy,
        coalesce(ps.policy_count, 0) as policy_count,
        coalesce(ps.policy_names, '{}'::text[]) as policies
    from public_tables pt
    left join policies_summary ps on ps.table_name = pt.table_name
)
select 
    table_name,
    rls_enabled,
    is_tenant_table,
    is_admin_platform_table,
    policy_count,
    policies,
    case
        when not rls_enabled then 'VIOLATION: RLS Disabled!'
        
        -- Known server-only tables with no policies (restricted to service_role with BYPASSRLS)
        when table_name in (
            'access_requests', 
            'billing_events', 
            'integration_credentials', 
            'tenant_model_providers', 
            'whatsapp_session_material'
        ) and policy_count = 0 then 'SECURE: Server-only (service_role only)'
        
        -- Admin platform table verification
        when is_admin_platform_table then
            case
                when not has_admin_policy then 'VIOLATION: Admin table missing is_platform_admin() policy!'
                else 'SECURE: Admin Isolated via is_platform_admin()'
            end
            
        -- Tenant table verification (including specific exceptions)
        when is_tenant_table then
            case 
                -- Admin-only tenant-scoped tables
                when table_name in ('billing_requests', 'onboarding_requests') 
                    and has_admin_policy then 'SECURE: Admin-Only Tenant Table (is_platform_admin)'
                
                -- User-owned tenant-scoped tables
                when table_name = 'referral_codes' and has_user_policy then 'SECURE: User-Owned Tenant Table (auth.uid)'
                
                -- Standard tenant isolation referencing auth_tenant_ids()
                when has_tenant_policy then 'SECURE: Tenant Isolated via auth_tenant_ids()'
                
                else 'VIOLATION: Tenant table missing auth_tenant_ids() policy!'
            end
            
        -- Non-tenant tables checks
        when table_name in ('user_profiles', 'passkey_credentials', 'legal_acceptances') and has_user_policy then 'SECURE: User Isolated via auth.uid()'
        when table_name = 'referral_usages' and has_user_policy then 'SECURE: User Isolated via auth.uid()'
        when table_name = 'news_provider' and policy_count > 0 then 'SECURE: Lookup/Config Table'
        when table_name = 'subscription_plans' and has_admin_policy then 'SECURE: Catalogue Table with Admin policy'
        when policy_count = 0 then 'WARNING: No policies defined!'
        else 'SECURE: Custom / Other'
    end as audit_status
from audit_base
order by table_name;
