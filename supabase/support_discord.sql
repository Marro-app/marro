-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — track the Discord alert message per conversation
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   Lets the backend edit the Discord alert in place when a thread gets
--   claimed (instead of posting a second message). Only the message id is
--   needed — Discord's webhook message-edit endpoint
--   (PATCH /webhooks/{id}/{token}/messages/{message_id}) doesn't require the
--   channel or guild id.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.support_conversations
  add column if not exists discord_message_id text;

comment on column public.support_conversations.discord_message_id is
  'Message id of this thread''s Discord alert ping (api/support-notify.js), so api/support.js can edit it in place on claim. Null if Discord isn''t configured or the post failed.';
