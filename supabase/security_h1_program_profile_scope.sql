-- =============================================================================
-- SECURITY FIX H1: Tighten read scope on programs and profiles
-- =============================================================================
-- Problem this fixes:
--   1. programs had `USING (true)` SELECT — ANY visitor (even logged-out) could
--      dump every program row, including each program's `onboarding_code`, which
--      is effectively the secret needed to join a program.
--   2. profiles let ANY same-program member read EVERY colleague's full row,
--      exposing email, city, state, and date_of_birth to all members.
--
-- After this file:
--   - A user can read only their OWN program row (id = their program_id).
--   - The "join by 6-digit code" onboarding flow goes through a SECURITY DEFINER
--     RPC that returns only id/name/location for the ONE program matching the
--     code the user typed — no enumeration, no code/billing leakage.
--   - A user can always read their own profile in full. Reading OTHER members'
--     profiles is restricted to admins (the only feature that needs it is the
--     admin program-management screen).
--
-- Depends on helper functions defined in rls_policies.sql:
--   public.get_my_program_id(), public.get_my_role()
--
-- Idempotent: safe to run multiple times. Run in the Supabase SQL editor.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PROGRAMS
-- ---------------------------------------------------------------------------

-- Remove the wide-open public read.
DROP POLICY IF EXISTS "programs_select_public" ON public.programs;

-- Members can read only their own program.
DROP POLICY IF EXISTS "programs_select_member" ON public.programs;
CREATE POLICY "programs_select_member"
  ON public.programs
  FOR SELECT
  USING (id = public.get_my_program_id());

-- Join-by-code lookup for users who are NOT yet members. SECURITY DEFINER so it
-- can read past RLS, but it ONLY returns a program when the caller already knows
-- the exact 6-digit code, and it returns NO sensitive columns (no onboarding_code
-- echo needed — the caller already has it; no billing/limit fields).
CREATE OR REPLACE FUNCTION public.find_program_by_code(p_code text)
RETURNS TABLE(id uuid, name text, location text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.location
  FROM public.programs p
  WHERE p.onboarding_code = p_code
    AND p_code ~ '^[0-9]{6}$'   -- reject malformed input outright
  LIMIT 1;
$$;

-- Lock down execution: only logged-in users mid-onboarding should call this.
REVOKE ALL ON FUNCTION public.find_program_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_program_by_code(text) TO authenticated;

-- Creating a program needs to return the new row's id, but the members-only
-- SELECT policy above hides a just-inserted program from its creator (they are
-- not a member until their profile is attached). So creation also goes through a
-- SECURITY DEFINER RPC: it validates input, inserts, and returns the new row.
CREATE OR REPLACE FUNCTION public.create_program(
  p_name     text,
  p_location text,
  p_code     text
)
RETURNS TABLE(id uuid, name text, location text, onboarding_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated to create a program';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'program name is required';
  END IF;
  IF p_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'onboarding code must be exactly 6 digits';
  END IF;

  INSERT INTO public.programs (name, location, onboarding_code)
  VALUES (
    btrim(p_name),
    nullif(btrim(coalesce(p_location, '')), ''),
    p_code
  )
  RETURNING programs.id INTO v_id;

  RETURN QUERY
    SELECT p.id, p.name, p.location, p.onboarding_code
    FROM public.programs p
    WHERE p.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_program(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_program(text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------

-- Own profile: full read (unchanged — keep if it already exists).
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (user_id = auth.uid());

-- Replace the broad same-program peer read with an admin-only peer read.
-- Non-admins can no longer read colleagues' email / city / state / DOB.
DROP POLICY IF EXISTS "profiles_select_same_program" ON public.profiles;

DROP POLICY IF EXISTS "profiles_select_same_program_admin" ON public.profiles;
CREATE POLICY "profiles_select_same_program_admin"
  ON public.profiles
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND program_id = public.get_my_program_id()
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   SELECT polname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('programs','profiles')
--   ORDER BY tablename, polname;
--
-- Manual checks:
--   * As a logged-out user: SELECT * FROM programs;  -> 0 rows.
--   * As a non-admin coach:  SELECT * FROM profiles WHERE user_id <> auth.uid(); -> 0 rows.
--   * As any authenticated user: SELECT * FROM find_program_by_code('123456');
--       -> returns the matching program (id, name, location) or nothing.
-- =============================================================================
