-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — Realtime Authorization for the presence channel (Slice 8)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   `realtime.messages` has RLS ENABLED on this project (confirmed via the
--   Management API, 2026-08-11) but had ZERO policies — deny-all for every
--   role. That silently blocks Presence and Broadcast project-wide (both are
--   pure message-passing through this table), even though the client-side
--   channel.subscribe() reports SUBSCRIBED (that's just the socket handshake)
--   and channel.track() resolves "ok" (the client never learns the insert was
--   rejected). This is WHY Slice 8's presence soft-lock silently did nothing
--   in live two-admin testing: postgres_changes (Slice 4's realtime, used for
--   message/conversation sync) is unaffected — it's gated by ordinary
--   table-level RLS on public.support_messages/support_conversations, a
--   completely different mechanism from this table.
--
--   Scoped narrowly: only the exact `support-admin-presence` topic, only
--   admins (matches every other support RPC's authorization boundary), and
--   both SELECT (receive) + INSERT (broadcast/track) since Presence needs both.
--
--   SECOND, SEPARATE ROOT CAUSE (not SQL, no migration for it — logged here so
--   it isn't rediscovered the hard way again): the project's Realtime config
--   also had `presence_enabled: false` (Management API
--   GET /v1/projects/{ref}/config/realtime) — a project-wide toggle, nothing
--   to do with RLS. With it off, the server never sends the initial
--   `presence_state` message on channel join, only `presence_diff`s; the
--   client library only starts applying diffs after it's seen one
--   `presence_state` (sets an internal joinRef), so every diff queued forever
--   and `sync` never fired — client-side this looked identical to the RLS
--   failure (SUBSCRIBED + track() "ok", nothing ever received). Flipped on via
--   `PATCH /v1/projects/{ref}/config/realtime {"presence_enabled": true}`,
--   2026-08-11. Both fixes were required together; either alone still failed.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- (presence_enabled is a project setting, not SQL — verify it's still true in
-- Studio → Project Settings → Realtime if presence ever silently stops again.)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "support admins can use presence" on realtime.messages;
create policy "support admins can use presence"
on realtime.messages
for all
to authenticated
using (
  realtime.topic() = 'support-admin-presence' and public.is_admin()
)
with check (
  realtime.topic() = 'support-admin-presence' and public.is_admin()
);

-- VERIFY (should return the policy above):
--   select policyname, cmd, roles from pg_policies where schemaname = 'realtime';
