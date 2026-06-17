-- Migration: Add onboarding_completed to user_profiles
-- Path: supabase/migrations/20260617190000_add_onboarding_completed.sql

alter table public.user_profiles
  add column onboarding_completed boolean not null default false;
