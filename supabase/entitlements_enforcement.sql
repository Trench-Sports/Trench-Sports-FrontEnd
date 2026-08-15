-- =====================================================================
-- TRENCH SPORTS — ENTITLEMENT ENFORCEMENT AT WRITE TIME
-- =====================================================================
-- Phase 5 of docs/Trench_Sports_Three_Tier_Plan.docx §10: insert-time
-- enforcement for the numeric caps, plus mode entitlement on write.
--
-- Depends on supabase/entitlements.sql (program_tier, tier_limits,
-- tier_modes, tier_rank) and supabase/rls_policies.sql (get_my_program_id).
-- Run entitlements.sql FIRST. Idempotent: safe to re-run.
--
--
-- ⚠ TWO REQUIREMENTS THAT PULL AGAINST EACH OTHER — AND HOW THIS RESOLVES THEM
--
-- Requirement A (§8.4): "Enforce mode entitlement at write time. A session
--   insert whose mode is not in the program's entitled set should be rejected
--   by a policy or trigger, not merely hidden in the mode rolodex. Otherwise a
--   modified client records Target sessions on Tier I."
--
-- Requirement B (product): capture everything the adapters can produce, so a
--   program that upgrades can use the data it already recorded rather than
--   starting over.
--
-- Rejecting the insert satisfies A and destroys B: the Volume sessions a
-- program recorded on Tier I would be gone, and upgrading would unlock an
-- empty history.
--
-- RESOLUTION — QUARANTINE, NOT REJECTION. Unentitled-mode sessions are
-- STORED at full fidelity, STAMPED with the tier that captured them, and stay
-- INVISIBLE until the program's tier covers that mode. This works because the
-- read gate in entitlements.sql §6a filters on the program's CURRENT tier, not
-- on anything recorded at capture time — so an upgrade unlocks the back
-- catalogue automatically, with no migration and no backfill.
--
-- Requirement A's actual harm — "a modified client records Target sessions on
-- Tier I" — is about the program USING Target data it has not paid for. Read
-- masking already prevents that completely: a forged Target session returns
-- zero rows from every read surface. Quarantine therefore closes the same hole
-- while keeping the data as upgrade leverage.
--
-- If you would rather hard-reject, flip one row — no DDL:
--     update public.entitlement_settings set reject_unentitled_modes = true;
-- The trigger reads that flag on every insert. See section 3.
--
--
-- ANONYMOUS UPLOADS ARE EXEMPT — DO NOT REMOVE THESE GUARDS.
-- The pre-signup /m/home funnel (src/pages/mobile/home.tsx) writes
-- sessions → events → event_cells → session_summaries under the anon key with
-- program_id = NULL. Every trigger below returns early when program_id IS
-- NULL. Without that, re-enabling these checks silently kills the top of the
-- acquisition funnel — see supabase/reenable_rls_anon_uploads.sql.
-- =====================================================================

begin;

-- =====================================================================
-- 1. SETTINGS
-- =====================================================================
-- A single-row table so enforcement behaviour can be changed operationally
-- rather than by editing and re-running a migration.
create table if not exists public.entitlement_settings (
  id                      boolean primary key default true,
  -- false (default): unentitled-mode sessions are stored and quarantined.
  -- true: they are rejected outright, and that data is never captured.
  reject_unentitled_modes boolean not null default false,
  -- Master switch for the numeric caps in section 4. Lets you land this
  -- migration and watch admin_program_health before it starts refusing
  -- writes — recommended for the first week.
  enforce_limits          boolean not null default true,
  updated_at              timestamptz not null default now(),
  constraint entitlement_settings_singleton check (id)
);

insert into public.entitlement_settings (id) values (true)
on conflict (id) do nothing;

-- Readable by the app (the dashboard explains quarantine to the user); only
-- service_role and internal admins should write it.
alter table public.entitlement_settings enable row level security;

drop policy if exists "entitlement_settings_select" on public.entitlement_settings;
create policy "entitlement_settings_select"
  on public.entitlement_settings for select
  to authenticated
  using (true);

