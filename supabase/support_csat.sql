-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — CSAT rating RPC (Slice 11, plan §11)
-- ═══════════════════════════════════════════════════════════════════════════
-- The 👍/👎 on the "Chat ended" screen. Owner-scoped, only meaningful once a
-- thread is ended (resolved/archived). Re-rating overwrites (the user changed
-- their mind — fine); rolls up into the Slice-12 metrics.
-- HOW TO RUN: Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.support_rate_conversation(
  p_conversation_id uuid, p_csat text, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  if p_csat is null or p_csat not in ('up','down') then return; end if;
  update public.support_conversations
     set csat = p_csat,
         csat_comment = nullif(left(btrim(coalesce(p_comment, '')), 300), '')
   where id = p_conversation_id
     and user_id = v_uid
     and status in ('resolved','archived');
end;
$$;
-- Grant hardening (handoff decision 12): name anon explicitly.
revoke all on function public.support_rate_conversation(uuid, text, text) from public, anon;
grant execute on function public.support_rate_conversation(uuid, text, text) to authenticated;

-- VERIFY:
--   select has_function_privilege('anon',
--     'public.support_rate_conversation(uuid,text,text)', 'execute');  -- false
