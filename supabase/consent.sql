-- Consent-capture columns on profiles (clickwrap record of Terms/Privacy acceptance).
--
-- Added 2026-08-02 alongside the legal-docs overhaul (comprehensive Terms with an
-- arbitration clause + minimum age lowered to 13 with parental consent for minors).
-- We store which Terms version the user agreed to, when, and whether a parent/guardian
-- attested on behalf of a minor. This is the evidence that makes the arbitration
-- clause and the minor parental-consent enforceable.
--
-- These are new columns on an EXISTING table, so the existing profiles RLS policies
-- (insert own profile / update own profile, both auth.uid() = user_id — see
-- app_state_profiles_rls.sql) already cover reads and writes. No new policies needed.
-- Idempotent: safe to re-run.

alter table public.profiles add column if not exists terms_version    text;
alter table public.profiles add column if not exists terms_agreed_at  timestamptz;
alter table public.profiles add column if not exists guardian_attested boolean not null default false;
