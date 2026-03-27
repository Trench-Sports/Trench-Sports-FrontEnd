-- =====================================================================
-- TRENCH SPORTS — ROW LEVEL SECURITY POLICIES
-- =====================================================================
-- Mirrors the access-control logic in the frontend:
--
--   ADMIN  → sees / edits all data within their program
--   COACH  → scoped to their own core team (and sub-teams under it)
--
-- Run this once against your Supabase project.  If you need to re-run,
-- drop the policies and functions first (see the "Reset" block at the
-- bottom of this file).
-- =====================================================================


-- =====================================================================
-- 1. ENABLE RLS ON EVERY TABLE
-- =====================================================================
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athletes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cells      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices          ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- 2. HELPER FUNCTIONS
-- =====================================================================
-- All three functions use SECURITY DEFINER so they can read `profiles`
-- directly without triggering RLS recursion.  The SET search_path pins
-- them to the public schema to prevent search-path injection.
-- =====================================================================

-- Returns the program_id for the calling user.
CREATE OR REPLACE FUNCTION public.get_my_program_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT program_id
  FROM   public.profiles
  WHERE  user_id = auth.uid()
$$;

-- Returns the role ('admin' or 'coach') for the calling user.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM   public.profiles
  WHERE  user_id = auth.uid()
$$;

-- Returns the core team ID for a coach.
-- Matches the dashboard.tsx query:
--   team_members.coach_user_id = user.id  AND  teams.team_type = 'core'
CREATE OR REPLACE FUNCTION public.get_my_core_team_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.team_id
  FROM   public.team_members tm
  JOIN   public.teams t ON t.id = tm.team_id
  WHERE  tm.coach_user_id = auth.uid()
    AND  t.team_type = 'core'
  LIMIT  1
$$;


-- =====================================================================
-- 3. PROGRAMS
-- =====================================================================
-- Programs are looked up by `onboarding_code` before a profile exists
-- (anonymous / newly-signed-up user), so SELECT is public.
-- Only admins may update their own program.  Authenticated users may
-- insert a program (needed when an admin creates a brand-new program
-- during the admin-onboarding flow).
-- =====================================================================

-- Anyone (including anon) can read programs — needed for onboarding-code lookup.
CREATE POLICY "programs_select_public"
  ON public.programs FOR SELECT
  USING (true);

-- Any authenticated user may create a program (they become the admin).
CREATE POLICY "programs_insert_authenticated"
  ON public.programs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Admins may update their own program's settings.
CREATE POLICY "programs_update_admin"
  ON public.programs FOR UPDATE
  USING (
    id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Deletion is intentionally left to the service role only.


-- =====================================================================
-- 4. PROFILES
-- =====================================================================
-- Users always see/update their own profile.
-- All members of the same program can read each other's profiles
-- (coaches need to see coach names on teams, admins need the full list).
-- Admins can also update any profile within their program
-- (e.g. role promotions, program management).
-- New users may insert their own profile during onboarding.
-- =====================================================================

-- Own profile — always visible.
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (user_id = auth.uid());

-- All profiles within the same program are visible to authenticated members.
CREATE POLICY "profiles_select_same_program"
  ON public.profiles FOR SELECT
  USING (program_id = get_my_program_id());

-- New user inserts their own profile row during sign-up / onboarding.
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users update their own profile.
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (user_id = auth.uid());

-- Admins can update any profile in their program (role changes, etc.).
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );


-- =====================================================================
-- 5. TEAMS
-- =====================================================================
-- Mirrors dashboard.tsx:
--   Admin   → all teams in program
--   Coach   → their own core team + sub-teams whose parent is that core team
--             (query uses neq(team_type,"core") + eq(parent_team_id, coreTeamId))
-- =====================================================================

-- Admins see all teams in their program.
CREATE POLICY "teams_select_admin"
  ON public.teams FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches see their own core team and sub-teams under it.
CREATE POLICY "teams_select_coach"
  ON public.teams FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND (
      id = get_my_core_team_id()
      OR parent_team_id = get_my_core_team_id()
    )
  );

