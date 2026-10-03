-- ═══════════════════════════════════════════════════════════════════════════
-- process_session_impacts.sql — run the impact post-processing on upload
-- ═══════════════════════════════════════════════════════════════════════════
-- Requires supabase/accel_events.sql (the four pipeline functions) and
-- supabase/rls_policies.sql (get_my_program_id). Idempotent and additive;
-- safe to re-run.
--
-- Until now the pipeline in accel_events.sql §5-§8 had no caller, so
-- events.accel_* and session_summaries.impact_count / peak_g_mg /
-- mean_impact_g_mg stayed NULL on every session. uploadSession() in
-- session.tsx / mobile/session.tsx / mobile/home.tsx now calls
-- process_session_impacts() once its last insert has landed.
--
-- ON THE WINDOWS — accel_events.sql §6 originally advised against auto-pairing
-- until the p99 onset delta was measured. The windows used here (150 ms
-- rebound, 60 ms pairing) are still the provisional ones. What makes auto-running them
-- acceptable is that reprocess_session_impacts() FULLY recomputes: it clears
-- every pairing and every denormalized accel_* value for the session before
-- rebuilding them. Once real strikes give a measured window, re-run it over
-- every session with the new values and nothing from the provisional pass
-- survives:
--
--   select public.reprocess_session_impacts(id, <rebound_ms>, <pair_ms>)
--     from public.sessions
--    where id in (select distinct session_id from public.impact_events);
--
-- Then change the defaults below so new uploads match.
--
-- Two functions, on purpose:
--   reprocess_session_impacts(id, windows)  service role only. Windows are a
--                                           tuning knob, not a client input;
--                                           a caller that could pass them
--                                           could rewrite a session's derived
--                                           accel data to anything.
--   process_session_impacts(id)             the RPC the app calls. Fixed
--                                           windows, access-checked.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- §1. The full recompute, windows as parameters
-- ───────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the steps UPDATE events and session_summaries, and
-- neither a coach nor anon has an UPDATE policy there — the invoker-rights
-- pipeline functions would silently match zero rows. The functions it calls
-- are SECURITY INVOKER, so they inherit the definer's rights from here.
create or replace function public.reprocess_session_impacts(
    p_session_id        text,
    p_rebound_window_ms integer default 150,
    p_pair_window_ms    integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rebounds  integer;
    v_linked    integer;
    v_events    integer;
    v_summary   integer;
begin
    -- An outbox replay and the original upload can land together; two
    -- interleaved recomputes of the same session would mispair.
    perform pg_advisory_xact_lock(hashtext('process_session_impacts:' || p_session_id));

    -- Clear derived state so a narrower window cannot leave a stale pairing
    -- behind. link_impacts_to_events() only touches rows with event_id null,
    -- and rollup_impacts_to_events() only writes events that ARE paired, so
    -- without this an event unpaired by a re-run would keep its old values.
    update public.events
       set accel_impact_id     = null,
           accel_peak_mg       = null,
           accel_azimuth_deg   = null,
           accel_elevation_deg = null
     where session_id = p_session_id
       and accel_impact_id is not null;

    update public.impact_events
       set event_id      = null,
           pair_delta_ms = null
     where session_id = p_session_id
       and event_id is not null;

    v_rebounds := public.mark_impact_rebounds(p_session_id, p_rebound_window_ms);
    v_linked   := public.link_impacts_to_events(p_session_id, p_pair_window_ms, true);
    v_events   := public.rollup_impacts_to_events(p_session_id);
    v_summary  := public.rollup_impacts_to_session_summary(p_session_id);

    return jsonb_build_object(
        'rebounds_marked',   v_rebounds,
        'impacts_linked',    v_linked,
        'events_updated',    v_events,
        'summary_updated',   v_summary > 0,
        'rebound_window_ms', p_rebound_window_ms,
        'pair_window_ms',    p_pair_window_ms
    );
end;
$$;

comment on function public.reprocess_session_impacts(text, integer, integer) is
    'Fully recomputes rebounds, impact↔event pairing and the events / '
    'session_summaries accel rollups for one session. Service role only — use '
    'it to re-run sessions after retuning the windows.';

revoke all on function public.reprocess_session_impacts(text, integer, integer)
    from public, anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- §2. The RPC the app calls after upload
-- ───────────────────────────────────────────────────────────────────────────
-- Access mirrors who may upload the session in the first place:
--   • authenticated — the session belongs to the caller's program
--     (sessions_insert in rls_policies.sql);
--   • anyone        — the session is anonymous (program_id null), the same
--     rule as is_anon_session() for the anon insert policies.
-- For anon, get_my_program_id() is null, so only anonymous sessions pass.
create or replace function public.process_session_impacts(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_program uuid;
begin
    select s.program_id into v_program
      from public.sessions s
     where s.id = p_session_id;

    -- One error for "missing" and "someone else's", so the RPC cannot be used
    -- to probe whether a session id exists in another program.
    if not found
       or (v_program is not null and v_program is distinct from public.get_my_program_id()) then
        raise exception 'not authorised for session %', p_session_id using errcode = '42501';
    end if;

    return public.reprocess_session_impacts(p_session_id);
end;
$$;

comment on function public.process_session_impacts(text) is
    'Post-upload impact processing at the default windows. Called by '
    'uploadSession() after the session_summaries insert. Safe to call again.';

revoke all on function public.process_session_impacts(text) from public;
grant execute on function public.process_session_impacts(text) to anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- §3. Take the step functions away from clients
-- ───────────────────────────────────────────────────────────────────────────
-- accel_events.sql §5-§8 left these callable by anon/authenticated, which
-- let a client re-run pairing at any window it liked and undercut §1's "the
-- windows are not a client input". Nothing in src/ calls them; they run from
-- the definer above, whose owner keeps EXECUTE.
revoke all on function public.mark_impact_rebounds(text, integer)             from public, anon, authenticated;
revoke all on function public.link_impacts_to_events(text, integer, boolean)  from public, anon, authenticated;
revoke all on function public.rollup_impacts_to_events(text)                  from public, anon, authenticated;
revoke all on function public.rollup_impacts_to_session_summary(text)         from public, anon, authenticated;


-- PostgREST schema cache reload.
notify pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────────────────
-- Verification (run after)
-- ───────────────────────────────────────────────────────────────────────────
-- 1. Grants — process_ is callable by anon/authenticated; reprocess_ and the
--    four step functions are not:
--      select p.proname, r.rolname,
--             has_function_privilege(r.rolname, p.oid, 'execute') as can_exec
--        from pg_proc p cross join pg_roles r
--       where p.proname in ('process_session_impacts', 'reprocess_session_impacts',
--                         'mark_impact_rebounds', 'link_impacts_to_events',
--                         'rollup_impacts_to_events', 'rollup_impacts_to_session_summary')
--         and r.rolname in ('anon', 'authenticated');
-- 2. On a session with impacts, twice — the second result must match the first:
--      select public.reprocess_session_impacts('<session_id>');
-- 3. The rollups landed:
--      select impact_count, peak_g_mg, mean_impact_g_mg
--        from public.session_summaries where session_id = '<session_id>';
--      select count(*) from public.events
--       where session_id = '<session_id>' and accel_impact_id is not null;
