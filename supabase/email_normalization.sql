-- ───────────────────────────────────────────────────────────────────────────
-- Marro · email normalization + duplicate-account prevention
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Closes a sub-addressing loophole: mail providers that support "+tag"
--   addressing (RFC 5233 — Gmail, Outlook, Yahoo, FastMail, iCloud, and any
--   Google Workspace domain, which almost certainly includes .edu addresses
--   like chapman.edu) treat you+1@x.com, you+2@x.com, you+3@x.com... as the
--   SAME inbox, but Supabase Auth treats them as completely distinct emails —
--   so without this, one person could spin up unlimited separate Marro
--   accounts under one real inbox. Gmail/Workspace specifically also ignores
--   dots in the local part (j.doe@gmail.com == jdoe@gmail.com), a second,
--   related trick.
--
--   Enforced at account-CREATION time via Supabase's "Before User Created"
--   Auth Hook, which runs for every new signup (password AND Google OAuth)
--   before the auth.users row is committed. Legitimate Supabase auto-linking
--   (same VERIFIED raw email across providers, see docs/DATA_MODEL.md → Auth)
--   is untouched — that path attaches an identity to an EXISTING user and
--   never creates a new one, so this hook never even runs for it.
--
--   Deliberately scoped to blocking duplicate ACCOUNT CREATION only — not
--   retrofitted into the allowlist/invite/waitlist RPCs (supabase/
--   allowed_emails.sql, supabase/invites_waitlist.sql). Since no second
--   account can ever exist once this hook is live, those checks can't be
--   gamed via a plus-tag/dot variant either; no need to touch working code.
--
-- FAIL-OPEN BY DESIGN
--   The hook function catches any unexpected error and allows the signup
--   through rather than risk blocking real signups app-wide over a bug in
--   this logic — the cost of a rare double-account slipping through is far
--   lower than the cost of another live signup outage.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
--   Sections 1-3 create/replace the functions (safe to run anytime).
--   Section 4 (enabling the hook itself) is done separately via the
--   Management API / dashboard Auth Hooks settings, NOT by this file.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Normalization helper — reused by the hook below. ────────────────────────
-- Strips +tag (all providers) and, for Gmail/Google Workspace domains only,
-- strips dots too (Gmail-specific — NOT safe to apply to arbitrary domains,
-- where a dot in the local part can be a genuinely distinct mailbox).
create or replace function public.normalize_email(raw_email text)
returns text
language plpgsql
immutable
as $$
declare
  local_part text;
  domain_part text;
begin
  if raw_email is null or position('@' in raw_email) = 0 then
    return lower(coalesce(raw_email, ''));
  end if;
  local_part := split_part(lower(raw_email), '@', 1);
  domain_part := split_part(lower(raw_email), '@', 2);
  local_part := split_part(local_part, '+', 1); -- RFC 5233 sub-addressing
  if domain_part in ('gmail.com', 'googlemail.com') then
    local_part := replace(local_part, '.', ''); -- Gmail/Workspace-specific
  end if;
  return local_part || '@' || domain_part;
end;
$$;

comment on function public.normalize_email(text) is
  'Normalizes an email for duplicate-account detection: strips +tag addressing, and (Gmail/Workspace domains only) insignificant dots. See supabase/email_normalization.sql.';

-- 2. The hook itself. ──────────────────────────────────────────────────────
-- Contract (Supabase "Before User Created" Postgres hook): takes one `event
-- jsonb` argument, returns `{}` to allow or `{"error":{"http_code":...,
-- "message":...}}` to reject. event->'user'->>'email' is the incoming email;
-- event->'user'->>'id' is the pre-assigned id of the user ABOUT to be
-- created (may be absent — guarded below, not assumed present).
create or replace function public.hook_reject_duplicate_normalized_email(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  new_email text;
  normalized text;
  already_exists boolean;
begin
  new_id := nullif(event->'user'->>'id', '')::uuid;
  new_email := event->'user'->>'email';

  if new_email is null or new_email = '' then
    return jsonb_build_object(); -- no email on this identity (e.g. phone) — nothing to check
  end if;

  normalized := public.normalize_email(new_email);

  select exists(
    select 1 from auth.users u
    where (new_id is null or u.id <> new_id)
      and public.normalize_email(u.email) = normalized
  ) into already_exists;

  if already_exists then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'An account already exists for this email address. Try signing in instead.'
      )
    );
  end if;

  return jsonb_build_object();
exception
  when others then
    -- Fail OPEN — see header. A bug here should never be able to block a
    -- real signup app-wide.
    return jsonb_build_object();
end;
$$;

comment on function public.hook_reject_duplicate_normalized_email(jsonb) is
  'Supabase "Before User Created" Auth Hook — rejects a new signup whose normalized email (see normalize_email()) matches an existing account. Registered via hook_before_user_created_uri = pg-functions://postgres/public/hook_reject_duplicate_normalized_email. See supabase/email_normalization.sql.';

-- 3. Permissions — supabase_auth_admin is the role GoTrue uses to call hooks. ─
grant execute on function public.normalize_email(text) to supabase_auth_admin;
grant execute on function public.hook_reject_duplicate_normalized_email(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_reject_duplicate_normalized_email(jsonb) from authenticated, anon, public;

-- 4. Enabling the hook (NOT run by this file — reference only) ──────────────
--   hook_before_user_created_enabled = true
--   hook_before_user_created_uri     = 'pg-functions://postgres/public/hook_reject_duplicate_normalized_email'
--   Set via the Supabase Management API (send the FULL auth config, not a
--   partial patch — see docs/PRODUCT_DECISIONS.md, 2026-08-12, for why a
--   partial PATCH to this endpoint is dangerous) or Studio → Authentication →
--   Hooks (Postgres function option).