-- Admins can create any team type in their program.
CREATE POLICY "teams_insert_admin"
  ON public.teams FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches can create sub-teams parented to their own core team only.
-- Mirrors manageTeam.jsx: canCreateCore = role === "admin"
CREATE POLICY "teams_insert_coach"
  ON public.teams FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND team_type = 'sub'
    AND parent_team_id = get_my_core_team_id()
  );

-- Admins update any team in their program.
CREATE POLICY "teams_update_admin"
  ON public.teams FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches can update sub-teams they personally created under their core team.
-- Mirrors manageTeam.jsx: canEditName = !isEdit || isCreator
CREATE POLICY "teams_update_coach"
  ON public.teams FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND team_type = 'sub'
    AND parent_team_id = get_my_core_team_id()
    AND created_by = auth.uid()
  );

-- Only admins can delete teams.
CREATE POLICY "teams_delete_admin"
  ON public.teams FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );


-- =====================================================================
-- 6. TEAM_MEMBERS
-- =====================================================================
-- Admins see all members in the program.
-- Coaches see members of their core team AND its sub-teams.
-- =====================================================================

CREATE POLICY "team_members_select_admin"
  ON public.team_members FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "team_members_select_coach"
  ON public.team_members FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND (
      team_id = get_my_core_team_id()
      OR team_id IN (
        SELECT id FROM public.teams
        WHERE  parent_team_id = get_my_core_team_id()
      )
    )
  );

-- Admins can add anyone to any team in their program.
CREATE POLICY "team_members_insert_admin"
  ON public.team_members FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches can add athletes to sub-teams under their core team.
-- Also covers the coach's own onboarding insert (team_id = their core team).
CREATE POLICY "team_members_insert_coach"
  ON public.team_members FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND (
      -- Joining their own core team during onboarding
      team_id = get_my_core_team_id()
      OR
      -- Adding an athlete to a sub-team under their core team
      team_id IN (
        SELECT id FROM public.teams
        WHERE  parent_team_id = get_my_core_team_id()
      )
    )
  );

-- Admins update any team_member row in their program.
CREATE POLICY "team_members_update_admin"
  ON public.team_members FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Admins delete any team_member row in their program.
CREATE POLICY "team_members_delete_admin"
  ON public.team_members FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches can remove athletes from sub-teams under their core team.
CREATE POLICY "team_members_delete_coach"
  ON public.team_members FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND team_id IN (
      SELECT id FROM public.teams
      WHERE  parent_team_id = get_my_core_team_id()
    )
  );


-- =====================================================================
-- 7. ATHLETES
-- =====================================================================
-- Mirrors dashboard.tsx + createAthlete.jsx:
--   Admin  → all athletes in program
--   Coach  → athletes where core_team_id = their core team
-- =====================================================================

CREATE POLICY "athletes_select_admin"
  ON public.athletes FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "athletes_select_coach"
  ON public.athletes FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

-- Admins create athletes anywhere in their program.
CREATE POLICY "athletes_insert_admin"
  ON public.athletes FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

-- Coaches create athletes only for their own core team.
-- Mirrors createAthlete.jsx: core_team_id locked to coachTeamId for coaches.
CREATE POLICY "athletes_insert_coach"
  ON public.athletes FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

CREATE POLICY "athletes_update_admin"
  ON public.athletes FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "athletes_update_coach"
  ON public.athletes FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

CREATE POLICY "athletes_delete_admin"
  ON public.athletes FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "athletes_delete_coach"
  ON public.athletes FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );


-- =====================================================================
-- 8. SESSIONS
-- =====================================================================
-- Mirrors dashboard.tsx session queries.
-- INSERT is open to any authenticated user in the program so that device
-- upload flows (which run under the anon/service key) can write rows.
-- If your device firmware uses the SERVICE ROLE key it bypasses RLS
-- entirely — no change needed.  If it uses the ANON key, tighten the
-- INSERT policy here or add a device JWT claim.
-- =====================================================================