grant select on public.entitlement_settings to authenticated;


-- =====================================================================
-- 2. LIMIT RESOLUTION
-- =====================================================================
-- Resolves one numeric cap for a program. NULL means unlimited.
--
-- GRANDFATHERING (§8.2): a program flagged is_grandfathered keeps whatever is
-- stored in its own max_* column, so a later repricing cannot silently
-- downgrade an existing customer. Everyone else resolves from the tier, which
-- means changing tier_limits() moves every non-grandfathered program at once
-- and the stored columns are only a cache for the admin display.
create or replace function public.effective_limit(
  p_program_id uuid,
  p_key        text
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row    public.programs%rowtype;
  v_tier   text;
  v_stored int;
begin
  select * into v_row from public.programs where id = p_program_id;
  if not found then
    return null;                       -- unknown program: do not enforce
  end if;

  if v_row.is_grandfathered then
    v_stored := case p_key
      when 'maxAthletes'          then v_row.max_athletes
      when 'maxCoaches'           then v_row.max_coaches
      when 'maxDevices'           then v_row.max_devices
      when 'maxSessionsPerMonth'  then v_row.max_sessions_per_month
      else null
    end;
    -- A grandfathered program with an explicit cap keeps it. One with NULL
    -- means unlimited and must NOT fall through to the tier default.
    return v_stored;
  end if;

  v_tier := public.program_tier(p_program_id);
  return (public.tier_limits(v_tier) ->> p_key)::int;
end;
$$;


-- Shared guard: should this trigger enforce at all?
create or replace function public.limits_enforced()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enforce_limits from public.entitlement_settings where id), true);
$$;


-- Raises the standard over-cap error. One place so every message reads the
-- same way and names the plan rather than just refusing.
create or replace function public.raise_limit_exceeded(
  p_what  text,
  p_limit int,
  p_tier  text
)
returns void
language plpgsql
volatile          -- NOT immutable: an immutable function can be constant-folded
                  -- at plan time, which would move the raise out of the branch
                  -- that is supposed to guard it.
as $$
begin
  raise exception
    'Plan limit reached: % (limit %, %). Upgrade to raise this cap.',
    p_what, p_limit,
    case p_tier when 'none' then 'no active plan' else 'Tier ' || p_tier end
    using errcode = '54000';           -- program_limit_exceeded
end;
$$;


-- =====================================================================
-- 3. MODE ENTITLEMENT AT WRITE TIME
-- =====================================================================
-- Provenance columns. These record what was true AT CAPTURE; they are never
-- read by the tier gate (which uses the current tier), so they cannot pin a
-- session to the tier that recorded it. They exist so the product can say
-- "you have 42 Volume sessions waiting" and so support can explain why a
-- session is invisible.
alter table public.session_summaries
  add column if not exists captured_tier      text,
  add column if not exists captured_entitled  boolean;

comment on column public.session_summaries.captured_tier is
  'Effective program tier when this session was uploaded. Provenance only — the read gate uses the CURRENT tier, so upgrading reveals this row without any backfill.';
comment on column public.session_summaries.captured_entitled is
  'False when the session mode was outside the program tier at capture (quarantined). Stays stored at full fidelity and becomes visible when the tier covers the mode.';

create or replace function public.tg_session_mode_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier     text;
  v_entitled boolean;
  v_reject   boolean;
begin
  -- Anonymous pre-signup upload: nothing to enforce, nothing to stamp.
  if new.program_id is null then
    return new;
  end if;

  v_tier := public.program_tier(new.program_id);
  -- session_summaries.mode is nullable (unlike sessions.mode, which defaults to
  -- 'power'). Coalesce so a null never makes v_entitled NULL and quietly skip
  -- both the stamp and the check.
  v_entitled := coalesce(new.mode::text, 'power') = any(public.tier_modes(v_tier));

  new.captured_tier     := v_tier;
  new.captured_entitled := v_entitled;

  if not v_entitled then
    select coalesce(reject_unentitled_modes, false)
      into v_reject
      from public.entitlement_settings where id;

    if coalesce(v_reject, false) then
      raise exception
        'Mode % is not included in this plan (%).',
        new.mode,
        case v_tier when 'none' then 'no active plan' else 'Tier ' || v_tier end
        using errcode = '42501';
    end if;
    -- Default path: keep the data. It is invisible to every read surface
    -- until the program's tier covers this mode (entitlements.sql §6a).
  end if;

  return new;
