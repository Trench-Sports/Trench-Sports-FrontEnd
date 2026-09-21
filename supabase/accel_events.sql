-- ═══════════════════════════════════════════════════════════════════════════
-- accel_events.sql — persist ADXL372 impact events from the TSA-V adapter
-- ═══════════════════════════════════════════════════════════════════════════
-- Supersedes the draft at Trench-Sports-main/db/accel_events.sql, which cannot
-- run against the live schema. Five defects are fixed here; see §0.
--
-- Producing contract is firmware:
--   Components/Electronics/TSA-V/Everything-in-C/main/app_main.c
--     send_impact()  {"type":"impact","seq":<n>,"t":<onset ms>,"g":<peak mg>,
--                     "a":[x,y,z],"t_peak":<ms>,"dur":<ms>}
--     send_hello()   {"type":"hello",...,"accel":<bool>,"a_units":"mg",
--                     "g_range":200,"hpf":<bool>,"imu_hz":N,
--                     "impact_on":N,"impact_off":N,"hz":<measured scan Hz>}
--
-- Consuming contract is the app: src/bluetooth/impacts.ts builds these rows,
-- uploadSession() in session.tsx / mobile/session.tsx / mobile/home.tsx writes
-- them as upload step 5.
--
-- Idempotent and additive, per the supabase/ convention. Safe to re-run.
-- Nothing here redefines an existing column or an existing function.
--
-- Decisions carried forward from the draft, so they are not re-litigated:
--
-- 1. mg integers, never floats. The firmware keeps the whole accel path integer
--    (ADXL_MG_PER_LSB = 100) and advertises "a_units":"mg" in hello. numeric
--    would introduce a rounding boundary that exists nowhere else.
--
-- 2. The 10 Hz {"type":"imu"} telemetry is NOT stored. It is a live readout for
--    the connected screen; at 10 Hz a 20-minute session is 12k rows answering
--    no question impact_events does not already answer.
--
-- 3. Thresholds are stored per row. impact_on / impact_off are runtime tunable
--    over BLE ({"cmd":"imu","thresh":..,"release":..}), so a 5 g event from one
--    session and a 5 g event from another were not necessarily detected under
--    the same rule. Without these columns the table is not comparable across
--    sessions and cannot be re-analysed later. §1 extends the same reasoning to
--    the sampling configuration.
--
-- 4. si_version is deliberately absent. Strength Index v2 WS6 owns that column
--    on events/session_summaries; adding it here would land it twice.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- §0. What changed against the draft, and the naming convention
-- ───────────────────────────────────────────────────────────────────────────
-- Defects fixed (1-3 were known; 4-5 were not):
--
--   1. session_id was uuid. public.sessions.id is TEXT.
--   2. event_id was `bigint references public.events (id)`. The events PK is
--      `event_id TEXT`; there is no `id` column on events at all.
--   3. link_impacts_to_events() joined e.t_onset_ms. The live column is
--      e.t_start_ms. (The draft's own REVIEW note flagged this as a risk and
--      guessed the wrong name.)
--   4. The same function also selected `e.id as event_id` — the second half of
--      defect 2, on a different line. Fixing the column type alone would still
--      have left the function erroring on first call.
--   5. The RLS policy delegated visibility with a bare
--        exists (select 1 from public.sessions s where s.id = ...)
--      which silently blocks the anonymous upload path. reenable_rls_anon_
--      uploads.sql documents exactly this: "Under RLS the anon role cannot
--      SELECT the parent row, so an inline EXISTS subquery would see nothing
--      and fail." events and event_cells solve it with the SECURITY DEFINER
--      helper is_anon_session(text); this table now does the same. The
--      delegation instinct was right for authenticated reads and is kept.
--
-- Naming — Strength Index vs Gadd Severity Index (plan open question 4):
--
--   si_*     Strength Index. Already load-bearing in the codebase
--            (si_version, si_fatigue_slope, si_trend in entitlements.sql and
--            the v2 software plan), so it does not move.
--   gsi_*    Gadd Severity Index, IF it is ever computed. Never abbreviated
--            "SI" in a column name, comment, or UI string. It is an
--            accelerometer integral and will be mistaken for the other one.
--   accel_*  Raw measured accelerometer quantities with no index semantics at
--            all — what the part reported, before anything scores it.
--
--   No gsi_* column is created here. The prefix is reserved by this comment so
--   the first person to need one does not reach for si_.
--
-- Deliberately NOT in this file:
--   • impact_waveforms — blocked on the FIFO drain path (see §1, sample_source).
--   • The Strength Index function — blocked on waveforms and on WS6.
--   • Any automatic call of the §5-§8 functions from the client. The pairing
--     window is still a guess (see §6); running it on upload would bake that
--     guess into production data before it is measured.
-- ───────────────────────────────────────────────────────────────────────────


