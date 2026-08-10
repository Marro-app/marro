-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — screenshot/file attachments (Slice 10)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   A PRIVATE Storage bucket for support attachments (annotated screenshots,
--   uploaded images). Object paths are namespaced by owner:
--     support-attachments/<auth.uid()>/<timestamp>.png
--   Message rows reference paths in support_messages.attachments (jsonb);
--   clients render via short-lived signed URLs.
--
-- SECURITY (RLS on storage.objects — the bucket is NOT public)
--   • INSERT: signed-in users, ONLY into their own <uid>/ folder.
--   • SELECT: the owner (own folder) or an admin (is_admin()) — needed to
--     mint signed URLs. No update/delete from clients (immutable record;
--     service-role can clean up orphans later).
--
-- ALSO: support_start_conversation gains a p_attachments param so a bug
--   report's screenshot can ride on the FIRST message. Postgres would treat a
--   new default param as a second overload, so the old 3-arg signature is
--   dropped first (safe: callers pass named params via supabase-js rpc()).
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

drop policy if exists "support attachments owner insert" on storage.objects;
create policy "support attachments owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "support attachments read own or admin" on storage.objects;
create policy "support attachments read own or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

-- ── support_start_conversation now accepts attachments on the first message ─
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

  -- Single active Question (unchanged — see supabase/support_chat.sql).
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
-- Grant hardening (handoff decision 12): name anon explicitly.
revoke all on function public.support_start_conversation(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.support_start_conversation(text, text, jsonb, jsonb) to authenticated;

-- VERIFY:
--   select has_function_privilege('anon',
--     'public.support_start_conversation(text,text,jsonb,jsonb)', 'execute');  -- false
--   -- storage: as user A upload to A/..., read it; reading B/... fails; as
--   -- admin, reading A/... succeeds.
