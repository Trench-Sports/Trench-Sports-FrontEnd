-- =====================================================================
-- TRENCH SPORTS — INTERNAL ADMIN ANALYTICS
-- =====================================================================
-- Backs the internal-only /admin observability page (Part 1, Phase 2 of
-- docs/observability-and-code-audit-plan.md).
--
-- Everything the admin page reads goes through SECURITY DEFINER RPCs that
--   1. check membership in internal_admins, and
--   2. return PRE-AGGREGATED rows only.
-- With no API layer, this RPC boundary is the only place to keep raw
-- cross-program athlete data from reaching the browser. It follows the
-- same pattern as create_program / find_program_by_code / etc. in
-- supabase/live_functions_snapshot.sql.
--
-- These panels need NO new instrumentation — they are pure aggregates over
-- the existing sessions / session_summaries / events / event_cells /
-- programs / profiles / athletes / devices tables.
--
-- Run once against the live Supabase project. Idempotent (safe to re-run).
-- =====================================================================


-- ── 1. Who is an internal admin ──────────────────────────────────────
-- Deliberately NOT the program-scoped user_role enum (see plan §1.4).
create table if not exists public.internal_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.internal_admins enable row level security;

-- No policies for anon/authenticated → the table is invisible to the
-- browser. It is read only from inside the SECURITY DEFINER helpers below,
-- which bypass RLS.


-- ── 2. Membership helper ─────────────────────────────────────────────
create or replace function public.is_internal_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.internal_admins where user_id = auth.uid()
  );
$$;

-- Exposed to the client so the page can decide whether to render or 404.
-- Returns only a boolean — leaks nothing about the data or other admins.
grant execute on function public.is_internal_admin() to authenticated;


-- ── 3. Panel 1 — Platform pulse ──────────────────────────────────────
-- Top-strip KPIs + a 14-day sessions sparkline. Session counts come from
-- sessions.created_at. (Telemetry-dependent tiles — events ingested,
-- outbox depth, error count — arrive in Phase 3 once app_events exists.)
create or replace function public.admin_platform_pulse()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'programs_total',    (select count(*) from public.programs),
    'programs_active_7d',(select count(distinct program_id) from public.sessions
                           where created_at >= now() - interval '7 days'
                             and program_id is not null),
    'coaches_total',     (select count(*) from public.profiles),
    'athletes_total',    (select count(*) from public.athletes),
    'devices_total',     (select count(*) from public.devices),
    'sessions_today',    (select count(*) from public.sessions
                           where created_at >= date_trunc('day', now())),
    'sessions_7d',       (select count(*) from public.sessions
                           where created_at >= now() - interval '7 days'),
    'sessions_prev_7d',  (select count(*) from public.sessions
                           where created_at >= now() - interval '14 days'
                             and created_at <  now() - interval '7 days'),
    'sessions_30d',      (select count(*) from public.sessions
                           where created_at >= now() - interval '30 days'),
    'sessions_spark',    (
      select coalesce(
        jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0)) order by d.day),
        '[]'::jsonb)
      from generate_series((current_date - 13), current_date, interval '1 day') as d(day)
      left join (
        select created_at::date as day, count(*) as n
        from public.sessions
        where created_at >= current_date - 13
        group by 1
      ) c on c.day = d.day::date
    )
  )
  into result;

  return result;
end;
$$;

grant execute on function public.admin_platform_pulse() to authenticated;


-- ── 4. Panel 4 — Upload health ───────────────────────────────────────
-- The finding-A tripwire, buildable today with zero instrumentation.
-- A "partial write" is a session row whose downstream inserts didn't all
-- land: no summary, no events, or events-but-no-cells.
create or replace function public.admin_upload_health()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with s as (
    select
      se.id,
      (sm.session_id is not null)                         as has_summary,
      exists (select 1 from public.events e where e.session_id = se.id) as has_events
    from public.sessions se
    left join public.session_summaries sm on sm.session_id = se.id
  ),
  s2 as (
    select
      id,
      has_summary,
      has_events,
      case when has_events then exists (
        select 1
        from public.events e
        join public.event_cells ec on ec.event_id = e.event_id
        where e.session_id = s.id
      ) else false end as has_cells
    from s
  )
  select jsonb_build_object(
    'sessions_total',          (select count(*) from s2),
    'missing_summary',         (select count(*) from s2 where not has_summary),
    'missing_events',          (select count(*) from s2 where not has_events),
    'events_but_no_cells',     (select count(*) from s2 where has_events and not has_cells),
    'complete',                (select count(*) from s2 where has_summary and has_events and has_cells),
    'sessions_last_7d',        (select count(*) from public.sessions where created_at >= now() - interval '7 days'),
    'partial_last_7d',         (
        select count(*)
        from public.sessions se
        where se.created_at >= now() - interval '7 days'
          and not exists (select 1 from public.session_summaries sm where sm.session_id = se.id)
    )
  )
  into result;

  return result;
end;
$$;