CREATE POLICY "sessions_select_admin"
  ON public.sessions FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "sessions_select_coach"
  ON public.sessions FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

-- Any authenticated member of the program can upload a new session.
CREATE POLICY "sessions_insert"
  ON public.sessions FOR INSERT
  WITH CHECK (program_id = get_my_program_id());

CREATE POLICY "sessions_update_admin"
  ON public.sessions FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "sessions_update_coach"
  ON public.sessions FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

-- Only admins delete sessions.
CREATE POLICY "sessions_delete_admin"
  ON public.sessions FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );


-- =====================================================================
-- 9. SESSION_SUMMARIES
-- =====================================================================
-- Identical scoping to sessions.
-- =====================================================================

CREATE POLICY "session_summaries_select_admin"
  ON public.session_summaries FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "session_summaries_select_coach"
  ON public.session_summaries FOR SELECT
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'coach'
    AND core_team_id = get_my_core_team_id()
  );

CREATE POLICY "session_summaries_insert"
  ON public.session_summaries FOR INSERT
  WITH CHECK (program_id = get_my_program_id());

CREATE POLICY "session_summaries_update_admin"
  ON public.session_summaries FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "session_summaries_delete_admin"
  ON public.session_summaries FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );


-- =====================================================================
-- 10. EVENTS
-- =====================================================================
-- events has no program_id column, so we scope through the parent
-- sessions row.  The EXISTS subquery is index-friendly as long as
-- sessions(id) and sessions(program_id, core_team_id) are indexed.
-- =====================================================================

CREATE POLICY "events_select"
  ON public.events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.sessions s
      WHERE  s.id = events.session_id
        AND  s.program_id = get_my_program_id()
        AND  (
          get_my_role() = 'admin'
          OR (
            get_my_role() = 'coach'
            AND s.core_team_id = get_my_core_team_id()
          )
        )
    )
  );

-- Device / app can insert events for sessions in the same program.
CREATE POLICY "events_insert"
  ON public.events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.sessions s
      WHERE  s.id = events.session_id
        AND  s.program_id = get_my_program_id()
    )
  );

-- Events are immutable once written — no UPDATE or DELETE policies.


-- =====================================================================
-- 11. EVENT_CELLS
-- =====================================================================
-- Scoped through events → sessions (two-hop JOIN).
-- =====================================================================

CREATE POLICY "event_cells_select"
  ON public.event_cells FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.events e
      JOIN   public.sessions s ON s.id = e.session_id
      WHERE  e.event_id = event_cells.event_id
        AND  s.program_id = get_my_program_id()
        AND  (
          get_my_role() = 'admin'
          OR (
            get_my_role() = 'coach'
            AND s.core_team_id = get_my_core_team_id()
          )
        )
    )
  );

-- Device / app inserts event_cells for events already in the program.
CREATE POLICY "event_cells_insert"
  ON public.event_cells FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.events e
      JOIN   public.sessions s ON s.id = e.session_id
      WHERE  e.event_id = event_cells.event_id
        AND  s.program_id = get_my_program_id()
    )
  );

-- event_cells are immutable — no UPDATE or DELETE policies.


-- =====================================================================
-- 12. DEVICES
-- =====================================================================
-- All authenticated members of a program can see that program's devices.
-- Only admins can add, update, or remove devices.
-- =====================================================================

CREATE POLICY "devices_select"
  ON public.devices FOR SELECT
  USING (program_id = get_my_program_id());

CREATE POLICY "devices_insert_admin"
  ON public.devices FOR INSERT
  WITH CHECK (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "devices_update_admin"
  ON public.devices FOR UPDATE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );

CREATE POLICY "devices_delete_admin"
  ON public.devices FOR DELETE
  USING (
    program_id = get_my_program_id()
    AND get_my_role() = 'admin'
  );