-- ───────────────────────────────────────────────────────────────────────────
-- §1. impact_events — one row per falling edge of the firmware impact FSM
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.impact_events (
    id              bigint generated always as identity primary key,

    session_id      text    not null
                            references public.sessions (id) on delete cascade,

    -- Pairing to the matrix strike from the same physical hit. Nullable
    -- because the accelerometer fires on its own FSM: a hit can rail the
    -- accelerometer without registering 96-node contact, and vice versa.
    -- Resolved after upload by link_impacts_to_events() (§6).
    event_id        text    references public.events (event_id) on delete set null,

    -- Absolute delta between this impact's onset and the paired event's onset,
    -- in ms, written by link_impacts_to_events(). This exists so the pairing
    -- window can be set from production data rather than from a bench guess —
    -- see impact_pair_delta_stats() (§9).
    pair_delta_ms   integer,

    -- Rebound coalescing. IMPACT_MAX_MS is 500 and the release threshold is
    -- 3 g, so a swinging bag or a follow-through produces several FSM events
    -- per physical strike. Nothing collapses them on device. Every row is
    -- kept; the follow-ons point at the primary. `rebound_of is null` is the
    -- primary predicate — count and average over that, not over the table.
    rebound_of      bigint  references public.impact_events (id) on delete set null,

    -- Device record number, monotonic from firmware boot. Present from fw
    -- 1.4.2-c; NULL on anything older, and NULL is not a gap.
    --
    -- This exists because the loss it detects is otherwise invisible. The
    -- firmware hands each impact to a 6-deep tx queue shared with the matrix
    -- batches; on overflow the record is dropped and the only trace is a
    -- rate-limited serial warning nothing downstream ever sees. Batch drops are
    -- already observed in the field (28 in one session, 2026-09-10), and the
    -- queue is busiest during exactly the flurry of hits that produces impacts.
    -- The number is burned when the FSM closes the event, before the queue, so
    -- a dropped record leaves a hole. See impact_seq_gaps().
    impact_seq      integer,

    -- Firmware millisecond clock (esp_timer, session-relative). "t" is the
    -- event ONSET, not the send time — that is what lines an impact up with
    -- the matrix hits from the same strike.
    t_onset_ms      integer not null,
    t_peak_ms       integer not null,
    dur_ms          integer not null,

    -- |a| at the peak, and the vector it arrived on. All mg, sensor frame.
    peak_mg         integer not null,
    peak_x_mg       integer not null,
    peak_y_mg       integer not null,
    peak_z_mg       integer not null,

    -- ── Direction, computed. NOT rotation. ──────────────────────────────────
    -- The ADXL372 has no gyroscope and no magnetometer, and the HPF removes
    -- gravity, so there is no DC reference. These two angles are the direction
    -- of the peak acceleration vector IN THE SENSOR FRAME and nothing more.
    -- They are not angular velocity, not orientation, and not comparable
    -- across units until a mount transform is applied (see §3 and
    -- sessions.calibration).
    --
    --   azimuth_deg    in the sensor XY plane, 0 deg = +x, CCW positive,
    --                  range (-180, 180]
    --   elevation_deg  above/below that plane, range [-90, 90]
    --
    -- atan2 is used for both. The obvious elevation form, asin(z / |a|), needs
    -- a guarded divide AND a clamp: peak_mg is the firmware's rounded
    -- sqrt(x^2+y^2+z^2), so z/peak_mg can land just past 1.0 and throw a
    -- domain error. atan2(z, sqrt(x^2+y^2)) has neither failure mode.
    -- Both are immutable, so Postgres will store them.
    azimuth_deg     numeric generated always as (
        case when peak_x_mg = 0 and peak_y_mg = 0 then null::numeric
        else round(
            degrees(atan2(peak_y_mg::double precision,
                          peak_x_mg::double precision))::numeric, 2)
        end
    ) stored,

    elevation_deg   numeric generated always as (
        case when peak_x_mg = 0 and peak_y_mg = 0 and peak_z_mg = 0 then null::numeric
        else round(
            degrees(atan2(
                peak_z_mg::double precision,
                sqrt(peak_x_mg::double precision * peak_x_mg::double precision
                   + peak_y_mg::double precision * peak_y_mg::double precision)
            ))::numeric, 2)
        end
    ) stored,

    -- ── Capture conditions ──────────────────────────────────────────────────
    -- Same reasoning as the thresholds: a value captured under different
    -- settings is not comparable to one captured under these.
    g_range_g       smallint not null default 200,
    hpf             boolean  not null default true,
    impact_on_mg    integer  not null,
    impact_off_mg   integer  not null,

    -- mg per LSB, ODR and bandwidth are firmware constants today
    -- (ADXL_MG_PER_LSB 100, ODR 400 Hz, BW 200 Hz) and are NOT yet advertised
    -- in hello. They stay NULL rather than being backfilled from an assumed
    -- constant — backfilling an assumption is precisely the non-comparability
    -- these columns exist to prevent. fw_version is stored per row, so a value
    -- can be recovered from it later. FIRMWARE TODO: add "mg_per_lsb",
    -- "odr_hz", "bw_hz" to send_hello() and the app will start filling these.
    mg_per_lsb      integer,
    odr_hz          integer,
    bw_hz           integer,

    -- The rate the accelerometer was ACTUALLY sampled at, from hello "hz" —
    -- not the part's ODR. accel_sample() runs once per matrix frame inside
    -- scan_task, so the effective rate is the scan rate (measured ~317 Hz on
    -- 2026-09-10, and it moves with matrix load and BLE activity), not the
    -- 400 Hz ODR. A 5-15 ms hand strike is then 3-5 samples wide. Store what
    -- happened, per row, because it varies.
    sample_rate_hz_effective numeric,

    -- 'scan_loop' — sampled inside scan_task, one read per matrix frame.
    --               Rate is the scan rate and it is not uniform.
    -- 'fifo'      — drained from the ADXL372's internal FIFO at 1600-3200 Hz
    --               on the FSM falling edge. Not implemented yet.
    --
    -- NOT NULL with NO DEFAULT, on purpose. A default would be silently
    -- correct today and silently wrong the day FIFO lands, which is the exact
    -- failure this column exists to prevent. The writer states it.
    sample_source   text not null,

    fw_version      text,
    hw_rev          text,

    created_at      timestamptz not null default now(),

    -- Sync column, same reason as session_summaries: the mobile outbox
    -- (src/storage/sessionOutbox.ts) can land a Friday session on Monday, so
    -- arrival time and event time are different questions.
    ingested_at     timestamptz not null default now(),

    constraint impact_events_peak_after_onset check (t_peak_ms >= t_onset_ms),
    constraint impact_events_dur_nonneg       check (dur_ms >= 0),
    -- 200 g at 100 mg/LSB tops out near 204,800 mg; 250,000 is a sane outer bound.
    constraint impact_events_peak_sane        check (peak_mg between 0 and 250000),
    constraint impact_events_release_below_trigger
                                              check (impact_off_mg < impact_on_mg),
    constraint impact_events_sample_source_known
                                              check (sample_source in ('scan_loop','fifo')),
    constraint impact_events_rebound_not_self check (rebound_of is null or rebound_of <> id)
);

