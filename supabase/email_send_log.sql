-- email_send_log — one row per email Marro successfully hands to Resend.
--
-- WHY: the Resend plan allows 100 emails/day and 3,000/month. Nothing in the
-- app used to know that, so an ambassador invite burst (10 ambassadors × 15
-- invites) could blow past the daily cap and every send after #100 would fail
-- silently at Resend. api/_email.js now counts rows here BEFORE each send and
-- refuses (gracefully, with clear copy) once we reach the SOFT caps of
-- 90/day and 2,700/month — a ~10% buffer under Resend's real limits, because:
--   • the count-then-send check is not atomic (parallel serverless invocations
--     can race past an exact-100 check),
--   • some sends may bypass this log entirely (Resend dashboard tests, any
--     future Supabase-auth SMTP routing through the same Resend account).
--
-- Distinct from invite_email_log (notifications.sql), which is PER-SENDER
-- abuse limiting (≤20/sender/24h). This table is the GLOBAL plan-level meter
-- across every email type: invites, waitlist confirmations/invites, congrats.
--
-- Client access: NONE. RLS enabled (ensure_rls would anyway), zero policies —
-- deny-all to anon/authenticated. Written and read only by the service-role
-- backend (api/_email.js, api/admin.js `email_usage` action).

create table if not exists public.email_send_log (
  id      bigserial primary key,
  sent_at timestamptz not null default now(),
  type    text not null default 'other'
);

-- Resend's own ground-truth usage, read off the send API's response headers
-- (x-resend-monthly-quota — all plans; x-resend-daily-quota — free plan only,
-- per Resend's docs). Nullable: most rows won't have it (header absent, or
-- this migration predates the row). We only ever need the MOST RECENT
-- non-null value of each, so storing it per-row (rather than a separate
-- single-row table) is enough — "latest row where the column isn't null"
-- is one query, and it stays chronologically self-documenting. This is what
-- closes the seeding gap: email_send_log starts empty on deploy, but Resend's
-- own counters already reflect any pre-existing/dashboard/off-log sends, so
-- once we've made even one send post-deploy we have ground truth again.
alter table public.email_send_log add column if not exists resend_reported_daily bigint;
alter table public.email_send_log add column if not exists resend_reported_monthly bigint;

-- Both quota queries filter on sent_at alone (trailing 24h / current month).
create index if not exists email_send_log_sent_at_idx
  on public.email_send_log (sent_at);

alter table public.email_send_log enable row level security;
-- No policies on purpose: deny-all to clients; service-role only.

comment on table public.email_send_log is
  'Global Resend send meter — one row per successful email handed to Resend, plus Resend''s own reported daily/monthly quota (from response headers) on the most recent row that has it. Read/written only by the service-role backend (api/_email.js soft caps 90/day, 2700/month under the Resend plan''s 100/3000). Client-inaccessible (no RLS policies). See supabase/email_send_log.sql.';
