-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support / feedback / bug-report chat — schema, RLS, and user RPCs
-- (Support Chat build, Slice 1 — see docs/SUPPORT_CHAT_BUILD.md)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   The data foundation for the in-app support chat: conversations, their
--   messages, and an admin audit/attribution log. No UI consumes this yet
--   (Slice 2 adds the user chat panel; Slice 3 the admin inbox).
--
-- SECURITY MODEL (read before editing — CLAUDE.md rule 4)
--   The client ships the PUBLIC anon key, so RLS is the ONLY thing protecting
--   this data. The ensure_rls event trigger auto-ENABLES RLS on every new
--   public table, but RLS on + NO policy = deny-all — so every table below
--   gets its policies explicitly. Two read lanes (decided in the build spec):
--     • USERS  read ONLY their own conversations/messages (own user_id), and
--       never internal notes — needed so client Realtime (Slice 4) can scope
--       to the user's own rows.
--     • ADMINS read everything, gated by the existing is_admin() (support
--       conversations are not financial data — admins legitimately handle all
--       of them; the financial-snapshot concern in DATA_ETHICS is separate and
--       we still never attach financial data here).
--   ALL WRITES go through the SECURITY DEFINER RPCs below (users) or the
--   service-role backend api/support.js (admins) — there are NO client
--   INSERT/UPDATE/DELETE policies. This mirrors app_state_profiles_rls.sql +
--   notifications.sql.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. support_conversations — one row per support thread. Columns beyond the
--     Slice-1 essentials (priority, csat, linked_issue_url, tags, the lifecycle
--     timestamps) are created now but only populated by later slices — cheaper
--     than an ALTER per slice, and harmless while null. See plan §5 / §9.5.
create table if not exists public.support_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'new'
                     check (status in ('new','open','waiting_user','snoozed','resolved','archived')),
  type             text not null default 'question'
                     check (type in ('bug','feedback','question','billing','other')),
  priority         text not null default 'normal'
                     check (priority in ('low','normal','urgent')),
  subject          text,                       -- auto-derived from the first message
  tags             text[],                     -- Slice 9
  tech_context     jsonb,                      -- Slice 7/9 (bug reports); technical only, never financial
  assigned_admin   text,                       -- owner email; set by auto-claim (Slice 3)
  linked_issue_url text,                       -- Slice 9 (GitHub issue)
  csat             text,                        -- Slice 11 ('up' | 'down' | ...)
  csat_comment     text,
  unread_admin     integer not null default 0,  -- user msgs since an admin last read
  unread_user      integer not null default 0,  -- admin msgs since the user last read
  reopen_count     integer not null default 0,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  claimed_at       timestamptz,                 -- first admin claim (Slice 3)
  first_response_at timestamptz,                -- first admin reply (Slice 3) — feeds metrics
  resolved_at      timestamptz,
  resolved_by      text,                        -- admin email who resolved (Slice 7)
  archived_at      timestamptz,
  snooze_until     timestamptz
);
comment on table public.support_conversations is
  'One support/feedback/bug thread per row. RLS: users read own (user_id); admins read all (is_admin()). Writes only via SECURITY DEFINER RPCs (users) / service-role backend (admins). See supabase/support_chat.sql.';

create index if not exists support_conversations_user_idx    on public.support_conversations (user_id);
create index if not exists support_conversations_status_idx  on public.support_conversations (status);
create index if not exists support_conversations_owner_idx   on public.support_conversations (assigned_admin);
create index if not exists support_conversations_recent_idx  on public.support_conversations (last_message_at desc);

-- 1b. support_messages — the transcript. Immutable from the client (no update/
--     delete). `is_internal_note` rows are admin-only and MUST never appear in
--     the user read lane (enforced in the RLS policy below).
create table if not exists public.support_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.support_conversations(id) on delete cascade,
  sender           text not null check (sender in ('user','admin','system')),
  sender_email     text,                        -- which admin (attribution); null for user/system
  body             text not null,
  attachments      jsonb,                       -- Slice 10 (screenshots/files)
  is_internal_note boolean not null default false,  -- admin-only; excluded from the user read lane
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);
comment on table public.support_messages is
  'Support transcript. RLS: users read messages on their own conversations EXCEPT internal notes; admins read all. Immutable from clients — inserts only via RPC / service-role. See supabase/support_chat.sql.';

create index if not exists support_messages_convo_idx on public.support_messages (conversation_id, created_at);