comment on table public.impact_events is
    'ADXL372 impact events from the TSA-V adapter, one row per falling edge of '
    'the firmware impact FSM. Units are mg throughout. Produced by send_impact() '
    'in app_main.c; the 10 Hz imu telemetry is intentionally not persisted. '
    'Aggregate over rows where rebound_of is null — the rest are follow-ons of '
    'the same physical strike.';

comment on column public.impact_events.t_onset_ms is
    'Event onset on the firmware clock, NOT the send time. Join key for pairing '
    'with matrix events from the same strike.';

comment on column public.impact_events.impact_on_mg is
    'Trigger threshold in force when this row was captured. Runtime tunable over '
    'BLE, so it must be stored per row for cross-session comparability.';

comment on column public.impact_events.azimuth_deg is
    'Direction of the peak acceleration vector in the SENSOR XY plane, degrees, '
    '0 = +x, CCW positive. Not rotation, not orientation — the part has no '
    'gyroscope. Not comparable between units until a mount transform is applied.';

comment on column public.impact_events.elevation_deg is
    'Elevation of the peak acceleration vector out of the SENSOR XY plane, '
    'degrees, [-90, 90]. Same caveats as azimuth_deg.';

comment on column public.impact_events.sample_source is
    'How the waveform behind this peak was sampled: scan_loop (one read per '
    'matrix frame, ~317 Hz and non-uniform) or fifo (ADXL372 internal FIFO, '
    'not implemented). Without this, the day the sampling path changes is the '
    'day every historical comparison silently becomes invalid.';

