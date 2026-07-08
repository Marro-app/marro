-- ───────────────────────────────────────────────────────────────────────────
-- Marro · allowed_emails (invite allowlist)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   A closed-beta gate. Once the Google consent screen is PUBLISHED (out of
--   Testing mode), any Google account can authenticate — so access control moves
--   into our own backend. This table is that control: an email is allowed in only
--   if it appears here.
--
-- STATUS: PREPARED, NOT YET ENFORCED.
--   Do NOT wire the app-side gate (see step 4 below) while the Google OAuth consent
--   screen is still in "Testing" mode — Google's test-user list already gates access,
--   and enforcing this on top risks locking yourself out. Run sections 1–3 whenever
--   (creating the table is harmless), but only enable section 4's app gate at launch.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. The allowlist table ─────────────────────────────────────────────────────
create table if not exists public.allowed_emails (
  email      text primary key check (email = lower(email)),  -- always store lowercased
  note       text,                                           -- e.g. "M1 cohort", "personal invite"
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Closed-beta invite allowlist. An email here may use Marro once the consent screen is published. See supabase/allowed_emails.sql.';

-- 2. Lock it down with RLS ────────────────────────────────────────────────────
--    No public read/write policies are created, so the anon/authenticated clients
--    cannot read the list or add to it. Only the service-role key (used by the
--    admin backend) bypasses RLS. This keeps the invite list private.
alter table public.allowed_emails enable row level security;

-- 3. Safe "am I allowed?" check for the client ────────────────────────────────
--    A SECURITY DEFINER function lets a signed-in user check ONLY their own email
--    without being able to read the rest of the list. The app calls this right
--    after login: sb.rpc('is_email_allowed').
--
--    Ambassador/admin overhaul: an email is now also allowed if it's in
--    public.admins or is an ambassador in public.user_roles (features "adding
--    someone as admin/ambassador should just give them app access" — no
--    separate allowed_emails row needed). This closes audit H3 (a newly-added
--    admin used to be locked out at the InviteGate since add_admin never wrote
--    to allowed_emails). Depends on public.admins / public.user_roles existing
--    — run supabase/invites_waitlist.sql before (or after; only EXECUTION of
--    this function requires those tables, not its creation) enabling this gate.
create or replace function public.is_email_allowed()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from public.allowed_emails where email = lower(auth.jwt() ->> 'email'))
    or exists (select 1 from public.admins where email = lower(auth.jwt() ->> 'email'))
    or exists (select 1 from public.user_roles
                 where email = lower(auth.jwt() ->> 'email') and is_ambassador = true);
$$;

revoke all on function public.is_email_allowed() from public;
grant execute on function public.is_email_allowed() to authenticated;

-- Seed the owner so you are never locked out (the Google OAuth account).
insert into public.allowed_emails (email, note)
values ('jawadhijazi7@gmail.com', 'owner')
on conflict (email) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. APP-SIDE GATE (enable at public launch — NOT before)
-- ───────────────────────────────────────────────────────────────────────────
-- In index.html, in the onAuthStateChange / boot effect after a session is
-- established, before loading state:
--
--     const { data: allowed } = await sb.rpc('is_email_allowed');
--     if (!allowed) {
--       await sb.auth.signOut();
--       setAccessDenied(true);   // render a "Marro is invite-only — request access" screen
--       return;
--     }
--
-- Admin "Invite" action (runs through the service-role backend function, never the
-- public client) is just:  insert into allowed_emails (email, note, invited_by) ...
-- on conflict do nothing;  — see the "Admin backend" item in docs/FUTURE_WORK.md.
-- ───────────────────────────────────────────────────────────────────────────