-- 1c. support_events — admin audit + attribution log (who did what, when). The
--     "who helped" record and the source data for per-admin metrics (Slice 12)
--     and the §4 data-lookup trail. Service-role only: RLS on, NO policies.
create table if not exists public.support_events (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.support_conversations(id) on delete cascade,
  admin_email      text not null,
  action           text not null,   -- claimed|replied|reassigned|released|resolved|reopened|archived|snoozed|priority_changed|tagged|viewed_user_data
  meta             jsonb,
  at               timestamptz not null default now()
);
comment on table public.support_events is
  'Admin action log for support (attribution + audit + metrics source). Written only by the service-role backend; RLS on with NO client policies (deny-all). See supabase/support_chat.sql.';

create index if not exists support_events_convo_idx on public.support_events (conversation_id);
create index if not exists support_events_admin_idx on public.support_events (admin_email, at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
-- (ensure_rls already enabled RLS on create; these ALTERs are idempotent
--  belt-and-suspenders + they document intent.)

alter table public.support_conversations enable row level security;
alter table public.support_messages      enable row level security;
alter table public.support_events        enable row level security;

-- Explicit table grants: RLS governs the rows, but the authenticated role still
-- needs SELECT privilege for a policy to let anything through. anon gets nothing.
grant select on public.support_conversations to authenticated;
grant select on public.support_messages      to authenticated;

-- ── support_conversations ────────────────────────────────────────────────────
drop policy if exists "user selects own conversations" on public.support_conversations;
create policy "user selects own conversations" on public.support_conversations
  for select using ((select auth.uid()) = user_id);

drop policy if exists "admin selects all conversations" on public.support_conversations;
create policy "admin selects all conversations" on public.support_conversations
  for select using ((select public.is_admin()));

-- (No client insert/update/delete policies — writes go through the RPCs /
--  service-role backend. RLS-on + no write policy = denied for anon/authenticated.)

-- ── support_messages ─────────────────────────────────────────────────────────
drop policy if exists "user selects own non-internal messages" on public.support_messages;
create policy "user selects own non-internal messages" on public.support_messages
  for select using (
    is_internal_note = false
    and exists (
      select 1 from public.support_conversations c
      where c.id = support_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "admin selects all messages" on public.support_messages;
create policy "admin selects all messages" on public.support_messages
  for select using ((select public.is_admin()));

-- ── support_events ───────────────────────────────────────────────────────────
-- Intentionally NO policies. RLS-on + no policy = deny-all to anon/authenticated.
-- Only the service-role backend (which bypasses RLS) reads/writes this.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. USER RPCs (SECURITY DEFINER — the only client write path for users)
-- ═══════════════════════════════════════════════════════════════════════════
-- Each is SECURITY DEFINER (so it can INSERT/UPDATE where clients have no
-- policy) but scoped to the caller's own uid, so it can't touch anyone else's
-- thread. Pattern mirrors dismiss_notification() in notifications.sql.

-- 3a. support_start_conversation — open a new thread with its first message,
--     atomically. Subject is auto-derived from the message (users don't type a
--     separate subject). Returns the new conversation id.
-- (Slice 10) 4-arg signature — p_attachments rides on the first message. The
-- old 3-arg overload is dropped so rpc() name resolution stays unambiguous.
drop function if exists public.support_start_conversation(text, text, jsonb);
create or replace function public.support_start_conversation(
  p_type text, p_body text, p_tech_context jsonb default null, p_attachments jsonb default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_id     uuid;
  v_active uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'message body required' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('bug','feedback','question','billing','other') then
    p_type := 'question';
  end if;

  -- Single active support chat (product rule): a user may have only ONE open
  -- 'question' thread at a time. Starting another while one is active just
  -- appends the message to the existing chat instead of creating a duplicate —
  -- the client already routes to "continue chat", this enforces it server-side.
  -- (Bugs/ideas are one-off submissions and are NOT limited this way.)
  if p_type = 'question' then
    select id into v_active
      from public.support_conversations
     where user_id = v_uid and type = 'question'
       and status in ('new','open','waiting_user')
     order by last_message_at desc
     limit 1;
    if v_active is not null then
      insert into public.support_messages (conversation_id, sender, body, attachments)
        values (v_active, 'user', btrim(p_body), p_attachments);
      update public.support_conversations
         set last_message_at = now(), unread_admin = unread_admin + 1
       where id = v_active;
      return v_active;
    end if;
  end if;

  insert into public.support_conversations (user_id, type, subject, tech_context, status, unread_admin, last_message_at)
    values (v_uid, p_type, left(btrim(p_body), 80), p_tech_context, 'new', 1, now())
    returning id into v_id;

  insert into public.support_messages (conversation_id, sender, body, attachments)
    values (v_id, 'user', btrim(p_body), p_attachments);

  return v_id;
end;
$$;
revoke all on function public.support_start_conversation(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.support_start_conversation(text, text, jsonb, jsonb) to authenticated;

-- 3b. support_post_user_message — add a user message to one of the caller's own
--     threads. Bumps unread_admin + last_message_at. Auto-reopens a
--     resolved/archived thread (so a follow-up doesn't vanish). Returns the
--     new message id.
create or replace function public.support_post_user_message(
  p_conversation_id uuid, p_body text, p_attachments jsonb default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_msg uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'message body required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.support_conversations
    where id = p_conversation_id and user_id = v_uid
  ) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  insert into public.support_messages (conversation_id, sender, body, attachments)
    values (p_conversation_id, 'user', btrim(p_body), p_attachments)
    returning id into v_msg;

  update public.support_conversations
     set last_message_at = now(),
         unread_admin    = unread_admin + 1,
         -- auto-reopen a closed thread on a new user message; a reply while
         -- we're waiting on them (or the thread is snoozed) also wakes it to
         -- 'open' so it lands back in the admin's needs-reply queue (Slice 7)
         status       = case when status in ('resolved','archived','waiting_user','snoozed') then 'open' else status end,
         reopen_count = case when status in ('resolved','archived') then reopen_count + 1 else reopen_count end,
         archived_at  = case when status = 'archived' then null else archived_at end,
         snooze_until = case when status = 'snoozed' then null else snooze_until end
   where id = p_conversation_id;

  return v_msg;
end;
$$;
revoke all on function public.support_post_user_message(uuid, text, jsonb) from public, anon;
grant execute on function public.support_post_user_message(uuid, text, jsonb) to authenticated;

-- 3c. support_mark_read — the caller marks admin messages on their own thread as
--     seen (zeroes unread_user). Idempotent.
create or replace function public.support_mark_read(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  update public.support_conversations
     set unread_user = 0
   where id = p_conversation_id and user_id = v_uid;
end;
$$;
revoke all on function public.support_mark_read(uuid) from public, anon;
grant execute on function public.support_mark_read(uuid) to authenticated;

-- 3d. support_archive_conversation — the user ENDS their own support chat. It's
--     archived (not deleted): re-openable for a while (client shows it for 7 days),
--     then hidden from the user; a later cron does the real cleanup. Owner-scoped.
--     This is the "End chat" action in the panel (Slice 2). Idempotent.
create or replace function public.support_archive_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  update public.support_conversations
     set status      = 'archived',
         archived_at  = now(),
         resolved_at  = coalesce(resolved_at, now())
   where id = p_conversation_id and user_id = v_uid;
end;
$$;
revoke all on function public.support_archive_conversation(uuid) from public, anon;
grant execute on function public.support_archive_conversation(uuid) to authenticated;

-- 3e. support_reopen_conversation — the user reopens a resolved/archived chat
--     (the "Reopen your recent chat" affordance). Flips it back to open and bumps
--     reopen_count. No-op if it isn't the caller's or isn't resolved/archived.
create or replace function public.support_reopen_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  update public.support_conversations
     set status       = 'open',
         archived_at   = null,
         reopen_count  = reopen_count + 1
   where id = p_conversation_id and user_id = v_uid
     and status in ('resolved','archived');
end;
$$;
revoke all on function public.support_reopen_conversation(uuid) from public, anon;
grant execute on function public.support_reopen_conversation(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VERIFY (run these after, ideally as two different users)
-- ═══════════════════════════════════════════════════════════════════════════
--   -- as user A: opens a thread, returns an id
--   select public.support_start_conversation('bug', 'Savings tab will not save', null);
--   -- as user A: can read it
--   select id, status, subject from public.support_conversations;      -- 1 row
--   -- as user B: CANNOT read user A's thread
--   select count(*) from public.support_conversations;                 -- 0
--   -- anon (logged out): denied everything
--   -- internal-note invisibility is tested in Slice 3 once admin notes exist
-- ═══════════════════════════════════════════════════════════════════════════