comment on column public.impact_events.sample_rate_hz_effective is
    'Measured sampling rate for this row, from hello "hz" — the scan rate, not '
    'the part ODR. Varies with matrix load and BLE activity.';

comment on column public.impact_events.rebound_of is
    'Primary impact this row is a follow-on of, set by mark_impact_rebounds(). '
    'NULL = this row is a primary. Impact counts and mean g must filter on this '
    'or they inflate and deflate respectively.';

comment on column public.impact_events.impact_seq is
    'Device record number, monotonic per firmware boot (fw >= 1.4.2-c, NULL '
    'below). Holes in the sequence within a session are impact records the BLE '
    'tx queue dropped. Not unique-indexed on purpose: a device reset mid-session '
    'restarts both this and t_onset_ms, and a constraint violation there would '
    'fail the whole upload over a diagnostic column.';

comment on column public.impact_events.pair_delta_ms is
    'ms between this impact onset and the paired matrix event onset, set by '
    'link_impacts_to_events(). Feeds impact_pair_delta_stats(), which is how '
    'the pairing window gets set from data instead of from a guess.';


-- ───────────────────────────────────────────────────────────────────────────
-- §2. Indexes
-- ───────────────────────────────────────────────────────────────────────────
-- The mobile uploader is an IndexedDB retry outbox: the same payload can be
-- replayed after a partial write. (session_id, t_onset_ms) is unique per
-- physical impact — the FSM cannot open two events at the same onset — so this
-- is what makes the insert an idempotent upsert instead of a duplicate.
create unique index if not exists impact_events_session_onset_key
    on public.impact_events (session_id, t_onset_ms);

-- Paired rows only. Keeps the index off the unpaired majority early on.
create index if not exists impact_events_event_id_idx
    on public.impact_events (event_id)
    where event_id is not null;

-- "hardest hit in this session", and the §8 summary rollup.
create index if not exists impact_events_session_peak_idx
    on public.impact_events (session_id, peak_mg desc);

-- Primaries only — what every aggregate should actually scan.
create index if not exists impact_events_session_primary_idx
    on public.impact_events (session_id, t_onset_ms)
    where rebound_of is null;

-- Partial sync index, mirroring the session_summaries pattern.
create index if not exists impact_events_ingested_idx
    on public.impact_events (session_id, ingested_at desc);


-- ───────────────────────────────────────────────────────────────────────────
-- §3. Rollup onto events — additive columns, all nullable
-- ───────────────────────────────────────────────────────────────────────────
-- The paired subset denormalized onto events so the app reads one row.
--
-- NULL is load-bearing and means NOT MEASURED. It must never be read as zero g.
-- Adapter Model IV has no accelerometer at all, every session before this drop
-- has no accel data, and an unpaired strike legitimately has none either.
--
-- events.angle_deg (matrix centroid) is NOT overwritten by accel_azimuth_deg.
-- They are two independent estimates of the same physical quantity and their
-- disagreement is a quality signal: a hit where the matrix says 5 deg and the
-- accelerometer says 40 is a glancing blow, a bad mount calibration, or a
-- mispair. All three are worth surfacing rather than averaging away.
alter table public.events
    add column if not exists accel_impact_id     bigint
        references public.impact_events (id) on delete set null,
    add column if not exists accel_peak_mg       integer,
    add column if not exists accel_azimuth_deg   numeric,
    add column if not exists accel_elevation_deg numeric,
    add column if not exists accel_impulse_g_ms  numeric;

