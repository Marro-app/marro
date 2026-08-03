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
--
-- SECTIONS: (1) anon insert policy, (2) service-role-only dashboard views,
-- (3) admin-gated RPCs so the in-app Admin → Usage dashboard can read those
-- views from the browser client (added for the founder-facing dashboard —
-- see src/tabs/AdminTab.jsx's UsageSection). Section 3 must be run for the
-- Usage tile/dashboard to show real data; without it the dashboard falls
-- back to its "no data yet" empty state (the RPCs simply don't exist).
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
--    Created WITH (security_invoker = on) so the view runs with the CALLER's
--    privileges and honors RLS on the base `events` table (which has no SELECT
--    policy) — querying them via the anon/authenticated client returns nothing.
--    NOTE: a plain view (without security_invoker) runs as its OWNER and would
--    BYPASS the caller's RLS, exposing app-wide usage aggregates to any client
--    (Supabase advisor lint 0010_security_definer_view). These are useful only
--    from the service-role connection Studio's SQL Editor uses, or the admin-
--    only SECURITY DEFINER RPCs in section 3 (which read them as the function
--    owner). No client SELECT on raw `events` anywhere. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- Daily click counts per element per tab, from ui_click metadata. This is
-- the main "what are people actually clicking, and where" dashboard source.
-- Counts the dedup `n` field when present (analytics.js batches identical
-- clicks within a ~15s flush window and folds repeats into metadata.n rather
-- than inserting one row per click) so totals stay accurate even though the
-- row count under-counts raw clicks.
create or replace view public.events_ui_click_by_element_daily
  with (security_invoker = on) as
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
create or replace view public.events_daily_counts_by_name
  with (security_invoker = on) as
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
create or replace view public.events_last_30_days_by_name
  with (security_invoker = on) as
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

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Admin-gated read RPCs (client-callable) ─────────────────────────────────
--    The views above inherit RLS from `events` and return nothing to the
--    anon/authenticated client — by design, same as events.sql. The Admin
--    tab's Usage dashboard still needs a client-safe way to read them, so
--    these mirror the existing is_admin()-gated SECURITY DEFINER pattern
--    already used for is_admin()/my_invite_quota() (supabase/invites_
--    waitlist.sql) rather than inventing a new auth scheme or exposing a
--    service-role endpoint for what is, start to finish, a pure read.
--    Each checks public.is_admin() itself (never trusts the caller) and
--    returns zero rows for a non-admin/signed-out caller — never an error,
--    so a non-admin client just sees an empty dashboard, exactly like
--    admin_usage_metrics() (docs: AdminTab.jsx InsightsSection). Pinned
--    search_path=public, granted ONLY to authenticated (anonymous landing-
--    page visitors have no reason to call these). Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- Most/least-clicked elements: totals per (tab, el, tag) over the trailing
-- p_days window (default 30), summed across days server-side so the client
-- doesn't have to reduce daily rows itself. One function serves both the
-- "most-clicked" and "least-clicked" lists — the client just sorts/slices
-- the same result set from opposite ends.
create or replace function public.admin_click_by_element(p_days integer default 30)
returns table(tab text, el text, tag text, click_count bigint)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then
    return; -- empty result set for non-admins/signed-out callers
  end if;
  return query
    select v.tab, v.el, v.tag, sum(v.click_count)::bigint as click_count
    from public.events_ui_click_by_element_daily v
    where v.day >= (current_date - greatest(coalesce(p_days, 30), 1))
    group by v.tab, v.el, v.tag
    order by click_count desc;
end;
$$;
revoke all on function public.admin_click_by_element(integer) from public;
grant execute on function public.admin_click_by_element(integer) to authenticated;
comment on function public.admin_click_by_element(integer) is
  'Admin-only (is_admin()-gated) read of events_ui_click_by_element_daily, summed per (tab, el, tag) over the trailing p_days days. Empty result for non-admins. Used by AdminTab.jsx UsageSection.';

-- Daily event counts per event_name, for the activity-trend chart. Same
-- trailing-window shape as admin_click_by_element.
create or replace function public.admin_daily_event_counts(p_days integer default 30)
returns table(day date, event_name text, event_count bigint)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select v.day, v.event_name, v.event_count
    from public.events_daily_counts_by_name v
    where v.day >= (current_date - greatest(coalesce(p_days, 30), 1))
    order by v.day asc;
end;
$$;
revoke all on function public.admin_daily_event_counts(integer) from public;
grant execute on function public.admin_daily_event_counts(integer) to authenticated;
comment on function public.admin_daily_event_counts(integer) is
  'Admin-only (is_admin()-gated) read of events_daily_counts_by_name over the trailing p_days days. Empty result for non-admins. Used by AdminTab.jsx UsageSection.';

-- Last-30-days rollup per event_name (total_count + distinct_users) — the
-- stat-tile source (e.g. "active users" from ui_click's distinct_users).
create or replace function public.admin_events_last_30_days()
returns table(event_name text, total_count bigint, distinct_users bigint)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select v.event_name, v.total_count::bigint, v.distinct_users::bigint
    from public.events_last_30_days_by_name v;
end;
$$;
revoke all on function public.admin_events_last_30_days() from public;
grant execute on function public.admin_events_last_30_days() to authenticated;
comment on function public.admin_events_last_30_days() is
  'Admin-only (is_admin()-gated) read of events_last_30_days_by_name. Empty result for non-admins. Used by AdminTab.jsx UsageSection stat tiles.';
