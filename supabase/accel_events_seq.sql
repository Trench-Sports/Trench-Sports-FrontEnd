-- ═══════════════════════════════════════════════════════════════════════════
-- accel_events_seq.sql — impact record sequence numbers (follow-up to
--                        accel_events.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A SEPARATE FILE
--
-- impact_seq was added to accel_events.sql AFTER that file had already been run
-- against the live project. accel_events.sql creates the table with
-- `create table if not exists`, which is what makes it safe to re-run — and is
-- exactly why re-running it will NOT add the column to a table that already
-- exists. The idempotency that protects the file also freezes it.
--
-- So: a fresh project gets impact_seq from accel_events.sql's CREATE TABLE, an
-- existing one gets it here, and both files are idempotent, so running both in
-- either order converges on the same schema.
--
-- Producing contract: app_main.c send_impact(), fw >= 1.4.2-c
--   {"type":"impact","seq":<n>,"t":<onset ms>,...}
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.impact_events
    add column if not exists impact_seq integer;

comment on column public.impact_events.impact_seq is
    'Device record number, monotonic per firmware boot (fw >= 1.4.2-c, NULL '
    'below). Holes in the sequence within a session are impact records the BLE '
    'tx queue dropped. Not unique-indexed on purpose: a device reset mid-session '
    'restarts both this and t_onset_ms, and a constraint violation there would '
    'fail the whole upload over a diagnostic column.';

-- Sums the positive holes between consecutive sequence numbers, rather than
-- (max - min + 1 - count), so a device reset mid-session — which restarts the
-- counter and steps backwards — reads as zero missing instead of a large
-- negative. A session with no seq values at all returns zeros.
--
-- This is a FLOOR on loss, never an exact count: a record dropped after the
-- last impact of a session leaves no hole, and neither does one dropped while
-- the app was disconnected. Read a non-zero n_missing as "impact_count for this
-- session is a lower bound".
create or replace function public.impact_seq_gaps(p_session_id text)
returns table (n_rows bigint, n_missing bigint, first_seq integer, last_seq integer)
language sql
stable
security invoker
as $$
    with s as (
        select impact_seq,
               impact_seq - lag(impact_seq) over (order by impact_seq) - 1 as hole
          from public.impact_events
         where session_id = p_session_id
           and impact_seq is not null
    )
    select count(*)::bigint,
           coalesce(sum(case when hole > 0 then hole else 0 end), 0)::bigint,
           min(impact_seq)::integer,
           max(impact_seq)::integer
      from s;
$$;

comment on function public.impact_seq_gaps(text) is
    'Impact records the device sent that never arrived, counted from holes in '
    'impact_seq. A floor on loss, not an exact count — see the function body.';

-- PostgREST schema cache reload. Without this the API keeps rejecting
-- impact_seq as an unknown column even though it now exists.
notify pgrst, 'reload schema';
