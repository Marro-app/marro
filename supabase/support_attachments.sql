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

-- ── support_start_conversation ──────────────────────────────────────────────
-- The RPC change that pairs with this bucket (a 4th p_attachments param) lives
-- CANONICALLY in supabase/support_chat.sql — re-run that file after this one.
-- (An earlier revision duplicated the function here; removed so the two files
-- can never drift.)

-- VERIFY:
--   -- storage: as user A upload to A/..., read it; reading B/... fails; as
--   -- admin, reading A/... succeeds.
