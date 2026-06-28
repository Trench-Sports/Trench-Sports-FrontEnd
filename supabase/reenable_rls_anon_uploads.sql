-- ─────────────────────────────────────────────────────────────────────────────
-- Re-enable RLS on the anonymous-upload tables WITHOUT breaking /m/home saves.
-- ─────────────────────────────────────────────────────────────────────────────
-- Context:
--   home.tsx uploadSession() runs under the ANON key (no auth) and writes:
--     sessions → events → event_cells → session_summaries
--   with program_id = NULL (anonymous MVP; attributed via device_uid + location).
--
--   The existing policies all gate on program_id = get_my_program_id(), which is
--   NULL for anon, so every insert is rejected → RLS was disabled on these tables.
--
-- Strategy:
--   * Re-enable RLS on all four tables.
--   * Keep ALL existing authenticated/program-scoped policies untouched.
--   * ADD narrow INSERT-only policies for the `anon` role that permit ONLY rows
--     whose owning session has program_id IS NULL. No anon SELECT/UPDATE/DELETE,
--     so anonymous clients can write their own upload but cannot read anyone's
--     data. Real program data stays fully protected.
--
--   * Child tables (events, event_cells) must verify the parent is anonymous.
--     Under RLS the anon role cannot SELECT the parent row, so an inline EXISTS
--     subquery would see nothing and fail. We use SECURITY DEFINER helpers that
--     do the lookup bypassing RLS (read-only, single boolean — safe).
--
-- Run AFTER add_sessions_device_id.sql. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. SECURITY DEFINER lookup helpers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_anon_session(p_session_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE  s.id = p_session_id
      AND  s.program_id IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_anon_event(p_event_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.events  e
    JOIN   public.sessions s ON s.id = e.session_id
    WHERE  e.event_id = p_event_id
      AND  s.program_id IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_anon_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_anon_event(text)   TO anon, authenticated;

-- ── 2. Re-enable RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cells       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;

-- ── 3. Anonymous INSERT policies (additive; existing policies preserved) ──────
-- sessions: anon may insert ONLY anonymous rows (no program, no athlete, no user).
DROP POLICY IF EXISTS "sessions_insert_anon" ON public.sessions;
CREATE POLICY "sessions_insert_anon"
  ON public.sessions FOR INSERT
  TO anon
  WITH CHECK (
    program_id IS NULL
    AND athlete_id IS NULL
    AND created_by IS NULL
  );

-- events: anon may insert rows whose parent session is anonymous.
DROP POLICY IF EXISTS "events_insert_anon" ON public.events;
CREATE POLICY "events_insert_anon"
  ON public.events FOR INSERT
  TO anon
  WITH CHECK ( public.is_anon_session(session_id) );

-- event_cells: anon may insert rows whose parent event belongs to an anon session.
DROP POLICY IF EXISTS "event_cells_insert_anon" ON public.event_cells;
CREATE POLICY "event_cells_insert_anon"
  ON public.event_cells FOR INSERT
  TO anon
  WITH CHECK ( public.is_anon_event(event_id) );

-- session_summaries: anon may insert anonymous summaries. The BEFORE-INSERT
-- trigger sync_summary_keys_from_session() copies program_id from the parent
-- session (NULL for anon) before this WITH CHECK is evaluated, so it passes.
DROP POLICY IF EXISTS "session_summaries_insert_anon" ON public.session_summaries;
CREATE POLICY "session_summaries_insert_anon"
  ON public.session_summaries FOR INSERT
  TO anon
  WITH CHECK ( program_id IS NULL );

-- PostgREST schema cache reload.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after) ─────────────────────────────────────────────────
-- 1. Confirm RLS is back on:
--      SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname IN ('sessions','events','event_cells','session_summaries');
-- 2. From the app (anon key), run a full /m/home save end-to-end. All four
--    inserts should succeed; a coach/admin should still see ONLY their program's
--    rows and NOT these anonymous rows.