comment on column public.events.accel_impulse_g_ms is
    'Integral of |a| over the impact pulse. Stays NULL in this drop: impulse '
    'is not derivable from a peak, and at 3-5 samples across a 5-15 ms pulse a '
    'trapezoid fit would be wrong by a wide margin. Fills when impact_waveforms '
    'and the FIFO drain path land.';

comment on column public.events.accel_azimuth_deg is
    'Accelerometer-derived direction, sensor frame. A SECOND estimate alongside '
    'events.angle_deg (matrix centroid) — neither overwrites the other.';

-- Reverse of impact_events_event_id_idx, for the events -> impact direction.
create index if not exists events_accel_impact_id_idx
    on public.events (accel_impact_id)
    where accel_impact_id is not null;


-- ───────────────────────────────────────────────────────────────────────────
-- §4. Rollup onto session_summaries — additive columns, all nullable
-- ───────────────────────────────────────────────────────────────────────────
alter table public.session_summaries
    add column if not exists accel_present     boolean,
    add column if not exists impact_count      integer,
    add column if not exists peak_g_mg         integer,
    add column if not exists mean_impact_g_mg  integer,
    add column if not exists accel_g_range_g   smallint;

comment on column public.session_summaries.accel_present is
    'NULL = not measured (no accelerometer, or a session predating this drop). '
    'false = the adapter reported accel:false in hello. Never read NULL as 0 g.';

comment on column public.session_summaries.impact_count is
    'Primary impacts only (impact_events.rebound_of is null). Counting every '
    'FSM edge inflates this and deflates mean_impact_g_mg.';


-- ───────────────────────────────────────────────────────────────────────────
-- §5. Coalesce rebounds
-- ───────────────────────────────────────────────────────────────────────────
-- Walk the session in onset order. A row within p_window_ms of the CURRENT
-- PRIMARY's onset is a follow-on of it; anything later opens a new primary.
-- Chaining from the primary rather than from the previous row is deliberate —
-- a long ring-down train would otherwise walk forward indefinitely and swallow
-- the next real strike.
--
-- p_window_ms 150 is PROVISIONAL. It has never been checked against a real
-- strike, because Tier B on unit 1 is still blocked at the brownout reboot
-- loop. Set it from measured pulse widths and inter-strike gaps once live
-- strikes exist. Re-running with a different window fully recomputes.
create or replace function public.mark_impact_rebounds(
    p_session_id text,
    p_window_ms  integer default 150
)
returns integer
language plpgsql
security invoker
as $$
declare
    r            record;
    v_primary_id bigint  := null;
    v_primary_t  integer := null;
    v_marked     integer := 0;
begin
    for r in
        select id, t_onset_ms
          from public.impact_events
         where session_id = p_session_id
         order by t_onset_ms, id
    loop
        if v_primary_id is null or (r.t_onset_ms - v_primary_t) > p_window_ms then
            v_primary_id := r.id;
            v_primary_t  := r.t_onset_ms;
            update public.impact_events
               set rebound_of = null
             where id = r.id and rebound_of is not null;
        else
            update public.impact_events
               set rebound_of = v_primary_id
             where id = r.id and rebound_of is distinct from v_primary_id;
            v_marked := v_marked + 1;
        end if;
    end loop;

    return v_marked;
end;
$$;

comment on function public.mark_impact_rebounds(text, integer) is
    'Marks follow-on FSM events as rebounds of the primary impact within '
    'p_window_ms. Returns the number of rows marked. Fully recomputes on '
    're-run, so it is safe to re-run with a retuned window.';


