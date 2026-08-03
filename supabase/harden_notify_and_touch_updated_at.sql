-- Security hardening applied 2026-08-02 (tracked Supabase migration
-- 20260803085321_harden_notify_and_touch_updated_at). Committed here so the
-- repo's supabase/ source of truth matches the live database.
--
-- Surfaced by `get_advisors(security)`:
--   1) notify() is SECURITY DEFINER and was executable by anon/authenticated via
--      /rest/v1/rpc/notify, letting anyone (even logged out) insert a notification
--      for any email address (spam/abuse vector). Restrict execute to backend roles.
--   2) touch_updated_at() had a mutable search_path (linter 0011) — pin it.

revoke execute on function public.notify(text, text, text, jsonb) from anon, authenticated;

alter function public.touch_updated_at() set search_path = public, pg_temp;
