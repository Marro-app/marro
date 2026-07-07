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
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. invite_codes ───────────────────────────────────────────────────────────
--     One row per code. Single-use: a code is claimed by exactly one redeemer
--     (redeemed_by set once, atomically). revoked_at "cancels" a still-unused
--     code and frees the owner's quota back up.
create table if not exists public.invite_codes (
  code           text primary key check (code = upper(code)),   -- stored UPPER, unambiguous alphabet
  owner_id       uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  redeemed_by    uuid references auth.users(id) on delete set null,
  redeemed_email text,
  redeemed_at    timestamptz,
  revoked_at     timestamptz
);
create index if not exists invite_codes_owner_idx on public.invite_codes(owner_id);
comment on table public.invite_codes is
  'Single-use invite codes. Owners SELECT their own (RLS); generation/redemption/revocation go through SECURITY DEFINER RPCs / api/admin.js. See supabase/invites_waitlist.sql.';

-- 1b. waitlist ───────────────────────────────────────────────────────────────
--     A signed-in but non-allowlisted user who has no code can join here. One
--     row per user (user_id PK ⇒ re-joining is idempotent).
create table if not exists public.waitlist (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  reason     text,
  created_at timestamptz not null default now()
);
comment on table public.waitlist is
  'In-app beta waitlist. Users insert/select their own row (RLS); admins read all via api/admin.js (service role). See supabase/invites_waitlist.sql.';

-- 1c. user_roles ─────────────────────────────────────────────────────────────
--     Per-user ambassador flag + optional quota override. Keyed by EMAIL (like
--     allowed_emails/admins) so an admin can set a role by email without needing
--     the user's uid. NOT client-writable — a user could otherwise inflate their
--     own quota. Written only by api/admin.js (service role); read by the
--     SECURITY DEFINER quota function and (own row only) by the client.
create table if not exists public.user_roles (
  email         text primary key check (email = lower(email)),
  is_ambassador boolean not null default false,
  quota_override integer check (quota_override is null or quota_override >= 0),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
comment on table public.user_roles is
  'Ambassador flag + optional invite-quota override, keyed by email. Admin-managed (api/admin.js); NOT client-writable (users must not inflate their own quota). See supabase/invites_waitlist.sql.';

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
  outcome    text,          -- 'invalid' | 'already_used' | 'revoked'
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

-- 3b. my_invite_quota() — effective quota for the current user:
--     explicit override, else 15 for ambassadors, else 5.
create or replace function public.my_invite_quota()
returns integer
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select quota_override from public.user_roles
       where email = lower(auth.jwt() ->> 'email')),
    case when coalesce(
           (select is_ambassador from public.user_roles
              where email = lower(auth.jwt() ->> 'email')), false)
         then 15 else 5 end
  );
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

-- 3d. generate_invite_code() — issue one code for the current user, if under
--     quota. Returns {status:'ok', code} or {status:'quota_exhausted', quota}.
--     Revoked codes do NOT count against quota (freed back up).
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
   where owner_id = auth.uid() and revoked_at is null;

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

-- 3e. redeem_invite_code(p_code) — THE CRITICAL ONE.
--     Returns one of: {status:'ok'} | 'already_used' | 'revoked' | 'invalid' | 'locked'.
--
--     • Atomic claim (no TOCTOU race): the single UPDATE ... WHERE redeemed_by
--       IS NULL AND revoked_at IS NULL RETURNING is the only place a code flips
--       from unused→used, so two concurrent redeemers can never both win one code.
--     • Brute-force lockout: ≥10 failed attempts in the last hour ⇒ 'locked'.
--     • Error granularity (locked product spec): a used code returns the SPECIFIC
--       'already_used' (so the redeemer knows to ask their inviter for a fresh
--       one); everything else is generic. Every failure is logged to
--       invite_attempts, so even the informative 'already_used' path is throttled
--       against code enumeration.
create or replace function public.redeem_invite_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_code        text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email       text := lower(auth.jwt() ->> 'email');
  v_owner       uuid;
  v_fails       int;
  v_redeemed_by uuid;
  v_revoked     timestamptz;
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
     and redeemed_by is null
     and revoked_at is null
  returning owner_id into v_owner;

  if found then
    -- (2) Success ⇒ add to the beta allowlist (this unlocks the app).
    insert into public.allowed_emails(email, note, invited_by)
      values (v_email, 'invite code ' || v_code, v_owner)
      on conflict (email) do nothing;
    return jsonb_build_object('status', 'ok');
  end if;

  -- (3) Claim failed — classify why, log the attempt (throttling), return status.
  select redeemed_by, revoked_at into v_redeemed_by, v_revoked
    from public.invite_codes where code = v_code;

  if v_redeemed_by is not null then
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'already_used');
    return jsonb_build_object('status', 'already_used');   -- SPECIFIC (per spec)
  elsif v_revoked is not null then
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'revoked');
    return jsonb_build_object('status', 'revoked');        -- generic in UI
  else
    insert into public.invite_attempts(user_id, code_tried, outcome)
      values (auth.uid(), v_code, 'invalid');
    return jsonb_build_object('status', 'invalid');        -- generic in UI
  end if;
end;
$$;
revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEED — bootstrap the first admin (the owner Google account). An existing
--    admin adds the co-founder / others from the console (api/admin.js add_admin).
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.admins(email, added_by)
values ('jawadhijazi7@gmail.com', 'seed')
on conflict (email) do nothing;