grant execute on function public.admin_upload_health() to authenticated;


-- ── 5. Panel 7 — Program health table ────────────────────────────────
-- One pre-aggregated row per program. Doubles as churn-risk / support
-- triage. near_* flags surface programs approaching their plan limits.
create or replace function public.admin_program_health()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.last_activity desc nulls last), '[]'::jsonb)
  from (
    select
      p.id,
      p.name,
      p.plan,
      p.status,
      p.trial_ends_at,
      p.max_athletes,
      p.max_devices,
      p.max_sessions_per_month,
      (select count(*) from public.profiles pr where pr.program_id = p.id)  as coaches,
      (select count(*) from public.athletes a  where a.program_id = p.id)   as athletes,
      (select count(*) from public.devices d   where d.program_id = p.id)   as devices,
      (select count(*) from public.sessions s
         where s.program_id = p.id and s.created_at >= now() - interval '7 days')  as sessions_7d,
      (select count(*) from public.sessions s
         where s.program_id = p.id and s.created_at >= now() - interval '30 days') as sessions_30d,
      (select count(*) from public.sessions s
         where s.program_id = p.id
           and s.created_at >= date_trunc('month', now()))                        as sessions_this_month,
      (select max(s.created_at) from public.sessions s where s.program_id = p.id)  as last_activity
    from public.programs p
  ) t
  into result;

  return result;
end;
$$;

grant execute on function public.admin_program_health() to authenticated;


-- ── 5b. Telemetry pulse — reads app_events (Phase 1 sink) ────────────
-- Fills the app.opened / app.error tiles the plan lists for Panel 1, plus a
-- lightweight event-feed for Panel 8. Requires supabase/telemetry_events.sql
-- to have been run. Pre-aggregated + a bounded recent feed (event names/ts/ok
-- only — app_events carries no athlete PII by the §1.4 rule).
create or replace function public.admin_telemetry_pulse()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'events_today',       (select count(*) from public.app_events where ts >= date_trunc('day', now())),
    'events_24h',         (select count(*) from public.app_events where ts >= now() - interval '24 hours'),
    'errors_24h',         (select count(*) from public.app_events where ts >= now() - interval '24 hours' and ok is false),
    'active_clients_24h', (select count(distinct client_id) from public.app_events where ts >= now() - interval '24 hours'),
    'by_name', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.count desc), '[]'::jsonb)
      from (
        select name,
               count(*)                              as count,
               count(*) filter (where ok is false)   as error_count
        from public.app_events
        where ts >= now() - interval '24 hours'
        group by name
        order by count(*) desc
        limit 30
      ) t
    ),
    'recent', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.ts desc), '[]'::jsonb)
      from (
        select ts, name, ok, error_code,
               props->>'route'  as route,
               platform
        from public.app_events
        order by ts desc
        limit 30
      ) r
    )
  )
  into result;

  return result;
end;
$$;

grant execute on function public.admin_telemetry_pulse() to authenticated;


-- ── 6. Seed internal admins ──────────────────────────────────────────
-- Grants /admin access by email lookup. The dev@ account is a dedicated,
-- shareable login for the observability page — create it first in Supabase
-- (Authentication → Users → Add user, or the SQL block in section 7 below),
-- then this insert grants it access. Safe to re-run.
insert into public.internal_admins (user_id)
select id from auth.users where email in ('dev@trenchsports.ai', 'jaylen@trenchsports.ai')
on conflict (user_id) do nothing;


-- ── 7. (Optional) Create the dev login entirely in SQL ───────────────
-- RECOMMENDED instead: Supabase dashboard → Authentication → Users →
-- Add user, set the password, and tick "Auto Confirm User". It's more
-- robust across GoTrue versions than poking auth.* directly.
--
-- If you'd rather do it in SQL, run this block ONCE. Change the password
-- first — it is stored only as a bcrypt hash, never in plaintext. If crypt/
-- gen_salt error, prefix them with `extensions.` (that's where Supabase
-- installs pgcrypto). After running, re-run section 6 to grant access.
--
-- do $$
-- declare uid uuid;
-- begin
--   select id into uid from auth.users where email = 'dev@trenchsports.ai';
--   if uid is null then
--     uid := gen_random_uuid();
--     insert into auth.users (
--       instance_id, id, aud, role, email, encrypted_password,
--       email_confirmed_at, created_at, updated_at,
--       raw_app_meta_data, raw_user_meta_data
--     ) values (
--       '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
--       'dev@trenchsports.ai', crypt('REPLACE_WITH_YOUR_PASSWORD', gen_salt('bf')),
--       now(), now(), now(),
--       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
--     );
--     insert into auth.identities (
--       provider_id, user_id, identity_data, provider, created_at, updated_at
--     ) values (
--       uid::text, uid,
--       jsonb_build_object('sub', uid::text, 'email', 'dev@trenchsports.ai', 'email_verified', true),
--       'email', now(), now()
--     );
--   end if;
-- end $$;