-- ───────────────────────────────────────────────────────────────────────────
-- §6. Pair impacts to matrix strikes by onset time
-- ───────────────────────────────────────────────────────────────────────────
-- Greedy nearest-onset match, each event claimed at most once. Done in SQL
-- after upload rather than on the device so the window can be retuned without
-- a firmware release.
--
-- ON THE WINDOW — the draft justified 60 ms by calling these "two independent
-- clocks." They are not independent. accel_sample(now) and the matrix frame
-- both take `now` from the same scan_task loop on the same esp_timer. One
-- clock, two detectors. What separates the two onsets is detector latency, not
-- clock drift, so 60 ms is far wider than needed and is actively buying
-- mispairs.
--
-- It is left at 60 anyway, because narrowing a guess to a different guess is
-- not an improvement. Instead every match records pair_delta_ms, so the real
-- distribution is queryable from production data (§9) — run wide once, read
-- the p99, then re-run narrow. Do NOT call this automatically on upload until
-- that number exists.
--
-- p_primaries_only: rebounds are additional FSM edges of a strike the matrix
-- saw once, so letting them compete for events manufactures mispairs. Run
-- mark_impact_rebounds() first. Set false to pair everything.
create or replace function public.link_impacts_to_events(
    p_session_id     text,
    p_window_ms      integer default 60,
    p_primaries_only boolean default true
)
returns integer
language plpgsql
security invoker
as $$
declare
    v_linked integer;
begin
    with candidate as (
        select i.id                              as impact_id,
               e.event_id                        as event_id,
               abs(e.t_start_ms - i.t_onset_ms)  as delta_ms,
               row_number() over (
                   partition by i.id
                   order by abs(e.t_start_ms - i.t_onset_ms), e.event_id
               ) as rn_impact
        from public.impact_events i
        join public.events e
          on e.session_id = i.session_id
         and e.t_start_ms is not null
         and abs(e.t_start_ms - i.t_onset_ms) <= p_window_ms
        where i.session_id = p_session_id
          and i.event_id is null
          and (not p_primaries_only or i.rebound_of is null)
    ),
    best as (
        select impact_id, event_id, delta_ms,
               row_number() over (
                   partition by event_id
                   order by delta_ms, impact_id
               ) as rn_event
        from candidate
        where rn_impact = 1
    )
    update public.impact_events i
       set event_id      = b.event_id,
           pair_delta_ms = b.delta_ms::integer
      from best b
     where i.id = b.impact_id
       and b.rn_event = 1;

    get diagnostics v_linked = row_count;
    return v_linked;
end;
$$;

comment on function public.link_impacts_to_events(text, integer, boolean) is
    'Pairs unpaired impact_events rows to events from the same strike by '
    'nearest onset within p_window_ms, recording the delta in pair_delta_ms. '
    'Returns rows linked. Idempotent: only touches rows where event_id is null.';


-- ───────────────────────────────────────────────────────────────────────────
-- §7. Push the paired values onto events
-- ───────────────────────────────────────────────────────────────────────────
-- accel_impulse_g_ms is untouched — see the §3 comment. Peak-only drop.
create or replace function public.rollup_impacts_to_events(p_session_id text)
returns integer
language plpgsql
security invoker
as $$
declare
    v_rows integer;
begin
    update public.events e
       set accel_impact_id     = i.id,
           accel_peak_mg       = i.peak_mg,
           accel_azimuth_deg   = i.azimuth_deg,
           accel_elevation_deg = i.elevation_deg
      from public.impact_events i
     where i.event_id   = e.event_id
       and i.session_id = p_session_id
       and e.session_id = p_session_id;

    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function public.rollup_impacts_to_events(text) is
    'Denormalizes the paired impact onto its events row so the app reads one '
    'row. Run after link_impacts_to_events(). Leaves accel_impulse_g_ms NULL — '
    'impulse is not derivable from a peak.';


-- ───────────────────────────────────────────────────────────────────────────
-- §8. Recompute the session_summaries rollup
-- ───────────────────────────────────────────────────────────────────────────
-- The app writes these inline with its summary insert (they are pure
-- aggregates over impacts it already holds, and need no pairing). This exists
-- for backfill and repair, and to recompute after mark_impact_rebounds()
-- changes which rows are primary.
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
           accel_g_range_g  = agg.g_range
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
       and agg.n > 0;

    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function public.rollup_impacts_to_session_summary(text) is
    'Recomputes the session_summaries accel rollup over PRIMARY impacts only. '
    'Does not write accel_present = false — absence of rows is not evidence the '
    'adapter lacked an accelerometer. The app sets false from hello.';


