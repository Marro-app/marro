-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — admin availability settings (Slice 6)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   A single-row table the availability model (plan §3) reads/writes:
--     • online_override — 'auto' (hours + heartbeat decide) | 'on' | 'off'
--     • business_hours  — {"tz":"America/New_York","start":9,"end":21}
--     • available_until — an 'on' override auto-expires at this timestamp
--     • last_admin_heartbeat — bumped while an admin has the Support console
--       open; the resolver treats a stale heartbeat as "not really here"
--   The client-side resolver (src/lib/supportAvailability.js) combines these
--   into one honest online/offline boolean for the chat panel's status line.
--
-- SECURITY
--   READ: any signed-in user (the chat panel needs it for the status line —
--   nothing sensitive lives here: no emails, no user data). anon: nothing.
--   WRITE: service-role backend only (api/support.js heartbeat/set_availability,
--   admin-gated there). No client write policies.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.support_settings (
  id                   integer primary key default 1 check (id = 1), -- single row
  online_override      text not null default 'auto'
                         check (online_override in ('auto','on','off')),
  business_hours       jsonb not null default '{"tz":"America/New_York","start":9,"end":21}'::jsonb,
  available_until      timestamptz,
  last_admin_heartbeat timestamptz,
  updated_at           timestamptz not null default now()
);
comment on table public.support_settings is
  'Single-row support availability config (plan §3). Read by all signed-in users (status line); written only by the service-role backend. See supabase/support_settings.sql.';

insert into public.support_settings (id) values (1) on conflict (id) do nothing;

alter table public.support_settings enable row level security;
grant select on public.support_settings to authenticated;

drop policy if exists "signed-in users read availability" on public.support_settings;
create policy "signed-in users read availability" on public.support_settings
  for select using ((select auth.uid()) is not null);

-- Realtime: the status line can react live to toggle changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'support_settings'
  ) then
    alter publication supabase_realtime add table public.support_settings;
  end if;
end $$;

-- VERIFY:
--   select * from public.support_settings;          -- one row, defaults
--   -- as anon: select should be denied entirely.
