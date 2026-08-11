-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — enable Realtime replication (Slice 4)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   Adds the two support tables to the `supabase_realtime` publication so
--   clients receive live INSERT/UPDATE events (postgres_changes) instead of
--   polling. SECURITY: Realtime enforces the same RLS policies as normal
--   SELECTs (supabase/support_chat.sql) — users only ever receive events for
--   their OWN conversations/messages (and never internal notes, which the
--   user-lane policy excludes); the admin lane is is_admin()-gated. No new
--   policies are needed and none are added here.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'support_conversations'
  ) then
    alter publication supabase_realtime add table public.support_conversations;
  end if;
end $$;

-- VERIFY (should return both tables):
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename like 'support_%';
