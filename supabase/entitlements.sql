-- =====================================================================
-- TRENCH SPORTS — SUBSCRIPTION ENTITLEMENTS (server-side enforcement)
-- =====================================================================
-- Implements docs/Trench_Sports_Three_Tier_Plan.docx §8 (entitlement model
-- and enforcement) against the tier vocabulary that actually shipped in
-- supabase/admin_set_program_plan.sql: trial / I / II / III.
--
-- WHY THIS FILE EXISTS
-- The browser talks to Supabase with the anon key and relies on RLS. Any
-- row the client CAN read, it can read from devtools — so hiding a panel
-- behind a React conditional withholds nothing. Concretely: si_fatigue_slope,
-- si_trend and reaction_fatigue_delta_ms are written into
-- session_summaries.quality for EVERY session on EVERY plan, so before this
-- file a Tier I customer could read the whole Tier III fatigue feature with
-- one query. This file is the actual gate; src/lib/entitlements.ts is only
-- the UI's mirror of it.
--
-- HOW IT GATES
--   1. Column-level REVOKE removes direct client SELECT on every gated
--      column of session_summaries / events / event_cells. PostgreSQL
--      enforces this below RLS — no policy, view or client trick gets past it.
--   2. Reads are re-served by SECURITY DEFINER RPCs that re-implement the
--      RLS scoping predicates verbatim and additionally mask by tier:
--      unentitled modes are dropped as rows, unentitled fields are stripped
--      from the returned JSON, and history beyond the tier's window is cut.
--   3. Field masking is a WHITELIST. A quality/stats key nobody has
--      classified yet resolves to Tier III, so adding a new derived metric
--      to the pipeline cannot silently leak it to Tier I.
--
-- Trial resolution (product decision): trial = Tier III while live, then
-- lapses to 'none' — every gated surface locks. Captured data is RETAINED,
-- never deleted, so paying restores full history rather than starting over.
--
-- Depends on helpers from supabase/rls_policies.sql:
--   get_my_program_id(), get_my_role(), get_my_core_team_id()
--
-- ⚠ DEPLOYMENT ORDER — RUN THIS FILE BEFORE SHIPPING THE FRONTEND.
-- The two halves are not independent, and the failure mode is asymmetric:
--   * SQL applied, old frontend live  → harmless. The old client's direct
--     column reads lose access and those panels render empty, but nothing
--     leaks. Recoverable by shipping the frontend.
--   * Frontend shipped, SQL not applied → EVERY program locks. my_entitlements()
--     does not exist, useEntitlements() fails closed to tier "none" (by
--     design — a client that cannot prove its tier must not be trusted), and
--     every customer sees the lapsed banner. Also every dashboard read calls
--     an RPC that is not there.
-- So: apply this file first, confirm the verification queries at the bottom,
-- then deploy. The frontend fails closed on purpose; do not "fix" that by
-- defaulting to a generous tier.
--
-- Idempotent: safe to re-run. Run in the Supabase SQL editor.
-- =====================================================================

begin;

-- =====================================================================
-- 1. SCHEMA — per-program override hatch + tier limits
-- =====================================================================

-- Per-program overrides so design partners, pilots and one-off concessions
-- do not require inventing a fourth tier (§8.2). Shape: {"csvExport": true}.
-- Merged OVER the tier defaults during resolution.
alter table public.programs
  add column if not exists plan_features jsonb not null default '{}'::jsonb;

-- The plan CHECK was already tightened to trial/I/II/III by
-- admin_set_program_plan.sql. Re-assert it so this file is self-sufficient
-- when run against a project that has not had that migration applied.
do $$
begin
  alter table public.programs drop constraint if exists programs_plan_check;
  update public.programs set plan = 'I'   where plan = 'free';
  update public.programs set plan = 'II'  where plan = 'pro';
  update public.programs set plan = 'III' where plan = 'enterprise';
  update public.programs set plan = 'trial'
   where plan not in ('trial', 'I', 'II', 'III');
  alter table public.programs
    add constraint programs_plan_check
    check (plan = any (array['trial'::text, 'I'::text, 'II'::text, 'III'::text]));
end $$;


-- ── Program limits by tier (§9) ──────────────────────────────────────
-- NULL means unlimited, matching how the admin view already reads these.
--
-- COACH CAPS: 2 at Tier I and 8 at Tier II, NOT the 1 and 5 in the doc's §9
-- table. §9 flags those as too thin against the athlete caps and recommends
-- exactly 2 and 8 — and the public demo at /dummy (src/pages/dummy.tsx) is
-- already showing prospects "coaches: 2" and "coaches: 8". Shipping the table
-- values would contradict a published promise, so the recommendation wins.
-- That resolves the doc's open question #5. Every other figure here matches
-- both the §9 table and the demo.
create or replace function public.tier_limits(p_tier text)
returns jsonb
language sql
immutable
as $$
  select case p_tier
    when 'I'   then jsonb_build_object(
                      'maxAthletes', 50,  'maxCoaches', 2,
                      'maxDevices',  1,   'maxSessionsPerMonth', 50,
                      'maxTeams',    1)
    when 'II'  then jsonb_build_object(
                      'maxAthletes', 150, 'maxCoaches', 8,
                      'maxDevices',  3,   'maxSessionsPerMonth', 500,
                      'maxTeams',    4)
    when 'III' then jsonb_build_object(
                      'maxAthletes', null, 'maxCoaches', null,
                      'maxDevices',  null, 'maxSessionsPerMonth', null,
                      'maxTeams',    null)
    -- 'none' — a lapsed or suspended program creates nothing new.
    else            jsonb_build_object(
                      'maxAthletes', 0,   'maxCoaches', 0,
                      'maxDevices',  0,   'maxSessionsPerMonth', 0,
                      'maxTeams',    0)
  end;
