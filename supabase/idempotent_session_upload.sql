-- ═══════════════════════════════════════════════════════════════════════════
-- idempotent_session_upload.sql — let the outbox replay a half-written upload
-- ═══════════════════════════════════════════════════════════════════════════
-- Requires supabase/entitlements_enforcement.sql and supabase/accel_events.sql.
-- Idempotent; safe to re-run.
--
-- WHY
--
-- uploadSession() writes sessions → impact_events → events → event_cells →
-- session_summaries as separate requests. When a later stage failed, the
-- payload went to the on-device outbox, and every replay began with a plain
-- sessions insert that now collided on sessions_pkey (23505 / HTTP 409) —
-- every 30 s, forever. ses_1790873489020_185dy (2026-10-01) was stuck exactly
-- like that: sessions + 1429 events written, no session_summaries row.
--
-- The client now writes every stage with ON CONFLICT DO NOTHING. sessions,
-- events and session_summaries already have natural primary keys. The two
-- tables keyed by an identity column need a natural unique key for the
-- conflict target, or a replay would duplicate their rows:
--
--   event_cells   (event_id, r, c)        one row per cell per event frame
--   impact_events (session_id, t_onset_ms) dedupeImpacts() keys on onset
--
-- And the monthly session cap must not reject a replay of a session that is
-- already stored: BEFORE INSERT triggers fire even when the insert then
-- resolves to DO NOTHING.

-- ── 1. Refuse to build a unique index over existing duplicates ─────────────
do $$
declare
  v_cells   bigint;
  v_impacts bigint;
begin
  select count(*) into v_cells from (
    select 1 from public.event_cells
     group by event_id, r, c having count(*) > 1
  ) d;
  select count(*) into v_impacts from (
    select 1 from public.impact_events
     group by session_id, t_onset_ms having count(*) > 1
  ) d;
  if v_cells > 0 or v_impacts > 0 then
    raise exception
      'Duplicate keys already stored: % event_cells (event_id,r,c), % impact_events (session_id,t_onset_ms). Resolve them before re-running.',
      v_cells, v_impacts;
  end if;
end $$;

-- ── 2. Natural keys for ON CONFLICT ─────────────────────────────────────────
create unique index if not exists event_cells_event_rc_key
  on public.event_cells (event_id, r, c);

create unique index if not exists impact_events_session_onset_key
  on public.impact_events (session_id, t_onset_ms);

-- ── 3. Monthly cap: a replay of an existing session is not a new session ────
-- Same as entitlements_enforcement.sql, plus the early return on new.id.
-- Keep the two copies identical.
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

  -- Outbox replay: the row is already stored and the insert will resolve to
  -- ON CONFLICT DO NOTHING. It was counted when it was first written.
  if exists (select 1 from public.sessions where id = new.id) then
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

-- ── Verification ────────────────────────────────────────────────────────────
-- select indexname from pg_indexes
--  where indexname in ('event_cells_event_rc_key', 'impact_events_session_onset_key');
--
-- Sessions still missing their summary (should drain once clients update):
-- select s.id, s.created_at from public.sessions s
--  where not exists (select 1 from public.session_summaries ss where ss.session_id = s.id)
--  order by s.created_at desc;
