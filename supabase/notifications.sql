-- ───────────────────────────────────────────────────────────────────────────
-- Marro · in-app notifications + invite-email rate log (ambassador/admin overhaul)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Two service-role-fed tables that back the "something changed" experience:
--     • user_notifications — per-email in-app messages ("Someone you invited
--       joined", "You're now an ambassador", "Your invite limit is now N").
--       Drives the dismissible banner + notifications list.
--     • invite_email_log — one row per invite email a member sends, used ONLY
--       to rate-limit api/send-invite.js (≤20 / sender / 24h).
--
-- SECURITY MODEL (read before editing — same as invites_waitlist.sql)
--   Client ships the PUBLIC anon key, so RLS is the ONLY protection (CLAUDE.md
--   rule 4). The ensure_rls event trigger auto-ENABLES RLS on every new public
--   table, but RLS on + NO policies = deny-all. So below:
--     • user_notifications gets a SELECT-own policy (read your own messages) and
--       NOTHING else — inserts come only from SECURITY DEFINER (public.notify)
--       and the service-role backend; dismissing goes through the
--       dismiss_notification() RPC (no raw client UPDATE policy).
--     • invite_email_log gets NO client policies at all (service-role only).
--
-- RUN ORDER: run this file BEFORE supabase/invites_waitlist.sql, because
--   redeem_invite_code() calls public.notify() defined here.
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. user_notifications ──────────────────────────────────────────────────────
--     One row per in-app message, keyed by EMAIL (like allowed_emails / admins /
--     user_roles) so the backend can notify someone who may not yet have — or
--     may have re-created — an auth user. dismissed_at null = still showing.
create table if not exists public.user_notifications (
  id          bigserial primary key,
  email       text not null check (email = lower(email)),
  kind        text,                       -- 'invite_joined' | 'role' | 'limit' | 'access' | 'admin' | ...
  message     text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  dismissed_at timestamptz
);
create index if not exists user_notifications_email_idx
  on public.user_notifications(email, dismissed_at);
comment on table public.user_notifications is
  'Per-email in-app notifications. Users SELECT their own undismissed rows (RLS); written only by public.notify() (SECURITY DEFINER) + the service-role backend; dismissed via dismiss_notification(). See supabase/notifications.sql.';

-- 1b. invite_email_log ────────────────────────────────────────────────────────
--     One row per invite email a member sends through api/send-invite.js. Used
--     ONLY for the 24h rate limit; never read by any client.
create table if not exists public.invite_email_log (
  id         bigserial primary key,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  to_email   text,
  code       text,
  created_at timestamptz not null default now()
);
create index if not exists invite_email_log_sender_time_idx
  on public.invite_email_log(sender_id, created_at);
comment on table public.invite_email_log is
  'Invite-email send log for the api/send-invite.js rate limit (≤20/sender/24h). Client-inaccessible (no RLS policies); service-role only. See supabase/notifications.sql.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ROW LEVEL SECURITY
--    ensure_rls already enabled RLS; the alters below are idempotent belt-and-
--    suspenders. Policies define the ONLY client access.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.user_notifications enable row level security;
alter table public.invite_email_log   enable row level security;

-- user_notifications: a user may READ their own rows (by email). No client
-- insert/update/delete — inserts are SECURITY DEFINER / service-role; dismissing
-- is the dismiss_notification() RPC (so a client can't fake-dismiss others' rows
-- or forge notifications).
drop policy if exists "select own notifications" on public.user_notifications;
create policy "select own notifications" on public.user_notifications
  for select using (email = lower(auth.jwt() ->> 'email'));

-- invite_email_log: NO client policies. Deny-all to anon/authenticated;
-- reachable only via the service-role backend.


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. notify(...) — internal insert helper. SECURITY DEFINER, NOT granted to
--     clients (only other SECURITY DEFINER functions like redeem_invite_code
--     call it; the service-role backend inserts directly). Normalizes email.
create or replace function public.notify(
  p_email text, p_kind text, p_message text, p_metadata jsonb default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_email is null or p_message is null then return; end if;
  insert into public.user_notifications(email, kind, message, metadata)
    values (lower(p_email), p_kind, p_message, p_metadata);
end;
$$;
revoke all on function public.notify(text, text, text, jsonb) from public;

-- 3b. dismiss_notification(p_id) — mark ONE of the caller's own notifications as
--     dismissed. SECURITY DEFINER so it can UPDATE (clients have no UPDATE
--     policy) but scoped to the caller's own email so it can't touch others'.
--     Returns {status:'ok'} if a row was updated, else {status:'not_found'}.
create or replace function public.dismiss_notification(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_email is null then return jsonb_build_object('status', 'not_found'); end if;
  update public.user_notifications
     set dismissed_at = now()
   where id = p_id and email = v_email and dismissed_at is null;
  if found then
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;
revoke all on function public.dismiss_notification(bigint) from public;
grant execute on function public.dismiss_notification(bigint) to authenticated;
