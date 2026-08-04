-- Row Level Security for the per-user data tables: app_state + profiles
--
-- WHY THIS MATTERS: the client ships a PUBLIC publishable/anon key, so RLS is
-- the ONLY thing stopping any visitor from reading/writing other users' data.
-- Each user may touch ONLY their own row, enforced by (auth.uid() = user_id).
--
-- Verified live against pg_policies on 2026-06-25 — this file documents the
-- policies that already exist in production so they are auditable + reproducible.
-- Safe to re-run (drops + recreates). Pair with supabase/allowed_emails.sql.

-- ========================= app_state =========================
alter table public.app_state enable row level security;

drop policy if exists "insert own state" on public.app_state;
create policy "insert own state" on public.app_state
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "select own state" on public.app_state;
create policy "select own state" on public.app_state
  for select using ((select auth.uid()) = user_id);

drop policy if exists "update own state" on public.app_state;
create policy "update own state" on public.app_state
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ========================= profiles =========================
alter table public.profiles enable row level security;

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "select own profile" on public.profiles;
create policy "select own profile" on public.profiles
  for select using ((select auth.uid()) = user_id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- NOTE: there is intentionally NO delete policy on either table. With RLS on,
-- that means deletes are denied to all client (anon/authenticated) roles.
-- Account deletion (promised in privacy.html) must run through a trusted
-- service-role backend function, never the public client.
