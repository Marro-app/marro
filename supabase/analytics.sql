-- ───────────────────────────────────────────────────────────────────────────
-- Marro · automatic usage analytics (Phase 1 Track B follow-up)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Additive companion to supabase/events.sql. Adds what's needed for the
--   global, zero-per-feature-instrumentation `ui_click` event emitted by
--   src/lib/analytics.js (a single delegated click listener that fires on
--   every button/link across the app, batched and flushed periodically):
--     (a) anonymous inserts, so clicks on the logged-out landing page (no
--         Supabase session yet) can be recorded too, and
--     (b) a few aggregate read views for a dashboard, built the same
--         write-only-from-the-client way as events.sql's existing views.
--
--   Reuses the existing `public.events` table — no new table. `ui_click`
--   rows just look like any other event: event_name='ui_click',
--   metadata={el, tag, tab[, n]}.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent —
-- safe to re-run. Additive only: does not touch or remove anything in
-- events.sql (that file's table/policies/views are untouched and still
-- required — run it first if you haven't).
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Allow anonymous (logged-out landing page) inserts ──────────────────────
--    events.user_id was `not null` — a logged-out visitor has no auth.uid(),
--    so an anonymous click event has to be stored with user_id = NULL. Made
--    nullable here (additive relaxation, does not affect any existing
--    authenticated row) and a dedicated anon-role INSERT policy added that
--    ONLY allows rows where user_id IS NULL — an anonymous client can never
--    write a row claiming to belong to a real user_id (that still requires
--    the existing "insert own events" policy's `auth.uid() = user_id` check,
--    which is unreachable for the anon role since auth.uid() is null for it).
alter table public.events alter column user_id drop not null;

drop policy if exists "insert anon events" on public.events;
create policy "insert anon events" on public.events
  for insert to anon
  with check (user_id is null);

comment on column public.events.user_id is
  'NULL = anonymous event (e.g. a ui_click on the logged-out landing page, before sign-in). Non-null events still require auth.uid() = user_id per the "insert own events" policy in events.sql.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Dashboard read views ────────────────────────────────────────────────────
--    Same design as events.sql's views: inherit RLS from the base table (no
--    SECURITY DEFINER), so querying them via the anon/authenticated client
--    returns nothing — only useful from the service-role connection Studio's
--    SQL Editor uses, or a future admin-only SECURITY DEFINER RPC built on
--    top of them. No client SELECT on raw `events` anywhere. Idempotent
--    (create or replace).
-- ───────────────────────────────────────────────────────────────────────────

-- Daily click counts per element per tab, from ui_click metadata. This is
-- the main "what are people actually clicking, and where" dashboard source.
-- Counts the dedup `n` field when present (analytics.js batches identical
-- clicks within a ~15s flush window and folds repeats into metadata.n rather
-- than inserting one row per click) so totals stay accurate even though the
-- row count under-counts raw clicks.
create or replace view public.events_ui_click_by_element_daily as
select
  date_trunc('day', created_at)::date as day,
  coalesce(metadata->>'tab', 'unknown') as tab,
  coalesce(metadata->>'el', 'unknown') as el,
  coalesce(metadata->>'tag', 'unknown') as tag,
  sum(coalesce((metadata->>'n')::int, 1)) as click_count
from public.events
where event_name = 'ui_click'
group by 1, 2, 3, 4
order by 1 desc, click_count desc;

comment on view public.events_ui_click_by_element_daily is
  'Daily click_count per (tab, el, tag) derived from ui_click event metadata, from public.events. Sums metadata.n (batch dedup count) so it reflects real click volume, not row count. Admin/service-role read only.';

-- Daily counts per event_name (all events, not just ui_click) — the daily-
-- granularity companion to events.sql's all-time events_counts_by_name.
create or replace view public.events_daily_counts_by_name as
select
  date_trunc('day', created_at)::date as day,
  event_name,
  count(*) as event_count
from public.events
group by 1, 2
order by 1 desc, event_count desc;

comment on view public.events_daily_counts_by_name is
  'Daily event_count per event_name, from public.events. Daily-granularity companion to events_counts_by_name. Admin/service-role read only.';

-- Last-30-days rollup per event_name: total count + distinct users, for a
-- quick "what''s getting used this month" glance without hand-writing a
-- date filter each time.
create or replace view public.events_last_30_days_by_name as
select
  event_name,
  count(*) as total_count,
  count(distinct user_id) as distinct_users
from public.events
where created_at >= now() - interval '30 days'
group by 1
order by total_count desc;

comment on view public.events_last_30_days_by_name is
  'Last-30-days total_count + distinct_users per event_name, from public.events. distinct_users excludes anonymous (NULL user_id) rows by definition of COUNT(DISTINCT). Admin/service-role read only.';
