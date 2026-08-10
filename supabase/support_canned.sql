-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — canned replies (Slice 14, plan §13)
-- ═══════════════════════════════════════════════════════════════════════════
-- Saved responses for FAQs, shared between admins. Service-role only (RLS on,
-- NO client policies) — reached through api/support.js like everything else
-- admin-side.
-- HOW TO RUN: Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.support_canned_replies (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
comment on table public.support_canned_replies is
  'Shared canned support replies. Service-role only: RLS on, no client policies. See supabase/support_canned.sql.';

alter table public.support_canned_replies enable row level security;
-- Intentionally NO policies (deny-all to anon/authenticated).
