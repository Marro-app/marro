-- Security hardening applied 2026-08-04 (tracked migration
-- revoke_admin_analytics_anon_grants). Committed here so the repo's supabase/
-- source of truth matches the live database.
--
-- The admin analytics RPCs (admin_usage_metrics, admin_events_last_30_days,
-- admin_daily_event_counts, admin_click_by_element) are SECURITY DEFINER and
-- guarded in-body by is_admin() (non-admin callers get an empty result). They
-- are invoked from the browser by a logged-in admin via supabase-js
-- (src/lib/data.js), i.e. as the `authenticated` role — so `authenticated` MUST
-- retain EXECUTE or the Admin tab breaks. `anon` never needs them; revoking the
-- anon grant removes the unauthenticated-internet-caller path, leaving is_admin()
-- with a second layer behind it instead of being the only line of defense.
--
-- If these RPCs are ever recreated, re-apply these revokes (a bare CREATE FUNCTION
-- re-grants EXECUTE to PUBLIC by default) or route admin reads through the
-- service-role backend (api/admin.js) instead of a client rpc().

revoke execute on function public.admin_usage_metrics()             from anon;
revoke execute on function public.admin_events_last_30_days()       from anon;
revoke execute on function public.admin_daily_event_counts(integer) from anon;
revoke execute on function public.admin_click_by_element(integer)   from anon;
