-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Admins — Discord user ID (support notification mentions)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   Lets support-notification code @-mention the right admin in Discord
--   (reassign → the new owner, a snooze waking up → whoever it's assigned
--   to) without a hardcoded email→Discord-ID map in source. Set/edited from
--   the app itself (Admin tab → Users & Invites → click a member → Discord
--   ID field) via api/admin.js's `set_discord_id` action, so it survives an
--   admin switching Discord accounts or a new moderator being added — no
--   code change or redeploy needed.
--
-- SECURITY
--   No client policies — private, same posture as the rest of the `admins`
--   table (read via the service-role backend only). Nothing sensitive: a
--   Discord snowflake ID isn't a secret, but it's still routed through the
--   existing admin-gated api/admin.js rather than exposed to any client read.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table if exists public.admins
  add column if not exists discord_user_id text;

comment on column public.admins.discord_user_id is
  'Discord snowflake user ID for @-mentions in support notifications (reassign, snooze-wake). Set via the Admins UI, not hardcoded. Null = notifications fall back to naming the admin in plain text.';

-- VERIFY:
--   select email, discord_user_id from public.admins;
