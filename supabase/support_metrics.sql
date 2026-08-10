-- ═══════════════════════════════════════════════════════════════════════════
-- Marro · Support chat — metrics RPCs (Slice 12, plan §13.5)
-- ═══════════════════════════════════════════════════════════════════════════
-- The Support Metrics view, built like the Usage dashboard: SECURITY DEFINER
-- functions that check is_admin() themselves and return AGGREGATES ONLY —
-- a non-admin/signed-out caller gets zero rows, never an error and never raw
-- data. Sources: support_conversations lifecycle timestamps + support_events.
-- p_days bounds the window (created_at >= now() - p_days); the aging list is
-- live (current state), not windowed.
--
-- HOW TO RUN: paste into Supabase Studio → SQL Editor → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- A · headline speed + volume numbers for stat tiles.
create or replace function public.support_metrics_overview(p_days integer default 30)
returns table (
  new_conversations       bigint,
  open_backlog            bigint,   -- live: new/open/waiting/snoozed right now
  deferred_unanswered     bigint,   -- live: still no first admin reply
  reopened                bigint,   -- windowed: threads with reopen_count > 0
  median_first_response_s double precision,
  p90_first_response_s    double precision,
  median_resolution_s     double precision,
  p90_resolution_s        double precision,
  median_claim_s          double precision
)
language sql security definer set search_path = public stable
as $$
  select
    (select count(*) from support_conversations
      where created_at >= now() - make_interval(days => p_days)),
    (select count(*) from support_conversations
      where status in ('new','open','waiting_user','snoozed')),
    (select count(*) from support_conversations
      where status in ('new','open') and first_response_at is null),
    (select count(*) from support_conversations
      where created_at >= now() - make_interval(days => p_days) and reopen_count > 0),
    (select percentile_cont(0.5) within group (order by extract(epoch from (first_response_at - created_at)))
       from support_conversations
      where first_response_at is not null and created_at >= now() - make_interval(days => p_days)),
    (select percentile_cont(0.9) within group (order by extract(epoch from (first_response_at - created_at)))
       from support_conversations
      where first_response_at is not null and created_at >= now() - make_interval(days => p_days)),
    (select percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)))
       from support_conversations
      where resolved_at is not null and created_at >= now() - make_interval(days => p_days)),
    (select percentile_cont(0.9) within group (order by extract(epoch from (resolved_at - created_at)))
       from support_conversations
      where resolved_at is not null and created_at >= now() - make_interval(days => p_days)),
    (select percentile_cont(0.5) within group (order by extract(epoch from (claimed_at - created_at)))
       from support_conversations
      where claimed_at is not null and created_at >= now() - make_interval(days => p_days))
  where public.is_admin();
$$;
revoke all on function public.support_metrics_overview(integer) from public, anon;
grant execute on function public.support_metrics_overview(integer) to authenticated;

-- C · per-admin share of load ("who's responding").
create or replace function public.support_metrics_by_admin(p_days integer default 30)
returns table (
  admin_email  text,
  handled      bigint,   -- conversations claimed by them in the window
  replies      bigint,   -- replied events
  resolved     bigint,
  csat_up      bigint,
  csat_down    bigint
)
language sql security definer set search_path = public stable
as $$
  select
    c.assigned_admin,
    count(*) filter (where c.claimed_at >= now() - make_interval(days => p_days)),
    (select count(*) from support_events e
      where e.admin_email = c.assigned_admin and e.action = 'replied'
        and e.at >= now() - make_interval(days => p_days)),
    count(*) filter (where c.resolved_by = c.assigned_admin
        and c.resolved_at >= now() - make_interval(days => p_days)),
    count(*) filter (where c.csat = 'up'
        and c.created_at >= now() - make_interval(days => p_days)),
    count(*) filter (where c.csat = 'down'
        and c.created_at >= now() - make_interval(days => p_days))
  from support_conversations c
  where c.assigned_admin is not null and public.is_admin()
  group by c.assigned_admin
  order by 2 desc;
$$;
revoke all on function public.support_metrics_by_admin(integer) from public, anon;
grant execute on function public.support_metrics_by_admin(integer) to authenticated;

-- A · live aging watchlist: active threads still waiting on us, oldest first.
create or replace function public.support_aging()
returns table (
  conversation_id uuid,
  subject         text,
  type            text,
  status          text,
  assigned_admin  text,
  waiting_since   timestamptz
)
language sql security definer set search_path = public stable
as $$
  select id, subject, type, status, assigned_admin, created_at
  from support_conversations
  where status in ('new','open') and first_response_at is null
    and public.is_admin()
  order by created_at asc
  limit 20;
$$;
revoke all on function public.support_aging() from public, anon;
grant execute on function public.support_aging() to authenticated;

-- D · volume by type + daily counts (feeds the type bars + 14-day sparkline).
create or replace function public.support_volume_by_type(p_days integer default 30)
returns table (type text, total bigint, resolved bigint)
language sql security definer set search_path = public stable
as $$
  select type, count(*), count(*) filter (where resolved_at is not null)
  from support_conversations
  where created_at >= now() - make_interval(days => p_days) and public.is_admin()
  group by type order by 2 desc;
$$;
revoke all on function public.support_volume_by_type(integer) from public, anon;
grant execute on function public.support_volume_by_type(integer) to authenticated;

create or replace function public.support_daily_volume(p_days integer default 14)
returns table (day date, total bigint)
language sql security definer set search_path = public stable
as $$
  select date_trunc('day', created_at)::date, count(*)
  from support_conversations
  where created_at >= now() - make_interval(days => p_days) and public.is_admin()
  group by 1 order by 1;
$$;
revoke all on function public.support_daily_volume(integer) from public, anon;
grant execute on function public.support_daily_volume(integer) to authenticated;

-- E · overall satisfaction.
create or replace function public.support_csat_summary(p_days integer default 90)
returns table (up_count bigint, down_count bigint)
language sql security definer set search_path = public stable
as $$
  select count(*) filter (where csat = 'up'), count(*) filter (where csat = 'down')
  from support_conversations
  where created_at >= now() - make_interval(days => p_days) and public.is_admin();
$$;
revoke all on function public.support_csat_summary(integer) from public, anon;
grant execute on function public.support_csat_summary(integer) to authenticated;

-- VERIFY: as an admin each returns data; as a non-admin every one returns
-- ZERO ROWS (not an error). And:
--   select has_function_privilege('anon', 'public.support_aging()', 'execute');  -- false
