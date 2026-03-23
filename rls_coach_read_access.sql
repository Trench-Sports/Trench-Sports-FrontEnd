-- =============================================================================
-- RLS: Coach Read Access for Core Team Data
-- =============================================================================
-- A coach is connected to one or more core teams via the team_members table:
--   team_members.coach_user_id = auth.uid()  →  team_members.team_id
--
-- These policies grant SELECT access to coaches for all data scoped to
-- the teams they appear in. Run this entire file in the Supabase SQL editor.
--
-- NOTE: This file only adds coach SELECT policies. It does not drop or
-- replace any existing policies. If you have existing policies that conflict,
-- review them first.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1: Helper functions (SECURITY DEFINER bypasses RLS when called
--         from within other policies, preventing infinite recursion)
-- ---------------------------------------------------------------------------

-- Returns the current user's role from their profile.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE user_id = auth.uid();
$$;

-- Returns the current user's program_id from their profile.
CREATE OR REPLACE FUNCTION public.get_my_program_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT program_id FROM public.profiles WHERE user_id = auth.uid();
$$;

-- Returns the set of team IDs the current coach is explicitly connected to
-- via team_members. Used by all downstream policies.
CREATE OR REPLACE FUNCTION public.get_my_coach_team_ids()
RETURNS TABLE(team_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.team_id
  FROM public.team_members tm
  WHERE tm.coach_user_id = auth.uid();
$$;


-- ---------------------------------------------------------------------------
-- STEP 2: Enable RLS on all tables (idempotent — safe to run even if
--         RLS is already enabled)
-- ---------------------------------------------------------------------------

ALTER TABLE public.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athletes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cells      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- STEP 3: Coach SELECT policies
-- ---------------------------------------------------------------------------

-- TEAMS
-- Coaches can see any team they are a member of.
DROP POLICY IF EXISTS "coaches_select_own_teams" ON public.teams;
CREATE POLICY "coaches_select_own_teams"
  ON public.teams
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND id IN (SELECT team_id FROM get_my_coach_team_ids())
  );

-- TEAM_MEMBERS
-- Coaches can see the full roster of any team they belong to.
DROP POLICY IF EXISTS "coaches_select_team_members" ON public.team_members;
CREATE POLICY "coaches_select_team_members"
  ON public.team_members
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND team_id IN (SELECT team_id FROM get_my_coach_team_ids())
  );

-- ATHLETES
-- Coaches can see athletes whose core_team_id is one of their teams,
-- or athletes directly assigned to them (coach_user_id).
DROP POLICY IF EXISTS "coaches_select_team_athletes" ON public.athletes;
CREATE POLICY "coaches_select_team_athletes"
  ON public.athletes
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND (
      core_team_id IN (SELECT team_id FROM get_my_coach_team_ids())
      OR coach_user_id = auth.uid()
    )
  );

-- SESSIONS
-- Coaches can see sessions recorded for their core teams.
DROP POLICY IF EXISTS "coaches_select_team_sessions" ON public.sessions;
CREATE POLICY "coaches_select_team_sessions"
  ON public.sessions
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND core_team_id IN (SELECT team_id FROM get_my_coach_team_ids())
  );

-- SESSION_SUMMARIES
-- Coaches can see summaries for sessions belonging to their core teams.
DROP POLICY IF EXISTS "coaches_select_team_session_summaries" ON public.session_summaries;
CREATE POLICY "coaches_select_team_session_summaries"
  ON public.session_summaries
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND core_team_id IN (SELECT team_id FROM get_my_coach_team_ids())
  );

-- EVENTS
-- Events are linked to sessions; coaches can see events for sessions
-- on their core teams.
DROP POLICY IF EXISTS "coaches_select_team_events" ON public.events;
CREATE POLICY "coaches_select_team_events"
  ON public.events
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND session_id IN (
      SELECT id FROM public.sessions
      WHERE core_team_id IN (SELECT team_id FROM get_my_coach_team_ids())
    )
  );

-- EVENT_CELLS
-- Event cells are linked to events; coaches can access cells for events
-- on sessions tied to their core teams.
DROP POLICY IF EXISTS "coaches_select_team_event_cells" ON public.event_cells;
CREATE POLICY "coaches_select_team_event_cells"
  ON public.event_cells
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND event_id IN (
      SELECT e.event_id
      FROM public.events e
      JOIN public.sessions s ON s.id = e.session_id
      WHERE s.core_team_id IN (SELECT team_id FROM get_my_coach_team_ids())
    )
  );

-- DEVICES
-- Coaches can see all devices registered to their program.
DROP POLICY IF EXISTS "coaches_select_program_devices" ON public.devices;
CREATE POLICY "coaches_select_program_devices"
  ON public.devices
  FOR SELECT
  USING (
    get_my_role() = 'coach'
    AND program_id = get_my_program_id()
  );

-- PROFILES
-- Coaches can read their own profile. They can also see other profiles
-- within the same program (e.g. to display coach names on a roster).
DROP POLICY IF EXISTS "coaches_select_profiles" ON public.profiles;
CREATE POLICY "coaches_select_profiles"
  ON public.profiles
  FOR SELECT
  USING (
    user_id = auth.uid()                        -- always own profile
    OR (
      get_my_role() = 'coach'
      AND program_id = get_my_program_id()      -- colleagues in same program
    )
  );


-- ---------------------------------------------------------------------------
-- STEP 4: Verify
-- ---------------------------------------------------------------------------
-- After running, you can spot-check with:
--
--   SELECT schemaname, tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- And test by running queries as a coach user (set role / JWT) to confirm
-- they only see rows for their assigned teams.
-- =============================================================================
