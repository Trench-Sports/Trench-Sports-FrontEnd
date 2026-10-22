-- ═══════════════════════════════════════════════════════════════════════════
-- event_cells_upsert_grant.sql — unblock event_cells uploads
-- ═══════════════════════════════════════════════════════════════════════════
-- Requires supabase/entitlements.sql and supabase/idempotent_session_upload.sql.
-- Idempotent; safe to re-run.
--
-- WHY
--
-- entitlements.sql revokes every SELECT privilege on event_cells from anon and
-- authenticated. That was harmless while uploadSession() used a plain insert.
-- idempotent_session_upload.sql (Oct 3) switched every stage to
-- ON CONFLICT DO NOTHING, and Postgres requires SELECT on each conflict-target
-- column to infer the arbiter index. events and session_summaries kept SELECT
-- on their keys (event_id, session_id) so they kept working; event_cells kept
-- none, so every event_cells chunk failed:
--
--   permission denied for table event_cells   (app_events, stage event_cells)
--
-- uploadSession() throws at that stage, so session_summaries is never written
-- and process_session_impacts() never runs. Every session since Oct 3 is
-- missing its cells, its summary and its accelerometer rollups, and sits in
-- the recording device's outbox retrying every 30 s.
--
-- WHAT THIS EXPOSES
--
-- SELECT on the three key columns only. Rows stay behind the existing RLS
-- SELECT policies (own program, coach scope); anon has no SELECT policy and
-- still reads nothing. An authenticated user can now see which cells were hit
-- in each event of their own program's sessions — but not voltages, timing
-- or peaks, which remain behind tiered_session_events().
--
-- AFTER APPLYING
--
-- Open the app on the device that recorded the stuck sessions. The outbox
-- replay completes event_cells, writes session_summaries and runs
-- process_session_impacts(). Then the verification queries below should show
-- every stuck session with cells and a summary.

grant select (event_id, r, c) on public.event_cells to anon, authenticated;

notify pgrst, 'reload schema';


-- ── Verification ────────────────────────────────────────────────────────────
-- 1. The grant landed (expect 6 rows: 3 columns × 2 roles):
--      select grantee, column_name from information_schema.column_privileges
--       where table_name = 'event_cells' and privilege_type = 'SELECT'
--         and grantee in ('anon', 'authenticated');
--
-- 2. After the outbox drains, nothing since Oct 3 is missing its summary:
--      select s.id, s.created_at from public.sessions s
--       where not exists (select 1 from public.session_summaries ss where ss.session_id = s.id)
--         and s.created_at > '2026-10-03'
--       order by s.created_at desc;
--
-- 3. Upload failures stopped:
--      select ts, error_code, props->>'stage' from public.app_events
--       where name = 'session.upload_stage_failed' order by ts desc limit 10;
