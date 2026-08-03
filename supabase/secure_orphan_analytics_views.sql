-- Security fix applied 2026-08-02 (tracked migration
-- 20260803xxxxxx_secure_orphan_analytics_views). Committed here so the repo's
-- supabase/ source of truth matches the live database.
--
-- events_counts_by_name and events_daily_active_users were SECURITY DEFINER views
-- GRANTed to anon/authenticated, exposing app-wide usage stats (event counts, DAU)
-- to anyone including logged-out visitors (advisor lint 0010_security_definer_view,
-- ERROR). They are orphaned — no app code reads them; the admin dashboard uses the
-- gated admin_usage_metrics() RPC. Switch to security_invoker so they honor RLS on
-- events (no SELECT policy → returns nothing to clients) and drop the client grants.
--
-- NOTE for PR #50 (analytics rework): if you rebuild these, keep security_invoker=on
-- and gate admin reads via is_admin()/an RPC — do NOT recreate them SECURITY DEFINER
-- with anon/authenticated grants.

alter view public.events_counts_by_name    set (security_invoker = on);
alter view public.events_daily_active_users set (security_invoker = on);

revoke select on public.events_counts_by_name    from anon, authenticated;
revoke select on public.events_daily_active_users from anon, authenticated;