end;
$$;

drop trigger if exists trg_session_mode_entitlement on public.session_summaries;
create trigger trg_session_mode_entitlement
  before insert on public.session_summaries
  for each row execute function public.tg_session_mode_entitlement();


-- =====================================================================
-- 4. NUMERIC LIMIT ENFORCEMENT
-- =====================================================================
-- Each trigger counts using EXACTLY the definition admin_program_health
-- already displays (supabase/telemetry_admin.sql), so the admin "near cap"
-- warning and the refusal agree. If those queries change, change these too.

-- ── 4a. Athletes ─────────────────────────────────────────────────────
create or replace function public.tg_limit_athletes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.program_id is null or not public.limits_enforced() then
    return new;
  end if;

  v_limit := public.effective_limit(new.program_id, 'maxAthletes');
  if v_limit is null then
    return new;                        -- unlimited
  end if;

  -- Lock the program row so two concurrent inserts cannot both pass the
  -- check and land one over the cap. These are low-frequency writes, so
  -- serialising per program costs nothing real.
  perform 1 from public.programs where id = new.program_id for update;

  select count(*) into v_count
    from public.athletes where program_id = new.program_id;

  if v_count >= v_limit then
    perform public.raise_limit_exceeded(
      'athletes', v_limit, public.program_tier(new.program_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limit_athletes on public.athletes;
create trigger trg_limit_athletes
  before insert on public.athletes
  for each row execute function public.tg_limit_athletes();


-- ── 4b. Coach seats ──────────────────────────────────────────────────
-- Counts EVERY profile attached to the program regardless of role, matching
-- admin_program_health's `coaches` column. A seat is a login, so the program
-- admin occupies one — that is the reading §9 assumes when it warns that a
-- too-tight cap forces credential sharing and costs per-coach attribution.
--
-- Fires on UPDATE too because that is how a user actually joins: onboarding
-- and coach-invite redemption both set program_id on an existing profile.
create or replace function public.tg_limit_coaches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.program_id is null or not public.limits_enforced() then
    return new;
  end if;

  -- Only when the profile is actually joining (or moving to) a program.
  -- NESTED, not `tg_op = 'UPDATE' and old...` on one line: OLD is unassigned
  -- during an INSERT and touching it raises "record old is not assigned yet".
  -- SQL boolean evaluation order is not guaranteed to save us there, so the
  -- tg_op check has to be a separate statement.
  if tg_op = 'UPDATE' then
    if old.program_id is not distinct from new.program_id then
      return new;
    end if;
  end if;

  v_limit := public.effective_limit(new.program_id, 'maxCoaches');
  if v_limit is null then
    return new;
  end if;

  perform 1 from public.programs where id = new.program_id for update;

  select count(*) into v_count
    from public.profiles
   where program_id = new.program_id
     and user_id is distinct from new.user_id;   -- exclude the row moving in

  if v_count >= v_limit then
    perform public.raise_limit_exceeded(
      'coach seats', v_limit, public.program_tier(new.program_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limit_coaches on public.profiles;
create trigger trg_limit_coaches
  before insert or update of program_id on public.profiles
  for each row execute function public.tg_limit_coaches();


-- ── 4c. Devices ──────────────────────────────────────────────────────
-- Counts only live claims: a deactivated adapter should not consume a seat.
-- Fires on UPDATE of program_id because devices.tsx claims an existing row
-- by upsert rather than inserting fresh.
create or replace function public.tg_limit_devices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.program_id is null or not public.limits_enforced() then
    return new;
  end if;

  -- Nested for the same reason as tg_limit_coaches: OLD does not exist on INSERT.
  if tg_op = 'UPDATE' then
    if old.program_id is not distinct from new.program_id then
      return new;
    end if;
  end if;

  v_limit := public.effective_limit(new.program_id, 'maxDevices');
  if v_limit is null then
    return new;
  end if;

  perform 1 from public.programs where id = new.program_id for update;

  select count(*) into v_count
    from public.devices
   where program_id = new.program_id
     and deactivated_at is null
     and id is distinct from new.id;

  if v_count >= v_limit then
    perform public.raise_limit_exceeded(
      'connected adapters', v_limit, public.program_tier(new.program_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limit_devices on public.devices;
create trigger trg_limit_devices
  before insert or update of program_id on public.devices
  for each row execute function public.tg_limit_devices();


-- ── 4d. Teams ────────────────────────────────────────────────────────
-- maxTeams lives only in tier_limits() — programs has no max_teams column —
-- so grandfathered programs fall through to their tier for this one cap.
-- Core teams are created as part of program setup and are not optional, so
-- only non-core teams count against the cap.
create or replace function public.tg_limit_teams()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.program_id is null or not public.limits_enforced() then
    return new;
  end if;

  if new.team_type::text = 'core' then
    return new;
  end if;

  v_limit := (public.tier_limits(public.program_tier(new.program_id)) ->> 'maxTeams')::int;
  if v_limit is null then
    return new;
  end if;

  perform 1 from public.programs where id = new.program_id for update;

  select count(*) into v_count
    from public.teams
   where program_id = new.program_id
     and team_type::text <> 'core';

  if v_count >= v_limit then
    perform public.raise_limit_exceeded(
      'teams', v_limit, public.program_tier(new.program_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limit_teams on public.teams;
create trigger trg_limit_teams
  before insert on public.teams
  for each row execute function public.tg_limit_teams();


-- ── 4e. Sessions per calendar month ──────────────────────────────────
-- Guards the whole upload chain, because sessions is written before events,
-- event_cells and session_summaries. Calendar month via date_trunc, matching
-- admin_program_health's sessions_this_month exactly.
--
-- No row lock here: this is the hot write path, and one session slipping over
-- the cap under concurrency is harmless. Correctness of the cap matters less
-- than not serialising every upload in a program.
create or replace function public.tg_limit_sessions_per_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.program_id is null or not public.limits_enforced() then
    return new;
  end if;

  v_limit := public.effective_limit(new.program_id, 'maxSessionsPerMonth');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
    from public.sessions
   where program_id = new.program_id
     and created_at >= date_trunc('month', now());

  if v_count >= v_limit then
    perform public.raise_limit_exceeded(
      'sessions this month', v_limit, public.program_tier(new.program_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limit_sessions_per_month on public.sessions;
create trigger trg_limit_sessions_per_month
  before insert on public.sessions
  for each row execute function public.tg_limit_sessions_per_month();


-- Index backing the monthly count — without it every upload sequential-scans
-- the program's sessions.
create index if not exists idx_sessions_program_created
  on public.sessions (program_id, created_at desc)
  where program_id is not null;


-- =====================================================================
-- 5. BACKFILL PROVENANCE FOR EXISTING SESSIONS
-- =====================================================================
-- Rows recorded before this migration have no stamp. Fill them in from the
-- program's tier NOW — an approximation, and labelled as one, but it beats
-- leaving the columns null and makes section 6's counts meaningful
-- immediately. Only touches rows that have never been stamped.
update public.session_summaries s
   set captured_tier     = public.program_tier(s.program_id),
       captured_entitled = coalesce(s.mode::text, 'power') = any(
         public.tier_modes(public.program_tier(s.program_id)))
 where s.captured_tier is null
   and s.program_id is not null;


commit;


-- =====================================================================
-- 6. "WHAT AN UPGRADE WOULD UNLOCK" — the retention/upsell surface
-- =====================================================================
-- Run outside the transaction above so a failure here cannot roll back the
-- enforcement work.
--
-- This is the other half of requirement B. Capturing everything is only
-- valuable if the program can SEE that it happened, so this reports the data
-- a program already owns but cannot currently read: sessions in locked modes,
-- and sessions older than its history window. It proves nothing was thrown
-- away, and it is the most honest upgrade prompt available — real counts of
-- the customer's own training, not sample data.
create or replace function public.my_locked_data_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program uuid := public.get_my_program_id();
  v_role    text := public.get_my_role();
  v_team    uuid := public.get_my_core_team_id();
  v_tier    text := public.my_tier();
  v_modes   text[] := public.tier_modes(v_tier);
  v_cutoff  timestamptz := public.tier_history_cutoff(v_tier);
  v_result  jsonb;
begin
  if v_program is null then
    return jsonb_build_object('tier', v_tier, 'lockedModes', '[]'::jsonb,
                              'lockedByHistory', 0, 'totalLocked', 0);
  end if;

  with scoped as (
    -- Same tenancy predicate as every other read surface. Deliberately does
    -- NOT apply the mode or history filters — seeing them is the point.
    select s.mode::text as mode, s.date_of_record, s.num_events
      from public.session_summaries s
     where s.program_id = v_program
       and (v_role = 'admin' or (v_role = 'coach' and s.core_team_id = v_team))
  ),
  by_mode as (
    select mode,
           count(*)                        as sessions,
           coalesce(sum(num_events), 0)    as strikes
      from scoped
     where not (mode = any(v_modes))
     group by mode
  )
  select jsonb_build_object(
    'tier', v_tier,
    -- Sessions recorded in modes this tier does not include. Retained in
    -- full; they appear the moment the tier covers the mode.
    'lockedModes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'mode', mode, 'sessions', sessions, 'strikes', strikes)
              order by sessions desc)
         from by_mode), '[]'::jsonb),
    'lockedModeSessions', coalesce((select sum(sessions) from by_mode), 0),
    -- Sessions inside an entitled mode but older than the history window.
    'lockedByHistory', (
      select count(*) from scoped
       where mode = any(v_modes)
         and v_cutoff is not null
         and date_of_record < v_cutoff),
    'oldestSession', (select min(date_of_record) from scoped),
    'historyDays', public.tier_history_days(v_tier),
    'totalSessions', (select count(*) from scoped)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.my_locked_data_summary() to authenticated;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
--   -- Caps resolve per tier, and grandfathered programs keep their own:
--   select name, plan, is_grandfathered,
--          public.effective_limit(id, 'maxAthletes')         as athletes,
--          public.effective_limit(id, 'maxCoaches')          as coaches,
--          public.effective_limit(id, 'maxSessionsPerMonth')  as sessions
--     from public.programs order by name;
--
--   -- Quarantined data, per program — this is the upgrade pipeline:
--   select p.name, p.plan, ss.mode, count(*) as sessions
--     from public.session_summaries ss
--     join public.programs p on p.id = ss.program_id
--    where ss.captured_entitled is false
--    group by 1,2,3 order by 4 desc;
--
--   -- As a coach, what an upgrade would reveal:
--   select public.my_locked_data_summary();
--
--   -- Anonymous funnel still works (must return NULL, not raise):
--   --   insert a session with program_id = NULL and confirm no trigger fires.
--
-- ROLLOUT ADVICE
--   Land this with enforce_limits = true but watch admin_program_health for a
--   few days — several existing programs may already sit above the caps that
--   were never enforced before, and they will start seeing refusals on the
--   next athlete or session. To stage it:
--     update public.entitlement_settings set enforce_limits = false;
--   then flip it on once you have looked at who is over.
--
--   Programs already over a cap are NOT retroactively broken: the triggers
--   only refuse NEW rows. Nothing is deleted and nothing is downgraded.
--
-- STILL NOT ENFORCED AFTER THIS FILE
--   * Raw NDJSON / event_cells export and the per-program API surface
--     (§10 phases 6 and 7).
-- =====================================================================
