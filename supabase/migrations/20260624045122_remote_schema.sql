drop extension if exists "pg_net";


  create table "public"."passkey_credentials" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "credential_id" text not null,
    "public_key" text not null,
    "transports" text[] not null default '{}'::text[],
    "device_type" text not null default 'single_device'::text,
    "backed_up" boolean not null default false,
    "label" text,
    "sign_count" bigint not null default 0,
    "registered_tenant_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "last_used_at" timestamp with time zone
      );


alter table "public"."passkey_credentials" enable row level security;

CREATE UNIQUE INDEX passkey_credentials_credential_id_key ON public.passkey_credentials USING btree (credential_id);

CREATE UNIQUE INDEX passkey_credentials_pkey ON public.passkey_credentials USING btree (id);

CREATE INDEX passkey_credentials_user_idx ON public.passkey_credentials USING btree (user_id, created_at DESC);

alter table "public"."passkey_credentials" add constraint "passkey_credentials_pkey" PRIMARY KEY using index "passkey_credentials_pkey";

alter table "public"."passkey_credentials" add constraint "passkey_credentials_credential_id_key" UNIQUE using index "passkey_credentials_credential_id_key";

alter table "public"."passkey_credentials" add constraint "passkey_credentials_device_type_check" CHECK ((device_type = ANY (ARRAY['single_device'::text, 'multi_device'::text]))) not valid;

alter table "public"."passkey_credentials" validate constraint "passkey_credentials_device_type_check";

