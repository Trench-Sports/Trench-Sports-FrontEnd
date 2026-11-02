-- =====================================================================
-- accel_read_surface.sql — serve TSA-V accelerometer data to the dashboard
-- =====================================================================
-- process_session_impacts.sql fills events.accel_peak_mg and the
-- session_summaries accel rollups, but no read function returned them, so
-- the dashboard could not show any of it. This applies entitlements.sql
-- §6b (tiered_session_events + accel_peak_mg) and §6b-ii
-- (tiered_session_accel) on their own, without re-running the whole file.
--
-- Tier II and up; Tier I gets NULL / no row, same gate as impulse and angle.
--
-- A verbatim copy of those two sections. entitlements.sql stays the source
-- of truth — change it there and re-copy, never only here.
--
-- Idempotent: both functions are dropped and recreated.
-- =====================================================================

begin;

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
  cells           jsonb,
  -- Appended last. TSA-V accelerometer peak for the impact paired to this
  -- strike (process_session_impacts.sql). NULL means NOT MEASURED — no
  -- accelerometer, an older session, or no impact paired — never zero g.
  -- The sensor-frame azimuth/elevation are deliberately not served: without
  -- a mount transform they are not a bag-relative direction (accel_events.sql §3).
  accel_peak_mg   integer
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
      '[]'::jsonb),
    case when v_comparative then e.accel_peak_mg end
  from public.events e
  where e.session_id = p_session_id
  order by e.t_start_ms;
end;
$$;

grant execute on function public.tiered_session_events(text) to authenticated;


-- ── 6b-ii. Session accelerometer rollup (Tier II+) ───────────────────
-- impact_count / peak_g_mg / mean_impact_g_mg for one session, for the
-- dashboard's Session Stats. A separate function rather than three more
-- columns on 6a: export_session_summaries (6c) mirrors 6a's fixed column
-- list, so growing 6a would break the CSV export.
--
-- Same session authorisation as 6b. Tier I gets no row at all, the same
-- way 6b nulls accel_peak_mg below Tier II.
drop function if exists public.tiered_session_accel(text);
create or replace function public.tiered_session_accel(p_session_id text)
returns table (
  accel_present    boolean,
  impact_count     integer,
  peak_g_mg        integer,
  mean_impact_g_mg integer
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
begin
  if v_tier = 'none' or v_program is null or public.tier_rank(v_tier) < 2 then
    return;
  end if;

  return query
  select s.accel_present, s.impact_count, s.peak_g_mg, s.mean_impact_g_mg
  from public.session_summaries s
  where s.session_id = p_session_id
    and s.program_id = v_program
    and (v_role = 'admin' or (v_role = 'coach' and s.core_team_id = v_team))
    and s.mode::text = any(v_modes)
    and (v_cutoff is null or s.date_of_record >= v_cutoff);
end;
$$;

grant execute on function public.tiered_session_accel(text) to authenticated;


commit;


-- =====================================================================
-- VERIFY — run as a Tier II+ coach or admin, one block at a time
-- =====================================================================
--   select event_id, accel_peak_mg
--     from public.tiered_session_events('<model V session id>') limit 10;
--   -> accel_peak_mg filled on paired strikes, NULL on unpaired
--
--   select * from public.tiered_session_accel('<model V session id>');
--   -> one row; impact_count / peak_g_mg / mean_impact_g_mg filled
