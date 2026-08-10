-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — proactive nudges (Slice 13, plan §12)
-- ═══════════════════════════════════════════════════════════════════════════
-- Admin-initiated outreach with the "still relevant?" gate: a nudge is HELD
-- (state 'scheduled') until due, then the recheck condition is re-evaluated —
-- if it no longer holds (e.g. the user already wrote in), the nudge
-- auto-cancels instead of sending. Delivery = the existing in-app
-- user_notifications pipeline. Evaluation runs lazily from api/support.js
-- (same pattern as the slice-7 sweep — no cron infra yet).
--
-- SECURITY: service-role only. RLS on, NO client policies (deny-all) — like
-- support_events. Admins reach it through api/support.js.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.support_nudges (
  id                uuid primary key default gen_random_uuid(),
  created_by        text not null,          -- admin email
  target_email      text not null check (target_email = lower(target_email)),
  body              text not null,
  trigger_kind      text not null default 'manual',   -- 'manual' now; detector kinds later
  state             text not null default 'scheduled'
                      check (state in ('scheduled','sent','cancelled')),
  recheck_condition jsonb,                  -- e.g. {"type":"no_open_support_thread"}
  send_after        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  cancelled_reason  text
);
comment on table public.support_nudges is
  'Proactive support nudges with the still-relevant gate (plan §12). Service-role only: RLS on, no client policies. Evaluated lazily by api/support.js; delivered via user_notifications.';

create index if not exists support_nudges_due_idx on public.support_nudges (state, send_after);
create index if not exists support_nudges_target_idx on public.support_nudges (target_email, sent_at desc);

alter table public.support_nudges enable row level security;
-- Intentionally NO policies (deny-all to anon/authenticated).

-- VERIFY: as any signed-in user, `select count(*) from support_nudges` → error/0 rows.
