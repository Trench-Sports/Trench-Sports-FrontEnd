-- ═══════════════════════════════════════════════════════════════════════════
-- accel_capture_diagnostics.sql — make "zero impacts" a recorded fact
-- ═══════════════════════════════════════════════════════════════════════════
-- Requires supabase/accel_events.sql and supabase/process_session_impacts.sql.
-- Idempotent and additive; safe to re-run.
--
-- WHY
--
-- Session ses_1790871892578_t17ff (TS-A058, 2026-10-01) uploaded with
-- accel_present = true and impact_count / peak_g_mg NULL. That one state was
-- produced by at least four different causes, and nothing stored could tell
-- them apart:
--   • nothing crossed the firmware's impact_on threshold;
--   • impact frames arrived malformed and parseImpactFrame() dropped them;
--   • hello was unusable, so buildImpactRows() discarded every frame;
--   • the impact_events insert or process_session_impacts() failed.
--
-- Two changes:
--
--   §1  session_summaries.accel_capture — per-session counts of what happened
--       to the impact frames (received / rejected / duplicated / discarded /
--       built / inserted, seq range and holes) plus the capture conditions
--       they were detected under. Written by the app at upload; see
--       captureDiagnostics() in src/bluetooth/impacts.ts for the shape.
--
--   §2  rollup_impacts_to_session_summary() now writes impact_count = 0 when
--       the adapter reported an accelerometer (accel_present = true, from
--       hello) and no impact rows exist. peak_g_mg / mean_impact_g_mg stay
--       NULL — there is no peak of nothing. The app now calls
--       process_session_impacts() for every accelerometer session, not only
--       ones with rows, and skips it when the impact_events insert fell
--       short, so a zero here means "detected none", never "upload failed".
--
-- accel_capture is NOT added to the browser column grant (entitlements.sql
-- revokes whole-table SELECT on session_summaries). It is a diagnostic for the
-- SQL editor and service role, not a dashboard field.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- §1. Capture diagnostics column
-- ───────────────────────────────────────────────────────────────────────────
alter table public.session_summaries
    add column if not exists accel_capture jsonb;

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'session_summaries_accel_capture_object'
           and conrelid = 'public.session_summaries'::regclass
    ) then
        alter table public.session_summaries
            add constraint session_summaries_accel_capture_object
            check (accel_capture is null or jsonb_typeof(accel_capture) = 'object');
    end if;
end;
$$;

comment on column public.session_summaries.accel_capture is
    'What happened to this session''s {"type":"impact"} frames, written by the '
    'app at upload: frames_received, frames_rejected, duplicates_dropped, '
    'discarded_no_capture, rows_built, rows_inserted, seq_first/seq_last/'
    'seq_missing, and capture (thresholds, hpf, g range, sample rate, fw). '
    'NULL = adapter has no accelerometer and sent nothing, or session predates '
    'this column. rows_inserted < rows_built means the impact counts were '
    'deliberately left NULL.';


-- ───────────────────────────────────────────────────────────────────────────
-- §2. Rollup writes zero for an accelerometer session with no impacts
-- ───────────────────────────────────────────────────────────────────────────
-- Same definition as accel_events.sql §8 (kept in step there so re-running
-- that file does not revert this).
create or replace function public.rollup_impacts_to_session_summary(p_session_id text)
returns integer
language plpgsql
security invoker
as $$
declare
    v_rows integer;
begin
    update public.session_summaries s
       set accel_present    = true,
           impact_count     = agg.n,
           peak_g_mg        = agg.peak_mg,
           mean_impact_g_mg = agg.mean_mg,
           accel_g_range_g  = coalesce(agg.g_range, s.accel_g_range_g)
      from (
            select count(*)::integer            as n,
                   max(peak_mg)::integer        as peak_mg,
                   round(avg(peak_mg))::integer as mean_mg,
                   max(g_range_g)::smallint     as g_range
              from public.impact_events
             where session_id = p_session_id
               and rebound_of is null
           ) agg
     where s.session_id = p_session_id
       and (agg.n > 0 or s.accel_present is true);

    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function public.rollup_impacts_to_session_summary(text) is
    'Recomputes the session_summaries accel rollup over PRIMARY impacts only. '
    'Writes impact_count = 0 (peaks NULL) when accel_present is already true '
    'and there are no rows. Does not write accel_present = false — absence of '
    'rows is not evidence the adapter lacked an accelerometer. The app sets '
    'that from hello.';

-- create or replace keeps existing grants, but re-assert the revoke from
-- process_session_impacts.sql §3 so this file is safe to run on its own.
revoke all on function public.rollup_impacts_to_session_summary(text) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────────────────
-- Verification (run after)
-- ───────────────────────────────────────────────────────────────────────────
-- 1. Column and constraint exist:
--      select column_name, data_type from information_schema.columns
--       where table_name = 'session_summaries' and column_name = 'accel_capture';
--
-- 2. Backfill zero-impact accelerometer sessions uploaded before this change.
--    Only sessions with accel_present = true and no impact rows are touched;
--    sessions with rows were already rolled up correctly. Caveat: before this
--    change nothing recorded a failed impact_events insert, so a pre-change
--    session whose insert failed outright will also read 0 here. Telemetry
--    (stage = 'impact_events') is the only record of those:
--      select s.session_id, public.reprocess_session_impacts(s.session_id)
--        from public.session_summaries s
--       where s.accel_present is true
--         and s.impact_count is null
--         and not exists (select 1 from public.impact_events i
--                          where i.session_id = s.session_id);
--
-- 3. The 2026-10-01 session should now read impact_count = 0:
--      select impact_count, peak_g_mg, accel_capture
--        from public.session_summaries
--       where session_id = 'ses_1790871892578_t17ff';
--    (accel_capture stays NULL for it — the app wrote nothing at the time.)