$$;

-- Backfill the existing limit columns so the admin "near cap" warning and
-- the (later) insert-time triggers read consistent numbers.
update public.programs p
   set max_athletes           = (public.tier_limits(
         case when p.plan = 'trial' then 'III' else p.plan end) ->> 'maxAthletes')::int,
       max_coaches            = (public.tier_limits(
         case when p.plan = 'trial' then 'III' else p.plan end) ->> 'maxCoaches')::int,
       max_devices            = (public.tier_limits(
         case when p.plan = 'trial' then 'III' else p.plan end) ->> 'maxDevices')::int,
       max_sessions_per_month = (public.tier_limits(
         case when p.plan = 'trial' then 'III' else p.plan end) ->> 'maxSessionsPerMonth')::int
 where not p.is_grandfathered;


-- =====================================================================
-- 2. TIER RESOLUTION
-- =====================================================================
-- One resolver, used by every RPC below and mirrored (for UI copy only)
-- by src/lib/entitlements.ts. Nothing else may compare plan strings.

-- Ordering helper so policies can ask "at least Tier II" readably.
create or replace function public.tier_rank(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'III' then 3
    when 'II'  then 2
    when 'I'   then 1
    else 0                 -- 'none' and anything unrecognised
  end;
$$;

-- Resolves a program's EFFECTIVE tier from plan + status + trial dates.
--   suspended                       -> 'none'
--   trial, still inside the window  -> 'III'  (show the ceiling)
--   trial, lapsed                   -> 'none' (locks; data is retained)
--   otherwise                       -> the stored plan
-- grace_period_end extends a live trial when set, so a billing hiccup does
-- not lock a paying customer out mid-conversation.
create or replace function public.program_tier(p_program_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id is null                then 'none'
    when p.status = 'suspended'      then 'none'
    when p.plan   = 'trial'          then
      case
        when coalesce(p.grace_period_end, p.trial_ends_at) is null then 'III'
        when coalesce(p.grace_period_end, p.trial_ends_at) > now() then 'III'
        else 'none'
      end
    else p.plan
  end
  from public.programs p
  where p.id = p_program_id;
$$;

-- The calling user's effective tier. 'none' when they have no program.
create or replace function public.my_tier()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.program_tier(public.get_my_program_id()), 'none');
$$;

-- Readable predicate for policies and function bodies.
create or replace function public.tier_at_least(p_min_tier text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tier_rank(public.my_tier()) >= public.tier_rank(p_min_tier);
$$;


-- =====================================================================
-- 3. TIER FEATURE CONSTANTS
-- =====================================================================
-- The SQL side of the TIER_FEATURES map. src/lib/entitlements.ts carries
-- the same shape for rendering lock states; THIS is the copy that decides
-- what data actually leaves the database.

-- Impact modes unlocked per tier (§2, §5.1, §6.1). Volume and Target are
-- held to Tier III because they are the data sources the fatigue tracker
-- regresses over — unlocking them earlier gives the feature away.
create or replace function public.tier_modes(p_tier text)
returns text[]
language sql
immutable
as $$
  select case p_tier
    when 'III' then array['power','accuracy','reaction','volume','target']
    when 'II'  then array['power','accuracy','reaction']
    when 'I'   then array['power']
    else            array[]::text[]
  end;
$$;

-- History window in days. NULL = unlimited (Tier III).
create or replace function public.tier_history_days(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'III' then null
    when 'II'  then 90
    when 'I'   then 30
    else            0
  end;
$$;

-- The oldest date_of_record a tier may read. NULL = no cutoff.
create or replace function public.tier_history_cutoff(p_tier text)
returns timestamptz
language sql
stable
as $$
  select case
    when public.tier_history_days(p_tier) is null then null
    else now() - make_interval(days => public.tier_history_days(p_tier))
  end;
$$;

-- Boolean capability map, merged with the program's plan_features override.
-- Returned to the client by my_entitlements() and used for the export gate.
create or replace function public.tier_features(p_tier text)
returns jsonb
language sql
immutable
as $$
  select case p_tier
    when 'III' then jsonb_build_object(
      'leaderboards','trendWeighted','mostImproved',true,'teamComparison',true,
      'multiTeamRollup',true,'athleteAnalysis','longitudinal','strikeCompass',true,
      'angleDrift',true,'csvExport',true,'rawExport',true,'fatigueTracker',true,
      'aiAnalysis',true,'advancedDashboard',true,'distributions',true,'apiAccess',true)
    when 'II'  then jsonb_build_object(
      'leaderboards','full','mostImproved',true,'teamComparison',true,
      'multiTeamRollup',false,'athleteAnalysis','full','strikeCompass',true,
      'angleDrift',false,'csvExport',true,'rawExport',false,'fatigueTracker',false,
      'aiAnalysis',false,'advancedDashboard',false,'distributions',false,'apiAccess',false)
    when 'I'   then jsonb_build_object(
      'leaderboards','single','mostImproved',false,'teamComparison',false,
      'multiTeamRollup',false,'athleteAnalysis','profileOnly','strikeCompass',false,
      'angleDrift',false,'csvExport',false,'rawExport',false,'fatigueTracker',false,
      'aiAnalysis',false,'advancedDashboard',false,'distributions',false,'apiAccess',false)
    else jsonb_build_object(
      'leaderboards','none','mostImproved',false,'teamComparison',false,
      'multiTeamRollup',false,'athleteAnalysis','none','strikeCompass',false,
      'angleDrift',false,'csvExport',false,'rawExport',false,'fatigueTracker',false,
      'aiAnalysis',false,'advancedDashboard',false,'distributions',false,'apiAccess',false)
  end;
$$;


-- =====================================================================
-- 4. CLIENT-FACING ENTITLEMENT LOOKUP
-- =====================================================================
-- What useEntitlements() calls. Safe to expose: it describes the caller's
-- OWN program and returns no other program's data. Resolution happens here
-- rather than in TypeScript so the client cannot fake a tier by editing
-- state — though note that faking it would only change which panels render,
-- since the data itself is gated by sections 5 and 6.
create or replace function public.my_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program_id uuid := public.get_my_program_id();
  v_tier       text := public.my_tier();
  v_row        public.programs%rowtype;
begin
  select * into v_row from public.programs where id = v_program_id;

  return jsonb_build_object(
    'tier',         v_tier,
    'plan',         coalesce(v_row.plan, 'none'),
    'status',       coalesce(v_row.status, 'none'),
    'trialEndsAt',  v_row.trial_ends_at,
    'graceEndsAt',  v_row.grace_period_end,
    'isGrandfathered', coalesce(v_row.is_grandfathered, false),
    'modes',        to_jsonb(public.tier_modes(v_tier)),
    'historyDays',  public.tier_history_days(v_tier),
    'limits',       public.tier_limits(v_tier),
    -- Tier defaults first, per-program overrides merged on top.
    'features',     public.tier_features(v_tier) || coalesce(v_row.plan_features, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.my_entitlements() to authenticated;


-- =====================================================================
-- 5. FIELD MASKING
-- =====================================================================
-- Whitelists, not blacklists. Any key not named for a tier is withheld
-- from that tier, so a new derived metric added to the pipeline defaults
-- to Tier III rather than leaking to everyone.

-- Keeps only the named top-level keys of a jsonb object. Defined before its
-- callers because check_function_bodies validates SQL bodies at creation.
create or replace function public.jsonb_pick(p_obj jsonb, p_keys text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(k, p_obj -> k) filter (where p_obj ? k),
    '{}'::jsonb)
  from unnest(p_keys) as k;
$$;

-- session_summaries.quality — the column that carries the whole problem.
-- Tier I  : the Strength Index and nothing else.
-- Tier II : adds the accuracy and reaction aggregates.
-- Tier III: everything, including si_fatigue_slope / si_trend /
--           reaction_fatigue_delta_ms and the Volume window stats.
create or replace function public.mask_quality(p_quality jsonb, p_tier text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_quality is null then null
    when p_tier = 'III'    then p_quality
    -- This list is the union of every quality key the Tier II dashboard
    -- surfaces actually read (accuracy leaderboard, reaction leaderboard,
    -- athlete axis breakdown, session cards, CSV export). The offset and
    -- "correct" keys each have several historical spellings in the pipeline,
    -- so every variant the client falls back through is named here — a missing
    -- variant would silently render "—" rather than fail loudly.
    when p_tier = 'II'     then public.jsonb_pick(p_quality, array[
      'strength_index',
      'accuracy_pct','score',
      'avg_offset_mm','avg_offset_cm','avg_offset_cells','offset_cm',
      'avg_reaction_ms','best_reaction_ms','avg_reaction_ms_correct',
      'best_reaction_ms_correct','avg_reaction_ms_all','reaction_time_ms_all',
      'correct_hits','correct','attempts'
    ])
    when p_tier = 'I'      then public.jsonb_pick(p_quality, array['strength_index'])
    else null
  end;
$$;

-- peak_force_stats / impulse_stats / duration_ms_stats.
-- §7: "the gate is on the presentation, not the field" — Tier II sees the
-- mean and rank, Tier III sees the distribution. Distributions are the
-- array-valued keys (histograms, percentile series); aggregates are scalars.
create or replace function public.mask_stats(p_stats jsonb, p_tier text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_stats is null then null
    when p_tier = 'III'  then p_stats
    when p_tier = 'none' then null
    else coalesce(
      (select jsonb_object_agg(key, value)
         from jsonb_each(p_stats)
        where jsonb_typeof(value) <> 'array'),
      '{}'::jsonb)
  end;
$$;


-- =====================================================================
-- 5b. INDEXES THE READ SURFACES DEPEND ON
-- =====================================================================
-- rls_policies.sql lists both of these but leaves them COMMENTED OUT, and a
-- foreign key does not create an index in PostgreSQL — so neither exists
-- today. Section 6 needs them:
--   * tiered_session_events() correlates event_cells per event; without the
--     event_cells index that is a sequential scan per strike.
--   * every tiered_session_summaries() call filters on program_id plus
--     date_of_record, which is exactly this composite.
create index if not exists idx_event_cells_event_id
  on public.event_cells (event_id);

create index if not exists idx_events_session_id
  on public.events (session_id);

create index if not exists idx_session_summaries_program_date
  on public.session_summaries (program_id, date_of_record desc);

create index if not exists idx_session_summaries_core_team
  on public.session_summaries (core_team_id)
  where core_team_id is not null;


-- =====================================================================
-- 6. TIER-SCOPED READ SURFACES
-- =====================================================================
-- These replace direct table reads for every gated column. SECURITY DEFINER
-- bypasses RLS, so the RLS predicate from rls_policies.sql (admins see the
-- program, coaches see their core team) has to be restated here — that
-- restatement is the price of column-level gating.
--
-- AS OF THE §1 REFACTOR, 6a states it EXACTLY ONCE, in
-- scoped_session_summaries. tiered_session_summaries and (step 3)
-- api_session_summaries both delegate to it and contain no predicate of their
-- own, so adding an API surface does not add a third copy to keep in sync.
-- 6b (tiered_session_events) still carries its own copy — refactor it the same
-- way when /v1/sessions/{id}/events lands (runbook step 6).
--
-- If the policies in rls_policies.sql ever change, the places to change here
-- are: scoped_session_summaries' WHERE clause, and 6b's.

-- ── 6a-core. The shared scoping core ─────────────────────────────────
-- THE one architectural decision (plan §1). Row scoping and column masking
-- live here exactly once, taking identity as PARAMETERS. Two thin callers
-- resolve identity differently and neither duplicates a predicate:
--
--   scoped_session_summaries(p_program_id, p_role, p_scope_team_id, p_tier, …)
--          ▲                                        ▲
--   tiered_session_summaries()              api_session_summaries(p_key_hash, …)
--     identity from auth.uid() via            identity from api_keys
--     get_my_program_id() / get_my_role()     (supabase/api_keys.sql, step 3)
--     / get_my_core_team_id() / my_tier()
--
-- WHY: the API layer must not re-implement program scoping or the tier mask.
-- That would be a THIRD copy of the predicates already duplicated between
-- rls_policies.sql and this section (see the §6 header note), and a third copy
-- drifting is how a partner ends up reading another program's sessions.
--
-- RULES FOR THIS FUNCTION, all load-bearing:
--   * NO auth.uid(), my_tier(), get_my_*() anywhere in the body. Identity
--     arrives as arguments or it does not arrive.
--   * Not directly callable. Revoked from public/anon/authenticated below, so
--     only a definer caller can reach it. Without that revoke, a browser could
--     call it with p_program_id => <someone else's program>.
--   * s.program_id = p_program_id stays EXPLICIT. Never rely on the athletes
--     join to exclude the NULL-program rows the pre-signup /m/home funnel
--     writes (reenable_rls_anon_uploads.sql:1-26).
--
-- DROP first: create or replace cannot change a return type, so a re-run after
-- adding a column fails without this.
drop function if exists public.scoped_session_summaries(
  uuid, text, uuid, text, text, int, uuid[], uuid, text,
  timestamptz, timestamptz, text, int);

create or replace function public.scoped_session_summaries(
  -- Identity, supplied by the caller. Never resolved in here.
  p_program_id        uuid,
  p_role              text,
  p_scope_team_id     uuid,          -- the caller's OWN core team (coach scoping)
  p_tier              text,
  -- Filters. Every one of these NARROWS the result; none can widen it past
  -- the role scoping, so an admin passing another program's team id still
  -- gets nothing.
  p_mode              text        default null,
  p_range_days        int         default null,
  p_athlete_ids       uuid[]      default null,
  p_core_team_id      uuid        default null,   -- filter, NOT identity
  p_session_id        text        default null,
  -- API-shaped params (plan §4 conventions). The browser caller passes NULL
  -- for all four and is unaffected.
  p_since             timestamptz default null,   -- incremental sync on ingested_at
  p_cursor_ingested   timestamptz default null,   -- keyset pagination, half 1
  p_cursor_session_id text        default null,   -- keyset pagination, half 2
  p_limit             int         default null    -- NULL = unlimited
)
returns table (
  session_id             text,
  program_id             uuid,
  core_team_id           uuid,
  athlete_id             uuid,
  athlete_first_name     text,
  athlete_last_name      text,
  date_of_record         timestamptz,
  mode                   text,
  num_events             integer,
  session_duration_ms    bigint,
  heatmap                jsonb,
  quality                jsonb,
  peak_force_stats       jsonb,
  impulse_stats          jsonb,
  duration_ms_stats      jsonb,
  angles_deg             jsonb,
  most_contacted_cell_rc jsonb,
  center_of_mass_mm      jsonb,
  cadence_hz_avg         numeric,
  cadence_hz_median      numeric,
  iei_ms                 jsonb,
  longest_pause_ms       bigint,
  -- Appended LAST, deliberately. export_session_summaries (6c) does
  -- `select * from tiered_session_summaries(...)` into a fixed 22-column
  -- returns table, so the browser caller must not grow a column — it projects
  -- this one away. Only the API caller selects it.
  ingested_at            timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cutoff      timestamptz := public.tier_history_cutoff(p_tier);
  v_modes       text[]      := public.tier_modes(p_tier);
  -- Tier II sees impulse/duration distributions' aggregates; Tier I sees
  -- neither column at all (§7 marks both as Tier II).
  v_comparative boolean     := public.tier_rank(p_tier) >= 2;
begin
  -- Lapsed trial, suspended program, or an unresolvable identity: no rows at
  -- all. Their data still exists on disk and returns the moment the program is
  -- reinstated.
  if p_tier is null or p_tier = 'none' or p_program_id is null then
    return;
  end if;

  -- The caller may narrow the window but never widen it past its tier.
  if p_range_days is not null then
    v_cutoff := greatest(
      coalesce(v_cutoff, '-infinity'::timestamptz),
      now() - make_interval(days => p_range_days));
  end if;

  return query
  select
    s.session_id,
    s.program_id,
    s.core_team_id,
    s.athlete_id,
    a.first_name,
    a.last_name,
    s.date_of_record,
    s.mode::text,
    s.num_events,
    s.session_duration_ms,
    -- heatmap is the heaviest column on the row (a full contact grid). Only
    -- the single-session detail view ever draws it, so it is returned only for
    -- a by-id lookup — otherwise every leaderboard call would drag one grid
    -- per session across the wire for nothing.
    case when p_session_id is not null then s.heatmap end,
    public.mask_quality(s.quality, p_tier),
    public.mask_stats(s.peak_force_stats, p_tier),
    case when v_comparative then public.mask_stats(s.impulse_stats, p_tier) end,
    case when v_comparative then public.mask_stats(s.duration_ms_stats, p_tier) end,
    case when v_comparative then s.angles_deg end,
    case when v_comparative then s.most_contacted_cell_rc end,
    case when v_comparative then s.center_of_mass_mm end,
    case when v_comparative then s.cadence_hz_avg end,
    case when v_comparative then s.cadence_hz_median end,
    -- KNOWN LEAK, preserved verbatim so this refactor is provably a no-op:
    -- iei_ms is written as {...statSummary, values:[...]} (session.tsx:1473-1475)
    -- so it carries the full distribution to Tier II, bypassing mask_stats.
    -- Fixed in the NEXT commit (runbook step 2d) with its own one-line diff,
    -- because fixing it here would make the byte-identical proof impossible.
    case when v_comparative then s.iei_ms end,
    case when v_comparative then s.longest_pause_ms end,
    s.ingested_at
  from public.session_summaries s
  left join public.athletes a on a.id = s.athlete_id
  where s.program_id = p_program_id
    -- Mirrors session_summaries_select_admin / _select_coach in
    -- rls_policies.sql. A role that is neither admin nor coach gets nothing.
    and (p_role = 'admin' or (p_role = 'coach' and s.core_team_id = p_scope_team_id))
    -- Rows for modes this tier has not paid for never leave the database.
    and s.mode::text = any(v_modes)
    and (v_cutoff is null or s.date_of_record >= v_cutoff)
    and (p_mode         is null or s.mode::text = p_mode)
    and (p_athlete_ids  is null or s.athlete_id = any(p_athlete_ids))
    and (p_core_team_id is null or s.core_team_id = p_core_team_id)
    and (p_session_id   is null or s.session_id = p_session_id)
    -- Incremental sync. ingested_at, never date_of_record: the IndexedDB
    -- outbox (src/storage/sessionOutbox.ts) lands Friday's session on Monday,
    -- and a partner polling on date_of_record would silently never see it.
    and (p_since is null or s.ingested_at >= p_since)
    -- Keyset pagination. Both halves required — a half-supplied cursor is
    -- ignored rather than silently returning page 1 forever. Only correct
    -- against the ORDER BY immediately below, so the two move together.
    and (p_cursor_ingested is null or p_cursor_session_id is null
         or (s.ingested_at, s.session_id) < (p_cursor_ingested, p_cursor_session_id))
  -- Ordered for the cursor, NOT for the browser. The browser caller re-sorts
  -- by date_of_record desc to reproduce its historical order exactly; this
  -- ordering is the one the (program_id, ingested_at desc) index in
  -- api_prereqs.sql can actually serve, and the one the keyset predicate above
  -- requires. session_id breaks ties so a cursor can never loop or skip.
  order by s.ingested_at desc, s.session_id desc
  -- DANGER: least(NULL, 200) returns 200 in Postgres — LEAST ignores NULLs.
  -- Writing `limit least(coalesce(p_limit,100), 200)` would silently truncate
  -- the browser (which passes no limit) to 200 rows. The CASE is required.
  limit case when p_limit is null then null else least(greatest(p_limit, 1), 200) end;
end;
$$;

-- Not callable by a client under any circumstance. The publishable key ships
-- in the browser bundle, so without this revoke a console call could pass an
-- arbitrary p_program_id and read any program's sessions.
revoke all on function public.scoped_session_summaries(
  uuid, text, uuid, text, text, int, uuid[], uuid, text,
  timestamptz, timestamptz, text, int) from public, anon, authenticated;


-- ── 6a. Session summaries (browser caller) ───────────────────────────
-- Replaces `.from("session_summaries").select(...)` everywhere. Filter
-- params are pushed down rather than chained client-side so the tier cut
-- happens before rows leave the database.
--   p_mode         — single mode, or NULL for every mode the tier allows
--   p_range_days   — client's requested window; clamped to the tier's own
--   p_athlete_ids  — optional athlete scope (sub-team rosters pass a list)
--   p_core_team_id — optional core-team scope, for team leaderboards
--   p_session_id   — optional single-session lookup
-- Athlete names come back as flat columns because PostgREST cannot embed
-- related resources into a function result.
--
-- SIGNATURE AND RETURN TYPE ARE UNCHANGED BY THE §1 REFACTOR, deliberately:
--   * 11 call sites in src/pages/dashboard.tsx (and the mobile equivalents)
--     read named fields off the result
--   * export_session_summaries (6c) does `select *` from this into its own
--     fixed 22-column returns table — adding a column here breaks the CSV
--     export with a column-count mismatch
-- The core's ingested_at is therefore projected away below rather than
-- surfaced. Only api_session_summaries (step 3) selects it.
--
-- DROP first — CREATE OR REPLACE cannot change a function's return type, so a
-- re-run after adding a column would fail without this.
drop function if exists public.tiered_session_summaries(text, int, uuid[], uuid, text);
create or replace function public.tiered_session_summaries(
  p_mode         text   default null,
  p_range_days   int    default null,
  p_athlete_ids  uuid[] default null,
  p_core_team_id uuid   default null,
  p_session_id   text   default null
)
returns table (
  session_id             text,
  program_id             uuid,
  core_team_id           uuid,
  athlete_id             uuid,
  athlete_first_name     text,
  athlete_last_name      text,
  date_of_record         timestamptz,
  mode                   text,
  num_events             integer,
  session_duration_ms    bigint,
  heatmap                jsonb,
  quality                jsonb,
  peak_force_stats       jsonb,
  impulse_stats          jsonb,
  duration_ms_stats      jsonb,
  angles_deg             jsonb,
  most_contacted_cell_rc jsonb,
  center_of_mass_mm      jsonb,
  cadence_hz_avg         numeric,
  cadence_hz_median      numeric,
  iei_ms                 jsonb,
  longest_pause_ms       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Identity resolution is the ENTIRE job of this function. Every predicate
  -- and every mask lives in the core.
  return query
  select
    c.session_id,
    c.program_id,
    c.core_team_id,
    c.athlete_id,
    c.athlete_first_name,
    c.athlete_last_name,
    c.date_of_record,
    c.mode,
    c.num_events,
    c.session_duration_ms,
    c.heatmap,
    c.quality,
    c.peak_force_stats,
    c.impulse_stats,
    c.duration_ms_stats,
    c.angles_deg,
    c.most_contacted_cell_rc,
    c.center_of_mass_mm,
    c.cadence_hz_avg,
    c.cadence_hz_median,
    c.iei_ms,
    c.longest_pause_ms
    -- c.ingested_at deliberately NOT selected — see the note above.
  from public.scoped_session_summaries(
    public.get_my_program_id(),
    public.get_my_role(),
    public.get_my_core_team_id(),
    public.my_tier(),
    p_mode,
    p_range_days,
    p_athlete_ids,
    p_core_team_id,
    p_session_id,
    null,   -- p_since
    null,   -- p_cursor_ingested
    null,   -- p_cursor_session_id
    null    -- p_limit: unlimited, exactly as before
  ) c
  -- Reproduces the pre-refactor ordering. The core sorts for the cursor; this
  -- restores date_of_record desc for the app. Ties were already arbitrary
  -- before the refactor, so no ordering guarantee changes here.
  order by c.date_of_record desc;
end;
$$;

grant execute on function public.tiered_session_summaries(text, int, uuid[], uuid, text) to authenticated;


-- ── 6b. Session events (heatmap replay + Strike Compass) ─────────────
-- Replaces the `.from("events").select(..., event_cells(...))` replay read.
-- Cells come back as a jsonb array so this stays one round trip, matching
-- the embedded shape the client already consumes.
--   All tiers  : timing, strength index, contact cells — the Tier I grid.
--   Tier II+   : impulse, rise/decay time, iei, angle_deg, reaction, accuracy.
--   Tier III   : raw temporal payload and the full per-cell record.
--
-- EVERY FIELD THE ADAPTERS CAPTURE IS REACHABLE FROM SOME TIER HERE. That is
-- deliberate: the write path stores decay_time_ms, iei_prev_ms and the full
-- event_cells record (v_peak plus onset/peak/last timestamps) for every
-- session on every plan, so if this function never returned them the data
-- would be captured and then orphaned — collected forever, usable by nobody.
-- Upgrading has to actually deliver the richer view of sessions already
-- recorded, which means the read surface must span the whole substrate.
--
-- DROP first: changing a function's return type is not allowed by CREATE OR
-- REPLACE, so a re-run after any column change would fail without this.
drop function if exists public.tiered_session_events(text);
create or replace function public.tiered_session_events(p_session_id text)
returns table (
  event_id        text,
  t_start_ms      bigint,
  duration_ms     numeric,
  strength_index  jsonb,
  cell_count      integer,
  impulse_index   numeric,
  rise_time_ms    numeric,
  decay_time_ms   numeric,
  iei_prev_ms     numeric,
  angle_deg       numeric,
  reaction_time_ms numeric,
  accuracy        jsonb,
  temporal        jsonb,
  cells           jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier        text := public.my_tier();
  v_program     uuid := public.get_my_program_id();
  v_role        text := public.get_my_role();
  v_team        uuid := public.get_my_core_team_id();
  v_cutoff      timestamptz := public.tier_history_cutoff(v_tier);
  v_modes       text[] := public.tier_modes(v_tier);
  v_comparative boolean := public.tier_rank(v_tier) >= 2;
  v_full        boolean := public.tier_rank(v_tier) >= 3;
begin
  if v_tier = 'none' or v_program is null then
    return;
  end if;

  -- Authorise the SESSION first. Without this check a caller could read any
  -- session's events by id, since events carries no program_id of its own.
  -- Mode and history window are re-checked here, not just in 6a — otherwise
  -- a Tier I client could pull a Volume session's events by guessing its id.
  if not exists (
    select 1
    from public.session_summaries s
    where s.session_id = p_session_id
      and s.program_id = v_program
      and (v_role = 'admin' or (v_role = 'coach' and s.core_team_id = v_team))
      and s.mode::text = any(v_modes)
      and (v_cutoff is null or s.date_of_record >= v_cutoff)
  ) then
    return;
  end if;

  return query
  select
    e.event_id,
    e.t_start_ms,
    e.duration_ms,
    e.strength_index,
    (e.temporal ->> 'cell_count')::int,
    case when v_comparative then e.impulse_index    end,
    case when v_comparative then e.rise_time_ms     end,
    case when v_comparative then e.decay_time_ms    end,
    case when v_comparative then e.iei_prev_ms      end,
    case when v_comparative then e.angle_deg        end,
    case when v_comparative then e.reaction_time_ms end,
    case when v_comparative then e.accuracy         end,
    -- The raw temporal payload carries the Volume window indices the
    -- fatigue tracker keys off, so it is Tier III in full. Lower tiers
    -- already received cell_count as its own column above.
    case when v_full then e.temporal end,
    -- Contact cells. Every tier needs r/c/v_min to draw the grid and heatmap
    -- (§7 marks the live grid and heatmap as Tier I). Tier III additionally
    -- gets v_peak and the onset/peak/last timestamps — the substrate for
    -- contact-area analysis and 3D angle reconstruction, and what the raw
    -- export is built from. Captured for everyone from day one, so a program
    -- upgrading to Tier III gets this depth on its whole back catalogue.
    coalesce(
      (select jsonb_agg(
                case
                  when v_full then jsonb_build_object(
                    'r', c.r, 'c', c.c, 'v_min', c.v_min,
                    'v_peak', c.v_peak, 'samples', c.samples,
                    't_first_ms', c.t_first_ms,
                    't_peak_ms',  c.t_peak_ms,
                    't_last_ms',  c.t_last_ms)
                  else jsonb_build_object(
                    'r', c.r, 'c', c.c, 'v_min', c.v_min)
                end
                order by c.r, c.c)
         from public.event_cells c
        where c.event_id = e.event_id),
      '[]'::jsonb)
  from public.events e
  where e.session_id = p_session_id
  order by e.t_start_ms;
end;
$$;

grant execute on function public.tiered_session_events(text) to authenticated;


-- ── 6c. Session-summary CSV export (Tier II+) ────────────────────────
-- Delegates to 6a, so the export physically cannot return a field or a date
-- range the tier cannot already display on screen (§7, "Export follows the
-- same rule"), and the 90-day cap cannot be widened by editing the request.
--
-- BE CLEAR ABOUT WHAT THIS GATE IS. Because the export contains exactly the
-- data already on screen, the csvExport check below is a PRODUCT gate, not a
-- security boundary — a Tier I user can call tiered_session_summaries()
-- themselves and build a CSV from what they are already entitled to see.
-- That is fine and unavoidable. The boundary that matters is the field
-- masking in 6a, which is real. The genuinely withheld export is the raw
-- NDJSON / event_cells stream, which stays Tier III and is not implemented
-- here (§10 phase 7).
--
-- Returns the same masked row shape as 6a so the modal's column catalog can
-- flatten it unchanged.
drop function if exists public.export_session_summaries(text, int, uuid[]);
create or replace function public.export_session_summaries(
  p_mode        text   default null,
  p_range_days  int    default null,
  p_athlete_ids uuid[] default null
)
-- Column list mirrors 6a exactly. RETURNS TABLE does not create a named
-- composite type, so it cannot be referenced as `setof` — if you add a column
-- to 6a, add it here too.
returns table (
  session_id             text,
  program_id             uuid,
  core_team_id           uuid,
  athlete_id             uuid,
  athlete_first_name     text,
  athlete_last_name      text,
  date_of_record         timestamptz,
  mode                   text,
  num_events             integer,
  session_duration_ms    bigint,
  heatmap                jsonb,
  quality                jsonb,
  peak_force_stats       jsonb,
  impulse_stats          jsonb,
  duration_ms_stats      jsonb,
  angles_deg             jsonb,
  most_contacted_cell_rc jsonb,
  center_of_mass_mm      jsonb,
  cadence_hz_avg         numeric,
  cadence_hz_median      numeric,
  iei_ms                 jsonb,
  longest_pause_ms       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier     text := public.my_tier();
  v_override boolean;
begin
  select coalesce((plan_features ->> 'csvExport')::boolean, false)
    into v_override
    from public.programs
   where id = public.get_my_program_id();

  if not ((public.tier_features(v_tier) ->> 'csvExport')::boolean
          or coalesce(v_override, false)) then
    raise exception 'csv export requires Tier II' using errcode = '42501';
  end if;

  return query
  select * from public.tiered_session_summaries(
    p_mode, p_range_days, p_athlete_ids, null, null);
end;
$$;

grant execute on function public.export_session_summaries(text, int, uuid[]) to authenticated;


-- =====================================================================
-- 7. LOCK DOWN DIRECT COLUMN READS
-- =====================================================================
-- The step that makes all of the above real. Until these run, every RPC in
-- section 6 is decoration — the client can still select the gated columns
-- straight off the table.
--
-- Column privileges are checked by PostgreSQL before RLS, so no policy, view,
-- embed or PostgREST trick reaches a column the role cannot select.
--
-- IMPORTANT — WHY THIS IS REVOKE-ALL-THEN-GRANT-BACK, NOT A COLUMN REVOKE.
-- Supabase grants table-level SELECT to anon and authenticated. Table-level
-- and column-level privileges are stored separately (pg_class.relacl vs
-- pg_attribute.attacl), and a table-level SELECT already permits every column.
-- `REVOKE SELECT (quality) ...` therefore does NOT subtract from it — it
-- revokes a column privilege that was never separately granted, succeeds
-- silently, and leaves the column fully readable. The only correct shape is to
-- drop the whole-table grant and grant back exactly the permitted columns.
--
-- The columns granted back are the ones every tier needs: identity, scoping,
-- mode, date, strike count, duration and the heatmap (§7 marks all of these
-- available at Tier I). Everything else is served by section 6.
--
-- INSERT is untouched — session.tsx, mobile/session.tsx and mobile/home.tsx
-- keep writing every column exactly as before; none of them chain .select()
-- onto an insert, so none of them need SELECT on what they write.
-- service_role keeps full access, which is what the future API surface
-- (§6.5) and any edge function will run as.

revoke select on public.session_summaries from anon, authenticated;
grant select (
  session_id,
  program_id,
  core_team_id,
  athlete_id,
  mode,
  date_of_record,
  num_events,
  session_duration_ms,
  heatmap
) on public.session_summaries to anon, authenticated;

-- events: everything derived beyond the strike's identity and timing is
-- gated. `raw` is the full sample stream — Tier III raw-export territory,
-- never client-readable at any tier through this path.
revoke select on public.events from anon, authenticated;
grant select (
  event_id,
  session_id,
  t_start_ms,
  t_end_ms
) on public.events to anon, authenticated;

-- event_cells is the substrate for contact-area and 3D angle reconstruction.
-- Served only through tiered_session_events().
revoke select on public.event_cells from anon, authenticated;

commit;


-- =====================================================================
-- VERIFICATION — run these AFTER committing, as a Tier I coach
-- =====================================================================
--   select public.my_tier();                              -> 'I'
--   select quality from public.session_summaries limit 1; -> permission denied
--   select * from public.event_cells limit 1;             -> permission denied
--   select mode from public.tiered_session_summaries();   -> only 'power'
--   select quality from public.tiered_session_summaries() limit 1;
--       -> {"strength_index": {...}} and nothing else; no si_fatigue_slope
--   select * from public.export_session_summaries();      -> 42501 not authorized
--
-- As a Tier III coach the same tiered_session_summaries() call returns all
-- five modes, unbounded history, and the full quality payload.
--
-- NOT YET ENFORCED (documented so the gap is known, not discovered):
--   * Write-time mode entitlement — a modified client can still INSERT a
--     Volume session on Tier I. It will be invisible on read (6a drops the
--     row), but the write succeeds. Needs a trigger on sessions/
--     session_summaries. §10 phase 5.
--   * The numeric limits in tier_limits() are populated but advisory —
--     max_athletes and friends still need insert-time triggers. §10 phase 5.
--   * Raw NDJSON / event_cells export and the per-program API surface.
--     §10 phases 6 and 7.
-- =====================================================================
