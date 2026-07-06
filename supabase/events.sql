-- ───────────────────────────────────────────────────────────────────────────
-- Marro · events (usage/analytics logging — Phase 1 Track B)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Lightweight, best-effort usage logging so we can see whether people are
--   actually using the app (logins, setup completion, tab views, etc.) and
--   watch the Phase 4 closed-beta gate (docs/ROADMAP.md). No dashboard UI —
--   an admin reads this table directly in Supabase Studio via the two views
--   below (or ad-hoc SQL).
--
-- WRITE-ONLY BY DESIGN (read this before "fixing" the missing SELECT policy)
--   This table intentionally has an INSERT policy but NO SELECT policy for
--   the `authenticated` role. That is not an oversight: the client only ever
--   needs to WRITE its own events (fire-and-forget logging from logEvent() in
--   src/lib/data.js), it never needs to READ them back. An admin/service-role
--   client (Supabase Studio, or a future backend) bypasses RLS entirely and
--   can read every row. Per CLAUDE.md rule 4, RLS auto-enables on every new
--   public table (ensure_rls trigger) but is deny-all until policies exist —
--   so the INSERT policy below is required or logging silently no-ops; the
--   absence of a SELECT policy is what keeps this table write-only from the
--   client's point of view.
--
-- DATA ETHICS (docs/DATA_ETHICS.md)
--   `metadata` must stay minimal, non-sensitive structural context (e.g.
--   {tab:"budget"}) — never dollar amounts, balances, or other financial/
--   personal details. Enforced at the call site (logEvent), not by the DB.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. The events table ─────────────────────────────────────────────────────
create table if not exists public.events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

comment on table public.events is
  'Usage/event logging (Phase 1 Track B). Write-only from the client (INSERT-only RLS) — read via Supabase Studio (service role) or the events_* views. See supabase/events.sql.';

create index if not exists events_user_id_idx on public.events(user_id);
create index if not exists events_event_name_idx on public.events(event_name);
create index if not exists events_created_at_idx on public.events(created_at);

-- 2. Lock it down with RLS ────────────────────────────────────────────────
alter table public.events enable row level security;

drop policy if exists "insert own events" on public.events;
create policy "insert own events" on public.events
  for insert with check (auth.uid() = user_id);

-- No SELECT/UPDATE/DELETE policy for authenticated/anon — see the header
-- comment. This table is insert-only from the client by design; regular
-- users cannot read back events (their own or anyone else's), and nothing
-- can be edited or removed from the client. Only the service-role key
-- (Supabase Studio / a trusted backend) can read or manage rows.

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Simple analytics views for an admin to query in Studio ────────────────
--    Kept intentionally simple (a couple of views, not a dashboard). These
--    views inherit RLS from the underlying table (no SECURITY DEFINER), so
--    querying them via the anon/authenticated client returns nothing — they
--    are only useful from the service-role connection Studio's SQL Editor
--    uses. Idempotent (create or replace).
-- ───────────────────────────────────────────────────────────────────────────

-- Daily active users: distinct users per calendar day (any event counts as
-- "active" that day).
create or replace view public.events_daily_active_users as
select
  date_trunc('day', created_at)::date as day,
  count(distinct user_id) as active_users
from public.events
group by 1
order by 1 desc;

comment on view public.events_daily_active_users is
  'Distinct user_id per calendar day, from public.events. Admin/service-role read only (RLS on the base table).';

-- Event counts by event_name (overall + most recent day, for a quick glance).
create or replace view public.events_counts_by_name as
select
  event_name,
  count(*) as total_count,
  count(*) filter (where created_at >= now() - interval '1 day') as last_24h_count,
  max(created_at) as last_seen
from public.events
group by 1
order by total_count desc;

comment on view public.events_counts_by_name is
  'Event counts by event_name (all-time + last 24h), from public.events. Admin/service-role read only (RLS on the base table).';