-- =====================================================================
-- RECOMMENDED INDEXES (if not already present)
-- =====================================================================
-- These ensure the policy EXISTS subqueries stay fast at scale.
--
-- CREATE INDEX IF NOT EXISTS idx_sessions_program_id     ON public.sessions(program_id);
-- CREATE INDEX IF NOT EXISTS idx_sessions_core_team_id   ON public.sessions(core_team_id);
-- CREATE INDEX IF NOT EXISTS idx_events_session_id        ON public.events(session_id);
-- CREATE INDEX IF NOT EXISTS idx_event_cells_event_id     ON public.event_cells(event_id);
-- CREATE INDEX IF NOT EXISTS idx_team_members_coach_uid   ON public.team_members(coach_user_id);
-- CREATE INDEX IF NOT EXISTS idx_teams_parent_team_id     ON public.teams(parent_team_id);


-- =====================================================================
-- RESET BLOCK (run this first if you need to re-apply)
-- =====================================================================
-- DROP POLICY IF EXISTS "programs_select_public"               ON public.programs;
-- DROP POLICY IF EXISTS "programs_insert_authenticated"        ON public.programs;
-- DROP POLICY IF EXISTS "programs_update_admin"                ON public.programs;
-- DROP POLICY IF EXISTS "profiles_select_own"                  ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_select_same_program"         ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_insert_own"                  ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_update_own"                  ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_update_admin"                ON public.profiles;
-- DROP POLICY IF EXISTS "teams_select_admin"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_select_coach"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_insert_admin"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_insert_coach"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_update_admin"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_update_coach"                   ON public.teams;
-- DROP POLICY IF EXISTS "teams_delete_admin"                   ON public.teams;
-- DROP POLICY IF EXISTS "team_members_select_admin"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_select_coach"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_insert_admin"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_insert_coach"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_update_admin"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_delete_admin"            ON public.team_members;
-- DROP POLICY IF EXISTS "team_members_delete_coach"            ON public.team_members;
-- DROP POLICY IF EXISTS "athletes_select_admin"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_select_coach"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_insert_admin"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_insert_coach"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_update_admin"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_update_coach"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_delete_admin"                ON public.athletes;
-- DROP POLICY IF EXISTS "athletes_delete_coach"                ON public.athletes;
-- DROP POLICY IF EXISTS "sessions_select_admin"                ON public.sessions;
-- DROP POLICY IF EXISTS "sessions_select_coach"                ON public.sessions;
-- DROP POLICY IF EXISTS "sessions_insert"                      ON public.sessions;
-- DROP POLICY IF EXISTS "sessions_update_admin"                ON public.sessions;
-- DROP POLICY IF EXISTS "sessions_update_coach"                ON public.sessions;
-- DROP POLICY IF EXISTS "sessions_delete_admin"                ON public.sessions;
-- DROP POLICY IF EXISTS "session_summaries_select_admin"       ON public.session_summaries;
-- DROP POLICY IF EXISTS "session_summaries_select_coach"       ON public.session_summaries;
-- DROP POLICY IF EXISTS "session_summaries_insert"             ON public.session_summaries;
-- DROP POLICY IF EXISTS "session_summaries_update_admin"       ON public.session_summaries;
-- DROP POLICY IF EXISTS "session_summaries_delete_admin"       ON public.session_summaries;
-- DROP POLICY IF EXISTS "events_select"                        ON public.events;
-- DROP POLICY IF EXISTS "events_insert"                        ON public.events;
-- DROP POLICY IF EXISTS "event_cells_select"                   ON public.event_cells;
-- DROP POLICY IF EXISTS "event_cells_insert"                   ON public.event_cells;
-- DROP POLICY IF EXISTS "devices_select"                       ON public.devices;
-- DROP POLICY IF EXISTS "devices_insert_admin"                 ON public.devices;
-- DROP POLICY IF EXISTS "devices_update_admin"                 ON public.devices;
-- DROP POLICY IF EXISTS "devices_delete_admin"                 ON public.devices;
-- DROP FUNCTION IF EXISTS public.get_my_program_id();
-- DROP FUNCTION IF EXISTS public.get_my_role();
-- DROP FUNCTION IF EXISTS public.get_my_core_team_id();
