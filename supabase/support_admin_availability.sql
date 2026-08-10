-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — PER-ADMIN availability (supersedes support_settings)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   Slice 6 shipped one shared support_settings row for the whole team. Two
--   founders in different timezones/schedules made that wrong — this table
--   gives each admin their own override + business hours, and "are we
--   online" becomes "is ANY admin online right now" (resolveTeamAvailability
--   in src/lib/supportAvailability.js).
--     • admin_email     — which admin this row belongs to (references admins)
--     • online_override — 'auto' (hours + heartbeat decide) | 'on' | 'off'
--     • business_hours  — {"tz":"America/New_York",
--                           "mon":[{"start":9,"end":17}], "tue":[...], ...,
--                           "sun":[...]}
--                          per-day list of [start,end) hour blocks (0-23);
--                          missing/empty day = not working that day; missing
--                          tz/day falls back to the 9-21-every-day default.
--     • available_until — an 'on' override auto-expires at this timestamp
--     • last_heartbeat   — bumped while THIS admin has the Support console
--       open; the resolver treats a stale heartbeat as "not really here"
--
--   support_settings.sql's single row is superseded, not dropped (no data of
--   consequence lives there — just leftover test-toggle state). Nothing new
--   reads or writes it.
--
-- SECURITY
--   READ: any signed-in user (the chat panel needs it for the status line —
--   nothing sensitive: no PII beyond an admin's own working hours). anon:
--   nothing.
--   WRITE: service-role backend only (api/support.js heartbeat/
--   set_availability/set_business_hours, admin-gated + scoped to the
--   caller's own row there). No client write policies.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.support_admin_availability (
  admin_email      text primary key references public.admins(email) on delete cascade,
  online_override  text not null default 'auto'
                     check (online_override in ('auto','on','off')),
  business_hours   jsonb not null default '{"tz":"America/New_York"}'::jsonb,
  available_until  timestamptz,
  last_heartbeat   timestamptz,
  updated_at       timestamptz not null default now()
);
comment on table public.support_admin_availability is
  'Per-admin support availability config. Read by all signed-in users (status line reads every row and takes the OR); written only by the service-role backend, scoped to the caller''s own row. See supabase/support_admin_availability.sql.';

alter table public.support_admin_availability enable row level security;
grant select on public.support_admin_availability to authenticated;

drop policy if exists "signed-in users read availability" on public.support_admin_availability;
create policy "signed-in users read availability" on public.support_admin_availability
  for select using ((select auth.uid()) is not null);

-- Realtime: the status line can react live to any admin's toggle changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'support_admin_availability'
  ) then
    alter publication supabase_realtime add table public.support_admin_availability;
  end if;
end $$;

-- VERIFY:
--   select * from public.support_admin_availability;   -- one row per admin, once each has toggled
--   -- as anon: select should be denied entirely.
