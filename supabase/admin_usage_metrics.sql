-- ───────────────────────────────────────────────────────────────────────────
-- Marro · admin_usage_metrics() (Admin tab "Insights" panel — Track A follow-up)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   src/lib/data.js's adminUsageMetrics() already calls
--   sb.rpc('admin_usage_metrics') to power AdminTab.jsx's Insights panel, but
--   no matching SQL function existed yet — the panel fell back to "Coming
--   soon". This adds it.
--
-- WHY A SECURITY DEFINER RPC (not a client SELECT on the tables directly)
--   public.events is INSERT-only from the client (no SELECT policy for
--   authenticated — see supabase/events.sql), and auth.users is never
--   client-readable at all. A SECURITY DEFINER function that checks the
--   caller is in public.admins (via the existing is_admin(), see
--   supabase/invites_waitlist.sql) and only then returns aggregate counts is
--   the only client-safe way to expose this. A non-admin or signed-out caller
--   gets zero rows back (the WHERE exists(...) guard), never raw data.
--
-- METRICS RETURNED
--   signups_this_week — count of auth.users created in the last 7 days.
--   return_users       — count of users with events on 2+ distinct calendar
--                         days (public.events), i.e. came back at least once.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.admin_usage_metrics()
returns table (signups_this_week bigint, return_users bigint)
language sql security definer set search_path = public stable
as $$
  select
    (select count(*) from auth.users
       where created_at >= now() - interval '7 days') as signups_this_week,
    (select count(*) from (
       select user_id from public.events
       group by user_id
       having count(distinct date_trunc('day', created_at)) >= 2
     ) t) as return_users
  where public.is_admin();
$$;

comment on function public.admin_usage_metrics() is
  'Aggregate usage counts for the Admin tab Insights panel. SECURITY DEFINER — returns zero rows unless the caller is in public.admins (checked via is_admin()). See supabase/admin_usage_metrics.sql.';

revoke all on function public.admin_usage_metrics() from public;
grant execute on function public.admin_usage_metrics() to authenticated;