alter table "public"."passkey_credentials" add constraint "passkey_credentials_registered_tenant_id_fkey" FOREIGN KEY (registered_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL not valid;

alter table "public"."passkey_credentials" validate constraint "passkey_credentials_registered_tenant_id_fkey";

alter table "public"."passkey_credentials" add constraint "passkey_credentials_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."passkey_credentials" validate constraint "passkey_credentials_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

grant delete on table "public"."access_requests" to "anon";

grant insert on table "public"."access_requests" to "anon";

grant select on table "public"."access_requests" to "anon";

grant update on table "public"."access_requests" to "anon";

grant delete on table "public"."access_requests" to "authenticated";

grant insert on table "public"."access_requests" to "authenticated";

grant update on table "public"."access_requests" to "authenticated";

grant delete on table "public"."admin_audit_events" to "anon";

grant insert on table "public"."admin_audit_events" to "anon";

grant select on table "public"."admin_audit_events" to "anon";

grant update on table "public"."admin_audit_events" to "anon";

grant delete on table "public"."admin_audit_events" to "authenticated";

grant insert on table "public"."admin_audit_events" to "authenticated";

grant update on table "public"."admin_audit_events" to "authenticated";

grant delete on table "public"."admin_notes" to "anon";

grant insert on table "public"."admin_notes" to "anon";

grant select on table "public"."admin_notes" to "anon";

grant update on table "public"."admin_notes" to "anon";

grant delete on table "public"."admin_notes" to "authenticated";

grant insert on table "public"."admin_notes" to "authenticated";

grant update on table "public"."admin_notes" to "authenticated";

grant delete on table "public"."admin_roles" to "anon";

grant insert on table "public"."admin_roles" to "anon";

grant select on table "public"."admin_roles" to "anon";

grant update on table "public"."admin_roles" to "anon";

grant delete on table "public"."admin_roles" to "authenticated";

grant insert on table "public"."admin_roles" to "authenticated";

grant update on table "public"."admin_roles" to "authenticated";

grant delete on table "public"."admin_user_roles" to "anon";

grant insert on table "public"."admin_user_roles" to "anon";

grant select on table "public"."admin_user_roles" to "anon";

grant update on table "public"."admin_user_roles" to "anon";

grant delete on table "public"."admin_user_roles" to "authenticated";

grant insert on table "public"."admin_user_roles" to "authenticated";

grant update on table "public"."admin_user_roles" to "authenticated";

grant delete on table "public"."admin_users" to "anon";

grant insert on table "public"."admin_users" to "anon";

grant select on table "public"."admin_users" to "anon";

grant update on table "public"."admin_users" to "anon";

grant delete on table "public"."admin_users" to "authenticated";

grant insert on table "public"."admin_users" to "authenticated";

grant update on table "public"."admin_users" to "authenticated";

grant delete on table "public"."audit_events" to "anon";

grant insert on table "public"."audit_events" to "anon";

grant select on table "public"."audit_events" to "anon";

grant update on table "public"."audit_events" to "anon";

grant delete on table "public"."audit_events" to "authenticated";

grant insert on table "public"."audit_events" to "authenticated";

grant update on table "public"."audit_events" to "authenticated";

grant delete on table "public"."beta_invitations" to "anon";

grant insert on table "public"."beta_invitations" to "anon";

grant select on table "public"."beta_invitations" to "anon";

grant update on table "public"."beta_invitations" to "anon";

grant delete on table "public"."beta_invitations" to "authenticated";

grant insert on table "public"."beta_invitations" to "authenticated";

grant update on table "public"."beta_invitations" to "authenticated";

grant delete on table "public"."billing_access" to "anon";

grant insert on table "public"."billing_access" to "anon";

grant select on table "public"."billing_access" to "anon";

grant update on table "public"."billing_access" to "anon";

grant delete on table "public"."billing_access" to "authenticated";

grant insert on table "public"."billing_access" to "authenticated";

grant update on table "public"."billing_access" to "authenticated";

grant delete on table "public"."billing_admin_notes" to "anon";

grant insert on table "public"."billing_admin_notes" to "anon";

grant select on table "public"."billing_admin_notes" to "anon";

grant update on table "public"."billing_admin_notes" to "anon";

grant delete on table "public"."billing_admin_notes" to "authenticated";

grant insert on table "public"."billing_admin_notes" to "authenticated";

grant update on table "public"."billing_admin_notes" to "authenticated";

grant delete on table "public"."billing_audit_log" to "anon";

grant insert on table "public"."billing_audit_log" to "anon";

grant select on table "public"."billing_audit_log" to "anon";

grant update on table "public"."billing_audit_log" to "anon";

grant delete on table "public"."billing_audit_log" to "authenticated";

grant insert on table "public"."billing_audit_log" to "authenticated";

grant update on table "public"."billing_audit_log" to "authenticated";

grant delete on table "public"."billing_customers" to "anon";

grant insert on table "public"."billing_customers" to "anon";

grant select on table "public"."billing_customers" to "anon";

grant update on table "public"."billing_customers" to "anon";

grant delete on table "public"."billing_customers" to "authenticated";

grant insert on table "public"."billing_customers" to "authenticated";

grant update on table "public"."billing_customers" to "authenticated";

grant delete on table "public"."billing_events" to "anon";

grant insert on table "public"."billing_events" to "anon";

grant select on table "public"."billing_events" to "anon";

grant update on table "public"."billing_events" to "anon";

grant delete on table "public"."billing_events" to "authenticated";

grant insert on table "public"."billing_events" to "authenticated";

grant select on table "public"."billing_events" to "authenticated";

grant update on table "public"."billing_events" to "authenticated";

grant delete on table "public"."billing_requests" to "anon";

grant insert on table "public"."billing_requests" to "anon";

grant select on table "public"."billing_requests" to "anon";

grant update on table "public"."billing_requests" to "anon";

grant delete on table "public"."billing_requests" to "authenticated";

grant insert on table "public"."billing_requests" to "authenticated";

grant update on table "public"."billing_requests" to "authenticated";

grant delete on table "public"."billing_subscriptions" to "anon";

grant insert on table "public"."billing_subscriptions" to "anon";

grant select on table "public"."billing_subscriptions" to "anon";

grant update on table "public"."billing_subscriptions" to "anon";

grant delete on table "public"."billing_subscriptions" to "authenticated";

grant insert on table "public"."billing_subscriptions" to "authenticated";

grant update on table "public"."billing_subscriptions" to "authenticated";

grant delete on table "public"."briefing_sections" to "anon";

grant insert on table "public"."briefing_sections" to "anon";

grant select on table "public"."briefing_sections" to "anon";

grant update on table "public"."briefing_sections" to "anon";

grant delete on table "public"."briefing_sections" to "authenticated";

grant insert on table "public"."briefing_sections" to "authenticated";

grant update on table "public"."briefing_sections" to "authenticated";

grant delete on table "public"."briefings" to "anon";

grant insert on table "public"."briefings" to "anon";

grant select on table "public"."briefings" to "anon";

grant update on table "public"."briefings" to "anon";

grant delete on table "public"."briefings" to "authenticated";

grant insert on table "public"."briefings" to "authenticated";

grant update on table "public"."briefings" to "authenticated";

grant delete on table "public"."catalogue_items" to "anon";

grant insert on table "public"."catalogue_items" to "anon";

grant update on table "public"."catalogue_items" to "anon";

grant delete on table "public"."catalogue_items" to "authenticated";

grant insert on table "public"."catalogue_items" to "authenticated";

grant update on table "public"."catalogue_items" to "authenticated";

grant delete on table "public"."catalogue_prices" to "anon";

grant insert on table "public"."catalogue_prices" to "anon";

grant update on table "public"."catalogue_prices" to "anon";

grant delete on table "public"."catalogue_prices" to "authenticated";

grant insert on table "public"."catalogue_prices" to "authenticated";

grant update on table "public"."catalogue_prices" to "authenticated";

grant delete on table "public"."companies" to "anon";

grant insert on table "public"."companies" to "anon";

grant select on table "public"."companies" to "anon";

grant update on table "public"."companies" to "anon";

grant delete on table "public"."company_aliases" to "anon";

grant insert on table "public"."company_aliases" to "anon";

grant select on table "public"."company_aliases" to "anon";

grant update on table "public"."company_aliases" to "anon";

grant delete on table "public"."company_domains" to "anon";

grant insert on table "public"."company_domains" to "anon";

grant select on table "public"."company_domains" to "anon";

grant update on table "public"."company_domains" to "anon";

grant delete on table "public"."company_tags" to "anon";

grant insert on table "public"."company_tags" to "anon";

grant select on table "public"."company_tags" to "anon";

grant update on table "public"."company_tags" to "anon";

grant delete on table "public"."content_summaries" to "anon";

grant insert on table "public"."content_summaries" to "anon";

grant select on table "public"."content_summaries" to "anon";

grant update on table "public"."content_summaries" to "anon";

grant delete on table "public"."content_summaries" to "authenticated";

grant insert on table "public"."content_summaries" to "authenticated";

grant update on table "public"."content_summaries" to "authenticated";

grant delete on table "public"."correlation_feedback" to "anon";

grant insert on table "public"."correlation_feedback" to "anon";

grant select on table "public"."correlation_feedback" to "anon";

grant update on table "public"."correlation_feedback" to "anon";

grant delete on table "public"."correlation_feedback" to "authenticated";

grant update on table "public"."correlation_feedback" to "authenticated";

grant delete on table "public"."custom_skill_versions" to "anon";

grant insert on table "public"."custom_skill_versions" to "anon";

grant select on table "public"."custom_skill_versions" to "anon";

grant update on table "public"."custom_skill_versions" to "anon";

grant delete on table "public"."custom_skill_versions" to "authenticated";

grant insert on table "public"."custom_skill_versions" to "authenticated";

grant update on table "public"."custom_skill_versions" to "authenticated";

grant delete on table "public"."custom_skills" to "anon";

grant insert on table "public"."custom_skills" to "anon";

grant select on table "public"."custom_skills" to "anon";

grant update on table "public"."custom_skills" to "anon";

grant delete on table "public"."custom_skills" to "authenticated";

grant insert on table "public"."custom_skills" to "authenticated";

grant update on table "public"."custom_skills" to "authenticated";

grant delete on table "public"."decisions" to "anon";

grant insert on table "public"."decisions" to "anon";

grant select on table "public"."decisions" to "anon";

grant update on table "public"."decisions" to "anon";

grant delete on table "public"."decisions" to "authenticated";

grant insert on table "public"."decisions" to "authenticated";

grant update on table "public"."decisions" to "authenticated";

grant delete on table "public"."diary_entries" to "anon";

grant insert on table "public"."diary_entries" to "anon";

grant select on table "public"."diary_entries" to "anon";

grant update on table "public"."diary_entries" to "anon";

grant delete on table "public"."diary_weekly_summaries" to "anon";

grant insert on table "public"."diary_weekly_summaries" to "anon";

grant select on table "public"."diary_weekly_summaries" to "anon";

grant update on table "public"."diary_weekly_summaries" to "anon";

grant delete on table "public"."entity_links" to "anon";

grant insert on table "public"."entity_links" to "anon";

grant select on table "public"."entity_links" to "anon";

grant update on table "public"."entity_links" to "anon";

grant delete on table "public"."entity_topics" to "anon";

grant insert on table "public"."entity_topics" to "anon";

grant select on table "public"."entity_topics" to "anon";

grant update on table "public"."entity_topics" to "anon";

grant delete on table "public"."entity_topics" to "authenticated";

grant insert on table "public"."entity_topics" to "authenticated";

grant update on table "public"."entity_topics" to "authenticated";

grant delete on table "public"."github_repository_monitors" to "anon";

grant insert on table "public"."github_repository_monitors" to "anon";

grant select on table "public"."github_repository_monitors" to "anon";

grant update on table "public"."github_repository_monitors" to "anon";

grant delete on table "public"."integration_credentials" to "anon";

grant insert on table "public"."integration_credentials" to "anon";

grant select on table "public"."integration_credentials" to "anon";

grant update on table "public"."integration_credentials" to "anon";

grant delete on table "public"."integration_credentials" to "authenticated";

grant insert on table "public"."integration_credentials" to "authenticated";

grant select on table "public"."integration_credentials" to "authenticated";

grant update on table "public"."integration_credentials" to "authenticated";

grant delete on table "public"."knowledge_embeddings" to "anon";

grant insert on table "public"."knowledge_embeddings" to "anon";

grant select on table "public"."knowledge_embeddings" to "anon";

grant update on table "public"."knowledge_embeddings" to "anon";

grant delete on table "public"."knowledge_embeddings" to "authenticated";

grant insert on table "public"."knowledge_embeddings" to "authenticated";

grant update on table "public"."knowledge_embeddings" to "authenticated";

grant delete on table "public"."legal_acceptances" to "anon";

grant insert on table "public"."legal_acceptances" to "anon";

grant select on table "public"."legal_acceptances" to "anon";

grant update on table "public"."legal_acceptances" to "anon";

grant delete on table "public"."legal_acceptances" to "authenticated";

grant insert on table "public"."legal_acceptances" to "authenticated";

grant update on table "public"."legal_acceptances" to "authenticated";

grant delete on table "public"."manager_manifesto" to "anon";

grant insert on table "public"."manager_manifesto" to "anon";

grant select on table "public"."manager_manifesto" to "anon";

grant update on table "public"."manager_manifesto" to "anon";

grant delete on table "public"."manager_manifesto" to "authenticated";

grant insert on table "public"."manager_manifesto" to "authenticated";

grant update on table "public"."manager_manifesto" to "authenticated";

grant delete on table "public"."manifesto_versions" to "anon";

grant insert on table "public"."manifesto_versions" to "anon";

grant select on table "public"."manifesto_versions" to "anon";

grant update on table "public"."manifesto_versions" to "anon";

grant delete on table "public"."manifesto_versions" to "authenticated";

grant insert on table "public"."manifesto_versions" to "authenticated";

grant update on table "public"."manifesto_versions" to "authenticated";

grant delete on table "public"."mcp_audit_events" to "anon";

grant insert on table "public"."mcp_audit_events" to "anon";

grant select on table "public"."mcp_audit_events" to "anon";

grant update on table "public"."mcp_audit_events" to "anon";

grant delete on table "public"."mcp_audit_events" to "authenticated";

grant insert on table "public"."mcp_audit_events" to "authenticated";

grant update on table "public"."mcp_audit_events" to "authenticated";

grant delete on table "public"."mcp_oauth_access_tokens" to "anon";

grant insert on table "public"."mcp_oauth_access_tokens" to "anon";

grant select on table "public"."mcp_oauth_access_tokens" to "anon";

grant update on table "public"."mcp_oauth_access_tokens" to "anon";

grant delete on table "public"."mcp_oauth_access_tokens" to "authenticated";

grant insert on table "public"."mcp_oauth_access_tokens" to "authenticated";

grant select on table "public"."mcp_oauth_access_tokens" to "authenticated";

grant update on table "public"."mcp_oauth_access_tokens" to "authenticated";

grant delete on table "public"."mcp_oauth_authorization_codes" to "anon";

grant insert on table "public"."mcp_oauth_authorization_codes" to "anon";

grant select on table "public"."mcp_oauth_authorization_codes" to "anon";

grant update on table "public"."mcp_oauth_authorization_codes" to "anon";

grant delete on table "public"."mcp_oauth_authorization_codes" to "authenticated";

grant insert on table "public"."mcp_oauth_authorization_codes" to "authenticated";

grant select on table "public"."mcp_oauth_authorization_codes" to "authenticated";

grant update on table "public"."mcp_oauth_authorization_codes" to "authenticated";

grant delete on table "public"."mcp_oauth_clients" to "anon";

grant insert on table "public"."mcp_oauth_clients" to "anon";

grant select on table "public"."mcp_oauth_clients" to "anon";

grant update on table "public"."mcp_oauth_clients" to "anon";

grant delete on table "public"."mcp_oauth_clients" to "authenticated";

grant insert on table "public"."mcp_oauth_clients" to "authenticated";

grant update on table "public"."mcp_oauth_clients" to "authenticated";

grant delete on table "public"."mcp_oauth_grants" to "anon";

grant insert on table "public"."mcp_oauth_grants" to "anon";

grant select on table "public"."mcp_oauth_grants" to "anon";

grant update on table "public"."mcp_oauth_grants" to "anon";

grant delete on table "public"."mcp_oauth_grants" to "authenticated";

grant insert on table "public"."mcp_oauth_grants" to "authenticated";

grant update on table "public"."mcp_oauth_grants" to "authenticated";

grant delete on table "public"."memo_preferences" to "anon";

grant insert on table "public"."memo_preferences" to "anon";

grant select on table "public"."memo_preferences" to "anon";

grant update on table "public"."memo_preferences" to "anon";

grant delete on table "public"."model_usage" to "anon";

grant insert on table "public"."model_usage" to "anon";

grant select on table "public"."model_usage" to "anon";

grant update on table "public"."model_usage" to "anon";

grant delete on table "public"."model_usage" to "authenticated";

grant insert on table "public"."model_usage" to "authenticated";

grant update on table "public"."model_usage" to "authenticated";

grant delete on table "public"."news_briefing_item" to "anon";

grant insert on table "public"."news_briefing_item" to "anon";

grant select on table "public"."news_briefing_item" to "anon";

grant update on table "public"."news_briefing_item" to "anon";

grant delete on table "public"."news_briefing_item" to "authenticated";

grant insert on table "public"."news_briefing_item" to "authenticated";

grant update on table "public"."news_briefing_item" to "authenticated";

grant delete on table "public"."news_config_audit" to "anon";

grant insert on table "public"."news_config_audit" to "anon";

grant select on table "public"."news_config_audit" to "anon";

grant update on table "public"."news_config_audit" to "anon";

grant delete on table "public"."news_config_audit" to "authenticated";

grant insert on table "public"."news_config_audit" to "authenticated";

grant update on table "public"."news_config_audit" to "authenticated";

grant delete on table "public"."news_feedback" to "anon";

grant insert on table "public"."news_feedback" to "anon";

grant select on table "public"."news_feedback" to "anon";

grant update on table "public"."news_feedback" to "anon";

grant delete on table "public"."news_feedback" to "authenticated";

grant insert on table "public"."news_feedback" to "authenticated";

grant update on table "public"."news_feedback" to "authenticated";

grant delete on table "public"."news_ingestion_run" to "anon";

grant insert on table "public"."news_ingestion_run" to "anon";

grant select on table "public"."news_ingestion_run" to "anon";

grant update on table "public"."news_ingestion_run" to "anon";

grant delete on table "public"."news_ingestion_run" to "authenticated";

grant insert on table "public"."news_ingestion_run" to "authenticated";

grant update on table "public"."news_ingestion_run" to "authenticated";

grant delete on table "public"."news_item" to "anon";

grant insert on table "public"."news_item" to "anon";

grant select on table "public"."news_item" to "anon";

grant update on table "public"."news_item" to "anon";

grant delete on table "public"."news_item" to "authenticated";

grant insert on table "public"."news_item" to "authenticated";

grant update on table "public"."news_item" to "authenticated";

grant delete on table "public"."news_item_classification" to "anon";

grant insert on table "public"."news_item_classification" to "anon";

grant select on table "public"."news_item_classification" to "anon";

grant update on table "public"."news_item_classification" to "anon";

grant delete on table "public"."news_item_classification" to "authenticated";

grant insert on table "public"."news_item_classification" to "authenticated";

grant update on table "public"."news_item_classification" to "authenticated";

grant delete on table "public"."news_item_entity" to "anon";

grant insert on table "public"."news_item_entity" to "anon";

grant select on table "public"."news_item_entity" to "anon";

grant update on table "public"."news_item_entity" to "anon";

grant delete on table "public"."news_item_entity" to "authenticated";

grant insert on table "public"."news_item_entity" to "authenticated";

grant update on table "public"."news_item_entity" to "authenticated";

grant delete on table "public"."news_provider" to "anon";

grant insert on table "public"."news_provider" to "anon";

grant select on table "public"."news_provider" to "anon";

grant update on table "public"."news_provider" to "anon";

grant delete on table "public"."news_provider" to "authenticated";

grant insert on table "public"."news_provider" to "authenticated";

grant update on table "public"."news_provider" to "authenticated";

grant delete on table "public"."news_source_config" to "anon";

grant insert on table "public"."news_source_config" to "anon";

grant select on table "public"."news_source_config" to "anon";

grant update on table "public"."news_source_config" to "anon";

grant delete on table "public"."news_source_config" to "authenticated";

grant insert on table "public"."news_source_config" to "authenticated";

grant update on table "public"."news_source_config" to "authenticated";

grant delete on table "public"."news_tenant_preferences" to "anon";

grant insert on table "public"."news_tenant_preferences" to "anon";

grant select on table "public"."news_tenant_preferences" to "anon";

grant update on table "public"."news_tenant_preferences" to "anon";

grant delete on table "public"."news_tenant_preferences" to "authenticated";

grant insert on table "public"."news_tenant_preferences" to "authenticated";

grant update on table "public"."news_tenant_preferences" to "authenticated";

grant delete on table "public"."notion_resources" to "anon";

grant insert on table "public"."notion_resources" to "anon";

grant select on table "public"."notion_resources" to "anon";

grant update on table "public"."notion_resources" to "anon";

grant delete on table "public"."onboarding_requests" to "anon";

grant insert on table "public"."onboarding_requests" to "anon";

grant select on table "public"."onboarding_requests" to "anon";

grant update on table "public"."onboarding_requests" to "anon";

grant delete on table "public"."onboarding_requests" to "authenticated";

grant insert on table "public"."onboarding_requests" to "authenticated";

grant update on table "public"."onboarding_requests" to "authenticated";

grant delete on table "public"."operating_reviews" to "anon";

grant insert on table "public"."operating_reviews" to "anon";

grant select on table "public"."operating_reviews" to "anon";

grant update on table "public"."operating_reviews" to "anon";

grant delete on table "public"."operating_reviews" to "authenticated";

grant insert on table "public"."operating_reviews" to "authenticated";

grant update on table "public"."operating_reviews" to "authenticated";

grant delete on table "public"."passkey_credentials" to "anon";

grant insert on table "public"."passkey_credentials" to "anon";

grant references on table "public"."passkey_credentials" to "anon";

grant select on table "public"."passkey_credentials" to "anon";

grant trigger on table "public"."passkey_credentials" to "anon";

grant truncate on table "public"."passkey_credentials" to "anon";

grant update on table "public"."passkey_credentials" to "anon";

grant delete on table "public"."passkey_credentials" to "authenticated";

grant insert on table "public"."passkey_credentials" to "authenticated";

grant references on table "public"."passkey_credentials" to "authenticated";

grant select on table "public"."passkey_credentials" to "authenticated";

grant trigger on table "public"."passkey_credentials" to "authenticated";

grant truncate on table "public"."passkey_credentials" to "authenticated";

grant update on table "public"."passkey_credentials" to "authenticated";

grant delete on table "public"."passkey_credentials" to "service_role";

grant insert on table "public"."passkey_credentials" to "service_role";

grant references on table "public"."passkey_credentials" to "service_role";

grant select on table "public"."passkey_credentials" to "service_role";

grant trigger on table "public"."passkey_credentials" to "service_role";

grant truncate on table "public"."passkey_credentials" to "service_role";

grant update on table "public"."passkey_credentials" to "service_role";

grant delete on table "public"."people" to "anon";

grant insert on table "public"."people" to "anon";

grant select on table "public"."people" to "anon";

grant update on table "public"."people" to "anon";

grant delete on table "public"."person_aliases" to "anon";

grant insert on table "public"."person_aliases" to "anon";

grant select on table "public"."person_aliases" to "anon";

grant update on table "public"."person_aliases" to "anon";

grant delete on table "public"."person_identities" to "anon";

grant insert on table "public"."person_identities" to "anon";

grant select on table "public"."person_identities" to "anon";

grant update on table "public"."person_identities" to "anon";

grant delete on table "public"."person_link_suggestions" to "anon";

grant insert on table "public"."person_link_suggestions" to "anon";

grant select on table "public"."person_link_suggestions" to "anon";

grant update on table "public"."person_link_suggestions" to "anon";

grant delete on table "public"."person_merge_events" to "anon";

grant insert on table "public"."person_merge_events" to "anon";

grant select on table "public"."person_merge_events" to "anon";

grant update on table "public"."person_merge_events" to "anon";

grant delete on table "public"."person_merge_events" to "authenticated";

grant update on table "public"."person_merge_events" to "authenticated";

grant delete on table "public"."person_notes" to "anon";

grant insert on table "public"."person_notes" to "anon";

grant select on table "public"."person_notes" to "anon";

grant update on table "public"."person_notes" to "anon";

grant delete on table "public"."person_relationships" to "anon";

grant insert on table "public"."person_relationships" to "anon";

grant select on table "public"."person_relationships" to "anon";

grant update on table "public"."person_relationships" to "anon";

grant delete on table "public"."person_tags" to "anon";

grant insert on table "public"."person_tags" to "anon";

grant select on table "public"."person_tags" to "anon";

grant update on table "public"."person_tags" to "anon";

grant delete on table "public"."prompt_skill_links" to "anon";

grant insert on table "public"."prompt_skill_links" to "anon";

grant select on table "public"."prompt_skill_links" to "anon";

grant update on table "public"."prompt_skill_links" to "anon";

grant delete on table "public"."prompt_skill_links" to "authenticated";

grant insert on table "public"."prompt_skill_links" to "authenticated";

grant update on table "public"."prompt_skill_links" to "authenticated";

grant delete on table "public"."prompt_test_runs" to "anon";

grant insert on table "public"."prompt_test_runs" to "anon";

grant select on table "public"."prompt_test_runs" to "anon";

grant update on table "public"."prompt_test_runs" to "anon";

grant delete on table "public"."prompt_test_runs" to "authenticated";

grant insert on table "public"."prompt_test_runs" to "authenticated";

grant update on table "public"."prompt_test_runs" to "authenticated";

grant delete on table "public"."prompt_versions" to "anon";

grant insert on table "public"."prompt_versions" to "anon";

grant select on table "public"."prompt_versions" to "anon";

grant update on table "public"."prompt_versions" to "anon";

grant delete on table "public"."prompt_versions" to "authenticated";

grant insert on table "public"."prompt_versions" to "authenticated";

grant update on table "public"."prompt_versions" to "authenticated";

grant delete on table "public"."referral_allocation_events" to "anon";

grant insert on table "public"."referral_allocation_events" to "anon";

grant select on table "public"."referral_allocation_events" to "anon";

grant update on table "public"."referral_allocation_events" to "anon";

grant delete on table "public"."referral_allocation_events" to "authenticated";

grant insert on table "public"."referral_allocation_events" to "authenticated";

grant select on table "public"."referral_allocation_events" to "authenticated";

grant update on table "public"."referral_allocation_events" to "authenticated";

grant delete on table "public"."referral_codes" to "anon";

grant insert on table "public"."referral_codes" to "anon";

grant select on table "public"."referral_codes" to "anon";

grant update on table "public"."referral_codes" to "anon";

grant delete on table "public"."referral_codes" to "authenticated";

grant insert on table "public"."referral_codes" to "authenticated";

grant update on table "public"."referral_codes" to "authenticated";

grant delete on table "public"."referral_usages" to "anon";

grant insert on table "public"."referral_usages" to "anon";

grant select on table "public"."referral_usages" to "anon";

grant update on table "public"."referral_usages" to "anon";

grant delete on table "public"."referral_usages" to "authenticated";

grant insert on table "public"."referral_usages" to "authenticated";

grant update on table "public"."referral_usages" to "authenticated";

grant delete on table "public"."refinement_rules" to "anon";

grant insert on table "public"."refinement_rules" to "anon";

grant select on table "public"."refinement_rules" to "anon";

grant update on table "public"."refinement_rules" to "anon";

grant delete on table "public"."risks" to "anon";

grant insert on table "public"."risks" to "anon";

grant select on table "public"."risks" to "anon";

grant update on table "public"."risks" to "anon";

grant delete on table "public"."risks" to "authenticated";

grant insert on table "public"."risks" to "authenticated";

grant update on table "public"."risks" to "authenticated";

grant delete on table "public"."scheduled_sync_runs" to "anon";

grant insert on table "public"."scheduled_sync_runs" to "anon";

grant select on table "public"."scheduled_sync_runs" to "anon";

grant update on table "public"."scheduled_sync_runs" to "anon";

grant delete on table "public"."scheduled_sync_runs" to "authenticated";

grant insert on table "public"."scheduled_sync_runs" to "authenticated";

grant update on table "public"."scheduled_sync_runs" to "authenticated";

grant delete on table "public"."signal_groups" to "anon";

grant insert on table "public"."signal_groups" to "anon";

grant select on table "public"."signal_groups" to "anon";

grant update on table "public"."signal_groups" to "anon";

grant delete on table "public"."signal_groups" to "authenticated";

grant insert on table "public"."signal_groups" to "authenticated";

grant update on table "public"."signal_groups" to "authenticated";

grant delete on table "public"."signals" to "anon";

grant insert on table "public"."signals" to "anon";

grant select on table "public"."signals" to "anon";

grant update on table "public"."signals" to "anon";

grant delete on table "public"."signals" to "authenticated";

grant insert on table "public"."signals" to "authenticated";

grant update on table "public"."signals" to "authenticated";

grant delete on table "public"."source_connections" to "anon";

grant insert on table "public"."source_connections" to "anon";

grant select on table "public"."source_connections" to "anon";

grant update on table "public"."source_connections" to "anon";

grant delete on table "public"."source_items" to "anon";

grant insert on table "public"."source_items" to "anon";

grant select on table "public"."source_items" to "anon";

grant update on table "public"."source_items" to "anon";

grant delete on table "public"."source_items" to "authenticated";

grant insert on table "public"."source_items" to "authenticated";

grant update on table "public"."source_items" to "authenticated";

grant delete on table "public"."source_references" to "anon";

grant insert on table "public"."source_references" to "anon";

grant select on table "public"."source_references" to "anon";

grant update on table "public"."source_references" to "anon";

grant delete on table "public"."source_references" to "authenticated";

grant insert on table "public"."source_references" to "authenticated";

grant update on table "public"."source_references" to "authenticated";

grant delete on table "public"."source_scope_items" to "anon";

grant insert on table "public"."source_scope_items" to "anon";

grant select on table "public"."source_scope_items" to "anon";

grant update on table "public"."source_scope_items" to "anon";

grant delete on table "public"."subscription_discounts" to "anon";

grant insert on table "public"."subscription_discounts" to "anon";

grant select on table "public"."subscription_discounts" to "anon";

grant update on table "public"."subscription_discounts" to "anon";

grant delete on table "public"."subscription_discounts" to "authenticated";

grant insert on table "public"."subscription_discounts" to "authenticated";

grant update on table "public"."subscription_discounts" to "authenticated";

grant delete on table "public"."subscription_plans" to "anon";

grant insert on table "public"."subscription_plans" to "anon";

grant update on table "public"."subscription_plans" to "anon";

grant delete on table "public"."subscription_plans" to "authenticated";

grant insert on table "public"."subscription_plans" to "authenticated";

grant update on table "public"."subscription_plans" to "authenticated";

grant delete on table "public"."suggested_actions" to "anon";

grant insert on table "public"."suggested_actions" to "anon";

grant select on table "public"."suggested_actions" to "anon";

grant update on table "public"."suggested_actions" to "anon";

grant delete on table "public"."tenant_activation_invitations" to "anon";

grant insert on table "public"."tenant_activation_invitations" to "anon";

grant select on table "public"."tenant_activation_invitations" to "anon";

grant update on table "public"."tenant_activation_invitations" to "anon";

grant delete on table "public"."tenant_activation_invitations" to "authenticated";

grant insert on table "public"."tenant_activation_invitations" to "authenticated";

grant update on table "public"."tenant_activation_invitations" to "authenticated";

grant delete on table "public"."tenant_domains" to "anon";

grant insert on table "public"."tenant_domains" to "anon";

grant select on table "public"."tenant_domains" to "anon";

grant update on table "public"."tenant_domains" to "anon";

grant delete on table "public"."tenant_domains" to "authenticated";

grant insert on table "public"."tenant_domains" to "authenticated";

grant update on table "public"."tenant_domains" to "authenticated";

grant delete on table "public"."tenant_entitlement_overrides" to "anon";

grant insert on table "public"."tenant_entitlement_overrides" to "anon";

grant select on table "public"."tenant_entitlement_overrides" to "anon";

grant update on table "public"."tenant_entitlement_overrides" to "anon";

grant delete on table "public"."tenant_entitlement_overrides" to "authenticated";

grant insert on table "public"."tenant_entitlement_overrides" to "authenticated";

grant update on table "public"."tenant_entitlement_overrides" to "authenticated";

grant delete on table "public"."tenant_model_providers" to "anon";

grant insert on table "public"."tenant_model_providers" to "anon";

grant select on table "public"."tenant_model_providers" to "anon";

grant update on table "public"."tenant_model_providers" to "anon";

grant delete on table "public"."tenant_model_providers" to "authenticated";

grant insert on table "public"."tenant_model_providers" to "authenticated";

grant select on table "public"."tenant_model_providers" to "authenticated";

grant update on table "public"."tenant_model_providers" to "authenticated";

grant delete on table "public"."tenant_prompts" to "anon";

grant insert on table "public"."tenant_prompts" to "anon";

grant select on table "public"."tenant_prompts" to "anon";

grant update on table "public"."tenant_prompts" to "anon";

grant delete on table "public"."tenant_prompts" to "authenticated";

grant insert on table "public"."tenant_prompts" to "authenticated";

grant update on table "public"."tenant_prompts" to "authenticated";

grant delete on table "public"."tenant_subscriptions" to "anon";

grant insert on table "public"."tenant_subscriptions" to "anon";

grant select on table "public"."tenant_subscriptions" to "anon";

grant update on table "public"."tenant_subscriptions" to "anon";

grant delete on table "public"."tenant_subscriptions" to "authenticated";

grant insert on table "public"."tenant_subscriptions" to "authenticated";

grant update on table "public"."tenant_subscriptions" to "authenticated";

grant delete on table "public"."tenant_users" to "anon";

grant insert on table "public"."tenant_users" to "anon";

grant select on table "public"."tenant_users" to "anon";

grant update on table "public"."tenant_users" to "anon";

grant delete on table "public"."tenant_users" to "authenticated";

grant insert on table "public"."tenant_users" to "authenticated";

grant update on table "public"."tenant_users" to "authenticated";

grant delete on table "public"."tenants" to "anon";

grant insert on table "public"."tenants" to "anon";

grant select on table "public"."tenants" to "anon";

grant update on table "public"."tenants" to "anon";

grant delete on table "public"."tenants" to "authenticated";

grant insert on table "public"."tenants" to "authenticated";

grant update on table "public"."tenants" to "authenticated";

grant delete on table "public"."topics" to "anon";

grant insert on table "public"."topics" to "anon";

grant select on table "public"."topics" to "anon";

grant update on table "public"."topics" to "anon";

grant delete on table "public"."topics" to "authenticated";

grant insert on table "public"."topics" to "authenticated";

grant update on table "public"."topics" to "authenticated";

grant delete on table "public"."triage_preferences" to "anon";

grant insert on table "public"."triage_preferences" to "anon";

grant select on table "public"."triage_preferences" to "anon";

grant update on table "public"."triage_preferences" to "anon";

grant delete on table "public"."usage_counters" to "anon";

grant insert on table "public"."usage_counters" to "anon";

grant select on table "public"."usage_counters" to "anon";

grant update on table "public"."usage_counters" to "anon";

grant delete on table "public"."usage_counters" to "authenticated";

grant insert on table "public"."usage_counters" to "authenticated";

grant update on table "public"."usage_counters" to "authenticated";

grant delete on table "public"."user_feedback_events" to "anon";

grant insert on table "public"."user_feedback_events" to "anon";

grant select on table "public"."user_feedback_events" to "anon";

grant update on table "public"."user_feedback_events" to "anon";

grant delete on table "public"."user_feedback_events" to "authenticated";

grant update on table "public"."user_feedback_events" to "authenticated";

grant delete on table "public"."user_profiles" to "anon";

grant insert on table "public"."user_profiles" to "anon";

grant select on table "public"."user_profiles" to "anon";

grant update on table "public"."user_profiles" to "anon";

grant delete on table "public"."user_profiles" to "authenticated";

grant delete on table "public"."whatsapp_chats" to "anon";

grant insert on table "public"."whatsapp_chats" to "anon";

grant select on table "public"."whatsapp_chats" to "anon";

grant update on table "public"."whatsapp_chats" to "anon";

grant delete on table "public"."whatsapp_chats" to "authenticated";

grant insert on table "public"."whatsapp_chats" to "authenticated";

grant update on table "public"."whatsapp_chats" to "authenticated";

grant delete on table "public"."whatsapp_contacts" to "anon";

grant insert on table "public"."whatsapp_contacts" to "anon";

grant select on table "public"."whatsapp_contacts" to "anon";

grant update on table "public"."whatsapp_contacts" to "anon";

grant delete on table "public"."whatsapp_contacts" to "authenticated";

grant insert on table "public"."whatsapp_contacts" to "authenticated";

grant update on table "public"."whatsapp_contacts" to "authenticated";

grant delete on table "public"."whatsapp_messages" to "anon";

grant insert on table "public"."whatsapp_messages" to "anon";

grant select on table "public"."whatsapp_messages" to "anon";

grant update on table "public"."whatsapp_messages" to "anon";

grant delete on table "public"."whatsapp_messages" to "authenticated";

grant insert on table "public"."whatsapp_messages" to "authenticated";

grant update on table "public"."whatsapp_messages" to "authenticated";

grant delete on table "public"."whatsapp_monitors" to "anon";

grant insert on table "public"."whatsapp_monitors" to "anon";

grant select on table "public"."whatsapp_monitors" to "anon";

grant update on table "public"."whatsapp_monitors" to "anon";

grant delete on table "public"."whatsapp_session_material" to "anon";

grant insert on table "public"."whatsapp_session_material" to "anon";

grant select on table "public"."whatsapp_session_material" to "anon";

grant update on table "public"."whatsapp_session_material" to "anon";

grant delete on table "public"."whatsapp_session_material" to "authenticated";

grant insert on table "public"."whatsapp_session_material" to "authenticated";

grant select on table "public"."whatsapp_session_material" to "authenticated";

grant update on table "public"."whatsapp_session_material" to "authenticated";

grant delete on table "public"."whatsapp_sessions" to "anon";

grant insert on table "public"."whatsapp_sessions" to "anon";

grant select on table "public"."whatsapp_sessions" to "anon";

grant update on table "public"."whatsapp_sessions" to "anon";

grant delete on table "public"."whatsapp_sessions" to "authenticated";

grant insert on table "public"."whatsapp_sessions" to "authenticated";

grant update on table "public"."whatsapp_sessions" to "authenticated";


  create policy "passkey_credentials_self_delete"
  on "public"."passkey_credentials"
  as permissive
  for delete
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "passkey_credentials_self_select"
  on "public"."passkey_credentials"
  as permissive
  for select
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "passkey_credentials_self_update"
  on "public"."passkey_credentials"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));