-- ───────────────────────────────────────────────────────────────────────────
-- §9. Measure the real onset-delta distribution
-- ───────────────────────────────────────────────────────────────────────────
-- This is how plan open question 1 gets answered: run link_impacts_to_events()
-- wide on real sessions, then read the p99 here and re-run narrow. p_session_id
-- NULL pools every session.
create or replace function public.impact_pair_delta_stats(p_session_id text default null)
returns table (n bigint, p50_ms numeric, p90_ms numeric, p99_ms numeric, max_ms integer)
language sql
stable
security invoker
as $$
    select count(*)::bigint,
           percentile_cont(0.50) within group (order by pair_delta_ms)::numeric,
           percentile_cont(0.90) within group (order by pair_delta_ms)::numeric,
           percentile_cont(0.99) within group (order by pair_delta_ms)::numeric,
           max(pair_delta_ms)::integer
      from public.impact_events
     where pair_delta_ms is not null
       and (p_session_id is null or session_id = p_session_id);
$$;

comment on function public.impact_pair_delta_stats(text) is
    'Percentiles of the matrix-to-accelerometer onset delta over paired rows. '
    'Set the link_impacts_to_events() window from the p99 of this, not from a '
    'bench estimate.';


-- ───────────────────────────────────────────────────────────────────────────
-- §9b. Count impact records lost in transit
-- ───────────────────────────────────────────────────────────────────────────
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


-- ───────────────────────────────────────────────────────────────────────────
-- §10. Row-level security
-- ───────────────────────────────────────────────────────────────────────────
alter table public.impact_events enable row level security;

-- Authenticated: delegate. entitlements.sql section 6 flags predicate
-- duplication as a sync hazard, so visibility is not a copy of the tier/scope
-- predicates — you can see an impact if and only if you can see its session,
-- and the subquery inherits the sessions policies. Read paths needing tier
-- masking go through the scoped SECURITY DEFINER functions, not this policy.
drop policy if exists impact_events_follows_session on public.impact_events;
drop policy if exists impact_events_rw_via_session  on public.impact_events;
create policy impact_events_rw_via_session
    on public.impact_events
    for all
    to authenticated
    using (
        exists (
            select 1 from public.sessions s
             where s.id = impact_events.session_id
        )
    )
    with check (
        exists (
            select 1 from public.sessions s
             where s.id = impact_events.session_id
        )
    );

-- Anonymous: INSERT only, and only under a session that is itself anonymous.
-- The delegation above CANNOT be reused here. anon has no SELECT policy on
-- sessions, so the inline EXISTS sees nothing and every anon impact insert
-- would fail — the exact trap reenable_rls_anon_uploads.sql documents for
-- events and event_cells. Same SECURITY DEFINER helper, same shape as
-- events_insert_anon. No anon SELECT/UPDATE/DELETE.
drop policy if exists impact_events_insert_anon on public.impact_events;
create policy impact_events_insert_anon
    on public.impact_events
    for insert
    to anon
    with check ( public.is_anon_session(session_id) );


-- PostgREST schema cache reload.
notify pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────────────────
-- Verification (run after)
-- ───────────────────────────────────────────────────────────────────────────
-- 1. RLS is on and both policies exist:
--      select relname, relrowsecurity from pg_class where relname = 'impact_events';
--      select policyname, roles, cmd from pg_policies where tablename = 'impact_events';
-- 2. Generated angles compute. +x should be azimuth 0, +y should be 90:
--      select azimuth_deg, elevation_deg from (values (1000,0,0),(0,1000,0),(0,0,1000)) v(x,y,z)
--      -- or insert a throwaway row under a test session and read it back.
-- 3. The pipeline runs in order on a real session:
--      select public.mark_impact_rebounds('<session_id>');
--      select public.link_impacts_to_events('<session_id>', 60);
--      select * from public.impact_pair_delta_stats('<session_id>');   -- read p99
--      select * from public.impact_seq_gaps('<session_id>');           -- loss floor
--      select public.link_impacts_to_events('<session_id>', <p99>);    -- re-run narrow
--      select public.rollup_impacts_to_events('<session_id>');
--      select public.rollup_impacts_to_session_summary('<session_id>');
-- 4. An anon upload from /m/home writes impact_events rows without error.
