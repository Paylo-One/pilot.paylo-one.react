-- Migration: Add documents JSONB column to suggested_actions table
-- Adds support for storing uploaded document metadata on actions.

alter table public.suggested_actions 
  add column if not exists documents jsonb not null default '[]'::jsonb;
