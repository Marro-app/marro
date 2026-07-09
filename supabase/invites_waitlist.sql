-- ───────────────────────────────────────────────────────────────────────────
-- Marro · invite codes + waitlist + admin (Phase 1 — growth system)
-- ───────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Turns the dead-end "invite-only" gate into a real growth loop:
--     • single-use invite codes members share (quota 5 regular / 15 ambassador)
--     • an in-app waitlist for people without a code
--     • an admin console (backed by api/admin.js + the service-role key)
--   Redeeming a valid code adds the redeemer's email to public.allowed_emails
--   (the existing closed-beta gate — see supabase/allowed_emails.sql), which is
--   what actually unlocks the app.
--
-- SECURITY MODEL (read before editing — the whole point of this file)
--   The client ships a PUBLIC anon key, so RLS is the ONLY thing protecting data
--   (CLAUDE.md rule 4). The ensure_rls event trigger auto-ENABLES RLS on every new
--   public table, but a table with RLS on and NO policies is deny-all — so every
--   table below gets EXPLICIT policies (or is deliberately left client-inaccessible
--   and touched only through SECURITY DEFINER functions / the service-role backend).
--
--   Generation, redemption, and quota are NOT client-writable operations: they run
--   inside SECURITY DEFINER functions so the DB — not the browser — enforces quota,
--   single-use, atomicity, and the brute-force lockout. Regular users literally
--   cannot INSERT/UPDATE invite_codes, user_roles, admins, or invite_attempts.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run AFTER
-- supabase/notifications.sql (redeem_invite_code below calls public.notify()
-- and deletes the redeemer's waitlist row, both defined there). Idempotent.
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. invite_codes ───────────────────────────────────────────────────────────
--     One row per code. Single-use: a code is claimed by exactly one redeemer
--     (redeemed_at set once, atomically — the durable "used" marker; see the
--     C1 fix note on redeem_invite_code below). revoked_at "cancels" a still-
--     unused code and frees the owner's invite count back up.
--     issued_by_admin: true for codes minted from the admin console
--     (api/admin.js generate_codes) — these do NOT count against the minting
--     admin's personal referral invites and are excluded from their "Invite
--     friends" list (audit H4). archived_at: an admin can archive ANY code —
--     unused, used, or revoked — to hide it from the default console view
--     (feature request; originally restricted to revoked-only, widened by an
--     admin console fix). Purely a visibility flag: it never touches
--     redeemed_at/revoked_at, so archiving can't un-redeem a single-use code
--     or resurrect a revoked one. See archive_code in api/admin.js.
create table if not exists public.invite_codes (
  code             text primary key check (code = upper(code)),   -- stored UPPER, unambiguous alphabet
  owner_id         uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  redeemed_by      uuid references auth.users(id) on delete set null,
  redeemed_email   text,
  redeemed_at      timestamptz,
  revoked_at       timestamptz,
  issued_by_admin  boolean not null default false,
  archived_at      timestamptz,
  -- bound_email: when set, ONLY this email may redeem the code. Used for
  -- admin-targeted invites (invite_from_waitlist) so a code emailed to a
  -- specific person can't be redeemed by anyone else who gets hold of it.
  -- NULL = unbound/shareable (normal member-generated codes stay this way).
  -- ALSO reused by the member-facing "email this code" flow (api/send-invite.js):
  -- the first time a member emails one of their own codes, that recipient's
  -- email is written here too, so a resend targets the SAME person and the
  -- code becomes unredeemable by anyone else (bug fix — a code could
  -- previously be re-sent to a different person than the one it was first
  -- promised to). last_sent_at is the companion "when did we last email it"
  -- timestamp, shown in the resend-confirmation UI.
  bound_email      text,
  last_sent_at     timestamptz
);
alter table public.invite_codes add column if not exists issued_by_admin boolean not null default false;
alter table public.invite_codes add column if not exists archived_at timestamptz;
alter table public.invite_codes add column if not exists bound_email text;
alter table public.invite_codes add column if not exists last_sent_at timestamptz;
create index if not exists invite_codes_owner_idx on public.invite_codes(owner_id);
create index if not exists invite_codes_bound_email_idx on public.invite_codes(bound_email);
comment on table public.invite_codes is
  'Single-use invite codes. Owners SELECT their own (RLS); generation/redemption/revocation go through SECURITY DEFINER RPCs / api/admin.js. redeemed_at (not redeemed_by) is the durable "used" marker — see C1 fix in redeem_invite_code(). See supabase/invites_waitlist.sql.';

-- 1b. waitlist ───────────────────────────────────────────────────────────────
--     A signed-in but non-allowlisted user who has no code can join here. One
--     row per user (user_id PK ⇒ re-joining is idempotent). invited_at is
--     stamped when an admin sends this person a code from the console
--     (invite_from_waitlist) — the row is kept (not deleted) so the admin can
--     still see who's already been reached out to; remove_from_waitlist is the
--     separate, explicit "drop them" action.
create table if not exists public.waitlist (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  reason     text,
  created_at timestamptz not null default now(),
  invited_at timestamptz,           -- FIRST time an admin sent this person a code (never re-clobbered)
  invite_count integer not null default 0,  -- how many times invited (re-invites included)
  last_invited_at timestamptz       -- most recent invite send
);
alter table public.waitlist add column if not exists invited_at timestamptz;
alter table public.waitlist add column if not exists invite_count integer not null default 0;
alter table public.waitlist add column if not exists last_invited_at timestamptz;
comment on table public.waitlist is
  'In-app beta waitlist. Users insert/select their own row (RLS); admins read/manage all via api/admin.js (service role). See supabase/invites_waitlist.sql.';

-- 1c. user_roles ─────────────────────────────────────────────────────────────
--     Per-user ambassador flag + optional invite-limit override. Keyed by
--     EMAIL (like allowed_emails/admins) so an admin can set a role by email
--     without needing the user's uid. NOT client-writable — a user could
--     otherwise inflate their own invite limit. Written only by api/admin.js
--     (service role); read by the SECURITY DEFINER invite-limit function and
--     (own row only) by the client. note/school are admin-only free-text
--     context (e.g. "runs the Cornell class GroupMe") for the ambassador
--     roster — never shown to the ambassador themselves.
create table if not exists public.user_roles (
  email         text primary key check (email = lower(email)),
  is_ambassador boolean not null default false,
  quota_override integer check (quota_override is null or quota_override >= 0),
  note          text,
  school        text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);
alter table public.user_roles add column if not exists note text;
alter table public.user_roles add column if not exists school text;
comment on table public.user_roles is
  'Ambassador flag + optional invite-limit override, keyed by email. Admin-managed (api/admin.js); NOT client-writable (users must not inflate their own limit). See supabase/invites_waitlist.sql.';

-- 1d. admins ─────────────────────────────────────────────────────────────────
--     The admin allowlist (who can see the admin console + call api/admin.js).
--     Private: no client policies at all. Read via the is_admin() SECURITY
--     DEFINER RPC (own-status only) and the service-role backend. An existing
--     admin grants/revokes others through the console (api/admin.js).
create table if not exists public.admins (
  email      text primary key check (email = lower(email)),
  added_by   text,
  created_at timestamptz not null default now()
);
comment on table public.admins is
  'Admin allowlist. Private (no client RLS policies); checked via is_admin() and the service-role backend. Bootstrapped with the owner; admins add/remove others via api/admin.js. See supabase/invites_waitlist.sql.';

-- 1e. invite_attempts ────────────────────────────────────────────────────────
--     Every FAILED redemption is logged here so redeem_invite_code() can throttle
--     brute-forcing of the short codes (and enumeration of used codes). No client
--     policies — written and read only by the redeem RPC (SECURITY DEFINER) and
--     the service-role backend.
create table if not exists public.invite_attempts (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_tried text,
  outcome    text,          -- 'invalid' | 'already_used' | 'revoked' | 'wrong_email'
  created_at timestamptz not null default now()
);
create index if not exists invite_attempts_user_time_idx
  on public.invite_attempts(user_id, created_at);
comment on table public.invite_attempts is
  'Failed invite-redemption attempts, for the brute-force lockout in redeem_invite_code(). Client-inaccessible (no RLS policies). See supabase/invites_waitlist.sql.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ROW LEVEL SECURITY
--    ensure_rls already enabled RLS on these tables; the alters below are
--    idempotent belt-and-suspenders. Policies define the ONLY client access.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.invite_codes    enable row level security;
alter table public.waitlist        enable row level security;
alter table public.user_roles      enable row level security;
alter table public.admins          enable row level security;
alter table public.invite_attempts enable row level security;

-- invite_codes: an owner may READ their own codes (to show them + status in the
-- referral UI). No client insert/update/delete — those go through the RPCs /
-- backend, which is what lets the DB enforce quota, single-use, and revocation.
drop policy if exists "select own codes" on public.invite_codes;
create policy "select own codes" on public.invite_codes
  for select using (auth.uid() = owner_id);

-- waitlist: a user may add and read ONLY their own row. No update/delete (admins
-- manage removals via the service-role backend).
drop policy if exists "insert own waitlist" on public.waitlist;
create policy "insert own waitlist" on public.waitlist
  for insert with check (auth.uid() = user_id);

drop policy if exists "select own waitlist" on public.waitlist;
create policy "select own waitlist" on public.waitlist
  for select using (auth.uid() = user_id);

-- user_roles: a user may READ their own role row (so the referral UI can show
-- "ambassador" / their quota). Deliberately NO insert/update/delete policy —
-- quota is not self-editable.
drop policy if exists "select own role" on public.user_roles;
create policy "select own role" on public.user_roles
  for select using (email = lower(auth.jwt() ->> 'email'));

-- admins + invite_attempts: NO client policies. Deny-all to anon/authenticated;
-- reachable only via SECURITY DEFINER functions and the service-role key.


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. FUNCTIONS (SECURITY DEFINER — run as owner, bypass RLS)
--    Each pins search_path=public and is granted ONLY to authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. is_admin() — is the current user an admin? (drives console visibility;
--     the backend re-checks server-side, so this is UX, not the security border)
create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.admins
    where email = lower(auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 3b. my_invite_quota() — effective invite limit for the current user:
--     admins get a large sentinel (effectively unlimited — audit H4, feature
--     "admin invites should reflect admin status"), else explicit override,
--     else 15 for ambassadors, else 5. Name kept (client already calls it);
--     conceptually this is now "my invite limit," not a hard resource quota.
create or replace function public.my_invite_quota()
returns integer
language sql security definer set search_path = public stable
as $$
  select case when public.is_admin() then 1000000 else coalesce(
    (select quota_override from public.user_roles
       where email = lower(auth.jwt() ->> 'email')),
    case when coalesce(
           (select is_ambassador from public.user_roles
              where email = lower(auth.jwt() ->> 'email')), false)
         then 15 else 5 end
  ) end;
$$;
revoke all on function public.my_invite_quota() from public;
grant execute on function public.my_invite_quota() to authenticated;

-- 3c. gen_code_string(n) — n random chars from an unambiguous, human-typeable
--     alphabet (no 0/O/1/I/L). Internal helper; not granted to clients.
create or replace function public.gen_code_string(n integer)
returns text
language plpgsql volatile set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 30 chars, no 0/O/1/I/L
  result text := '';
  i integer;
begin
  for i in 1..n loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;
revoke all on function public.gen_code_string(integer) from public;

-- 3d. generate_invite_code() — issue one PERSONAL code for the current user,
--     if under their invite limit. Returns {status:'ok', code} or
--     {status:'quota_exhausted', quota}. Revoked codes do NOT count against
--     the limit (freed back up); neither do admin-console-minted codes
--     (issued_by_admin — audit H4, they're a separate bucket, see 3f).
create or replace function public.generate_invite_code()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_quota int := public.my_invite_quota();
  v_used  int;
  v_code  text;
begin
  select count(*) into v_used
    from public.invite_codes
   where owner_id = auth.uid() and revoked_at is null and issued_by_admin = false;

  if v_used >= v_quota then
    return jsonb_build_object('status', 'quota_exhausted', 'quota', v_quota);
  end if;

  -- Generate a unique code, retrying on the (rare) collision.
  loop
    v_code := public.gen_code_string(8);
    begin
      insert into public.invite_codes(code, owner_id) values (v_code, auth.uid());
      exit;
    exception when unique_violation then
      -- collision: loop and try another
    end;
  end loop;

  return jsonb_build_object('status', 'ok', 'code', v_code);
end;
$$;
revoke all on function public.generate_invite_code() from public;
grant execute on function public.generate_invite_code() to authenticated;

-- 3f. revoke_own_code(p_code) — a member/ambassador revokes their OWN unused
--     code (feature: "if an ambassador revokes an unused code they get the
--     credit back" — automatic, since generate_invite_code() only counts
--     non-revoked codes). Scoped to owner_id = auth.uid() so nobody can revoke
--     someone else's code; scoped to redeemed_at is null so a used code (once
--     someone has joined through it) can't be un-shared out from under them.
--     Returns {status:'ok'} or {status:'not_found'}.
create or replace function public.revoke_own_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  update public.invite_codes
     set revoked_at = now()
   where code = v_code
     and owner_id = auth.uid()
     and redeemed_at is null
     and revoked_at is null;

  if found then
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;
revoke all on function public.revoke_own_code(text) from public;
grant execute on function public.revoke_own_code(text) to authenticated;

-- 3e. redeem_invite_code(p_code) — THE CRITICAL ONE.
--     Returns one of: {status:'ok'} | 'already_used' | 'revoked' | 'wrong_email' | 'invalid' | 'locked'.
--
--     • Atomic claim (no TOCTOU race): the single UPDATE ... WHERE redeemed_at
--       IS NULL AND revoked_at IS NULL RETURNING is the only place a code flips
--       from unused→used, so two concurrent redeemers can never both win one code.
--     • C1 SECURITY FIX (audit): the claim guard is redeemed_at IS NULL, NOT
--       redeemed_by IS NULL. redeemed_by is `on delete set null` (see
--       invite_codes) — if the redeemer later deletes their account, redeemed_by
--       goes back to NULL but redeemed_at never does. Guarding on redeemed_by
--       would let a deleted redeemer's single-use code become claimable again
--       (a second person could redeem the same code). redeemed_at is the
--       durable "used" marker; codeStatus() on the client must key off it too.
--     • Brute-force lockout: ≥10 failed attempts in the last hour ⇒ 'locked'.
--     • Error granularity (locked product spec): a used code returns the SPECIFIC
--       'already_used' (so the redeemer knows to ask their inviter for a fresh
--       one); everything else is generic. Every failure is logged to
--       invite_attempts, so even the informative 'already_used' path is throttled
--       against code enumeration.
--     • On success: notifies the code's owner ("someone you invited joined")
--       unless the code was admin-issued (avoid noise for bulk console codes),
--       and clears the redeemer's own waitlist row if they'd joined it (audit
--       M1 — they're in now, no longer waiting).
create or replace function public.redeem_invite_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_code        text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email       text := lower(auth.jwt() ->> 'email');
  v_owner       uuid;
  v_admin_code  boolean;
  v_fails       int;
  v_redeemed_at timestamptz;
  v_revoked     timestamptz;
  v_bound_email text;
  v_exists      boolean;
begin
  if v_email is null or v_code = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- (0) Brute-force lockout.
  select count(*) into v_fails
    from public.invite_attempts
   where user_id = auth.uid()
     and created_at > now() - interval '1 hour';
  if v_fails >= 10 then
    return jsonb_build_object('status', 'locked');
  end if;

  -- (1) Atomic single-use claim. Only one caller can win an unused, un-revoked code.
  update public.invite_codes
     set redeemed_by = auth.uid(), redeemed_email = v_email, redeemed_at = now()
   where code = v_code
     and redeemed_at is null
     and revoked_at is null
     and (bound_email is null or bound_email = v_email)
  returning owner_id, issued_by_admin into v_owner, v_admin_code;

  if found then
    -- (2) Success ⇒ add to the beta allowlist (this unlocks the app).
    insert into public.allowed_emails(email, note, invited_by)
      values (v_email, 'invite code ' || v_code, v_owner)
      on conflict (email) do nothing;

    -- (2b) Notify the inviter, unless this was a bulk admin-issued code.
    if not coalesce(v_admin_code, false) then
      perform public.notify(
        (select email from auth.users where id = v_owner),
        'invite_joined',
        'Someone you invited just joined Marro.',
        jsonb_build_object('code', v_code));
    end if;

    -- (2c) The redeemer is in now — clear them off the waitlist if present.
    delete from public.waitlist where user_id = auth.uid();

    return jsonb_build_object('status', 'ok');
  end if;

  -- (3) Claim failed — classify why, log the attempt (throttling), return status.
  --     Order matters: a used/revoked code is reported as such regardless of
  --     binding (those states are terminal); only a still-live code that failed
  --     purely because it's bound to a different email returns 'wrong_email'.
  --     If the code doesn't exist at all, both timestamps stay null and
  --     v_bound_email/v_exists tell invalid apart from a bound mismatch.
  select true, redeemed_at, revoked_at, bound_email
    into v_exists, v_redeemed_at, v_revoked, v_bound_email
    from public.invite_codes where code = v_code;

  if v_redeemed_at is not null then
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'already_used');
    return jsonb_build_object('status', 'already_used');   -- SPECIFIC (per spec)
  elsif v_revoked is not null then
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'revoked');
    return jsonb_build_object('status', 'revoked');        -- generic in UI
  elsif coalesce(v_exists, false) and v_bound_email is not null and v_bound_email <> v_email then
    -- Code is live and unrevoked, but reserved for a different email.
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'wrong_email');
    return jsonb_build_object('status', 'wrong_email');    -- generic in UI
  else
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'invalid');
    return jsonb_build_object('status', 'invalid');        -- generic in UI
  end if;
end;
$$;
revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- 3g. email_has_account(p_email) — server-side check used by api/send-invite.js
--     (bug fix: emailing an invite code to someone who already has a Marro
--     account should be blocked, not silently sent). Checks the authoritative
--     source — a real auth.users row — via SECURITY DEFINER since auth.users
--     isn't otherwise reachable from PostgREST. Deliberately granted ONLY to
--     service_role: exposing "does this email have an account" to any signed-in
--     client would be an email-enumeration privacy leak, and the only caller
--     that needs it is the server-side send-invite handler (which already
--     holds the service-role key).
create or replace function public.email_has_account(p_email text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(coalesce(p_email, ''))
  );
$$;
revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEED — bootstrap the first admin (the owner Google account). An existing
--    admin adds the co-founder / others from the console (api/admin.js add_admin).
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.admins(email, added_by)
values ('jawadhijazi7@gmail.com', 'seed')
on conflict (email) do nothing;
