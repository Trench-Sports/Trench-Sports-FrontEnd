-- =====================================================================
-- TRENCH SPORTS — TELEMETRY EVENT SINK (app_events)
-- =====================================================================
-- Part 1, Phase 1 of docs/observability-and-code-audit-plan.md (§1.3 / §1.4).
--
-- The write target for src/lib/telemetry.ts and src/lib/errorReporting.ts.
-- /m/home is anonymous (finding I), so this is a PUBLIC insert endpoint —
-- guarded, but public. It accepts inserts from anon + authenticated and
-- allows NO reads/updates/deletes to the browser. Internal reads happen only
-- through SECURITY DEFINER RPCs (see supabase/telemetry_admin.sql).
--
-- Run once against the live Supabase project. Idempotent (safe to re-run).
-- =====================================================================


-- ── 1. Table ─────────────────────────────────────────────────────────
create table if not exists public.app_events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),   -- server time, authoritative
  client_ts   timestamptz,                           -- device clock; diff = skew
  name        text not null,
  client_id   text not null,        -- anon uuid in localStorage, survives logout
  user_id     uuid references auth.users(id) on delete set null,
  program_id  uuid references public.programs(id) on delete set null,
  session_id  text,                 -- intentionally NO FK: may not exist yet
  device_id   text,
  platform    text check (platform in ('web','ios')),
  app_version text,
  ok          boolean,              -- promoted out of props — queried everywhere
  error_code  text,
  duration_ms integer,
  props       jsonb not null default '{}'
);

-- session_id has no FK on purpose: session.started fires before the sessions
-- row exists, and upload-failure events describe sessions that never will.


-- ── 2. Indexes ───────────────────────────────────────────────────────
create index if not exists app_events_ts_idx           on public.app_events (ts desc);
create index if not exists app_events_name_ts_idx       on public.app_events (name, ts desc);
create index if not exists app_events_program_ts_idx    on public.app_events (program_id, ts desc) where program_id is not null;
create index if not exists app_events_errors_idx        on public.app_events (ts desc) where ok is false;


-- ── 3. RLS: open insert, no read/update/delete ───────────────────────
alter table public.app_events enable row level security;

drop policy if exists "anyone can insert telemetry" on public.app_events;
create policy "anyone can insert telemetry"
  on public.app_events for insert
  to anon, authenticated
  with check (
    length(name) <= 64
    and length(client_id) <= 64
    and pg_column_size(props) < 4096
  );

-- No select/update/delete policy for anon or authenticated → the browser can
-- write telemetry but never read it back. Admin reads bypass RLS via the
-- SECURITY DEFINER RPCs in telemetry_admin.sql.


-- ── 4. Optional hardening (plan §1.4, in priority order) ─────────────
-- Enable these as/when abuse appears — deliberately NOT on by default so a
-- stale client adding a new event name isn't silently dropped on day one.
--
-- (1) Name whitelist — tighten `name` to the §1.2 taxonomy. Update this list
--     whenever the taxonomy grows, and deploy the SQL BEFORE the client that
--     emits the new name, or those events are rejected:
--
-- alter table public.app_events add constraint app_events_name_whitelist
--   check (name = any (array[
--     'app.opened','app.error',
--     'auth.signup_succeeded','auth.signup_failed',
--     'auth.login_succeeded','auth.login_failed',
--     'onboarding.step_completed','onboarding.guard_failed',
--     'invite.created','invite.opened','invite.redeemed','invite.rejected','invite.revoked',
--     'ble.connect_attempted','ble.connect_succeeded','ble.connect_failed','ble.disconnected',
--     'session.started','session.stopped','session.discarded',
--     'session.upload_started','session.upload_stage_failed','session.upload_succeeded',
--     'outbox.enqueued','outbox.flush_succeeded','outbox.flush_failed'
--   ]));
--
-- (2) Rate limit — a before-insert trigger rejecting > N inserts per client_id
--     per minute. Cheap insurance against a runaway client or abuse.
--
-- (3) PII rule (§1.4/§2.4) — never put athlete names, emails, or raw sensor
--     values in props. Enforced in the client + the telemetry-PII audit agent.
