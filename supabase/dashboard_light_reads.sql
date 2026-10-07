-- =====================================================================
-- Dashboard light reads
-- =====================================================================
-- The coach dashboards (src/pages/dashboard.tsx, src/pages/mobile/dashboard.tsx)
-- used tiered_session_summaries() for every list view: leaderboards, team
-- leaderboards, athlete progress pills, the recent-sessions list and the
-- athlete analysis tab. None of those read an array-valued key, yet each row
-- dragged the full per-session payloads into the browser:
--   * quality.windows[] and quality.si_all_values[]  (volume mode, Tier III)
--   * iei_ms.values[]                                (Tier II+, every mode)
-- plus impulse/duration/center-of-mass columns no list ever renders.
--
-- tiered_session_rows() is the list-view read. It returns only the columns
-- the lists use, with every array stripped out of the jsonb, and accepts
-- p_limit / p_offset.
--
-- SCOPING: this function is SECURITY INVOKER and selects FROM
-- tiered_session_summaries(), so program scope, coach core-team scope, the
-- tier's mode set, its history window and the column masks are all applied
-- exactly where they were before (entitlements.sql §6a / §6a-core). It
-- contains no predicate of its own and can only ever return a subset of what
-- the caller could already read. Do not make it SECURITY DEFINER.
--
-- tiered_session_summaries() itself is unchanged: the single-session detail
-- view still needs heatmap, windows[] and the full distributions, and
-- export_session_summaries() depends on its exact return shape.
--
-- Idempotent: safe to re-run.

-- Recursively drops every array-valued key from a jsonb object. Non-objects
-- pass through unchanged. Nested objects (strength_index, etc.) keep their
-- scalars.
create or replace function public.jsonb_scalars_only(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return p;
  end if;
  return coalesce(
    (select jsonb_object_agg(
              key,
              case when jsonb_typeof(value) = 'object'
                   then public.jsonb_scalars_only(value)
                   else value end)
       from jsonb_each(p)
      where jsonb_typeof(value) <> 'array'),
    '{}'::jsonb);
end;
$$;

drop function if exists public.tiered_session_rows(text, int, uuid[], uuid, int, int);
create or replace function public.tiered_session_rows(
  p_mode         text   default null,
  p_range_days   int    default null,
  p_athlete_ids  uuid[] default null,
  p_core_team_id uuid   default null,
  p_limit        int    default null,   -- NULL = every row in the tier window
  p_offset       int    default null
)
returns table (
  session_id          text,
  core_team_id        uuid,
  athlete_id          uuid,
  athlete_first_name  text,
  athlete_last_name   text,
  date_of_record      timestamptz,
  mode                text,
  num_events          integer,
  session_duration_ms bigint,
  cadence_hz_avg      numeric,
  quality             jsonb,
  peak_force_stats    jsonb,
  angles_deg          jsonb,
  iei_ms              jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.session_id,
    t.core_team_id,
    t.athlete_id,
    t.athlete_first_name,
    t.athlete_last_name,
    t.date_of_record,
    t.mode,
    t.num_events,
    t.session_duration_ms,
    t.cadence_hz_avg,
    public.jsonb_scalars_only(t.quality),
    public.jsonb_scalars_only(t.peak_force_stats),
    public.jsonb_scalars_only(t.angles_deg),
    public.jsonb_scalars_only(t.iei_ms)
  from public.tiered_session_summaries(
    p_mode, p_range_days, p_athlete_ids, p_core_team_id, null) t
  -- session_id breaks date ties so offset pages never overlap or skip.
  order by t.date_of_record desc, t.session_id desc
  -- LIMIT NULL is "no limit" in Postgres, which is what an omitted p_limit
  -- should mean. Do not rewrite this with least(): least() ignores NULLs.
  limit case when p_limit is null then null else greatest(p_limit, 0) end
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.tiered_session_rows(text, int, uuid[], uuid, int, int) from public, anon;
grant execute on function public.tiered_session_rows(text, int, uuid[], uuid, int, int) to authenticated;
