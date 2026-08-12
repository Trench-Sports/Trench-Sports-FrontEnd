-- ─────────────────────────────────────────────────────────────────────────────
-- LIVE SNAPSHOT — SECURITY DEFINER functions & triggers
-- Pulled from the live Supabase project on 2026-06-27 (pg_proc / pg_get_functiondef).
-- ─────────────────────────────────────────────────────────────────────────────
-- This is a verbatim record of what is actually deployed, for reference and diff.
-- The table POLICIES that call these live in supabase/rls_policies.sql; the
-- trigger functions are also documented in supabase/fix_summary_session_triggers.sql.
-- Verified 2026-06-27: live definitions match those repo files (semantically).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── RLS helper functions (called by policies in rls_policies.sql) ─────────────

CREATE OR REPLACE FUNCTION public.get_my_program_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select program_id from profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role::text from profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_core_team_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tm.team_id
  from team_members tm
  join teams t on t.id = tm.team_id
  where tm.coach_user_id = auth.uid()
    and t.team_type::text = 'core'
  limit 1;
$function$;

-- ── Join / create program RPCs (security_h1_program_profile_scope.sql) ───────
-- Added to this snapshot 2026-08-12. These were missing: the file had not been
-- caught up since security_h1 landed. Definitions copied from that file, which
-- is the applied source; re-pull from pg_get_functiondef to re-verify verbatim.

CREATE OR REPLACE FUNCTION public.find_program_by_code(p_code text)
 RETURNS TABLE(id uuid, name text, location text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.location
  FROM public.programs p
  WHERE p.onboarding_code = p_code
    AND p_code ~ '^[0-9]{6}$'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.create_program(p_name text, p_location text, p_code text)
 RETURNS TABLE(id uuid, name text, location text, onboarding_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT p.id, p.name, p.location, p.onboarding_code::text
    FROM public.programs p
    WHERE p.id = v_id;
END;
$function$;

-- ── BEFORE-INSERT trigger functions on session_summaries ─────────────────────
-- (documented in fix_summary_session_triggers.sql)

CREATE OR REPLACE FUNCTION public.sync_summary_keys_from_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record;
begin
  select program_id, core_team_id, athlete_id into s
  from public.sessions
  where id = new.session_id;

  if not found then
    raise exception 'session not found for summary';
  end if;

  new.program_id   := s.program_id;
  new.core_team_id := s.core_team_id;
  new.athlete_id   := s.athlete_id;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.sync_summary_mode_from_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.mode := (select mode from public.sessions where id = new.session_id);
  return new;
end $function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- ── Coach invite links (coach_invite_links.sql) ──────────────────────────────
-- NOT YET VERIFIED AGAINST THE LIVE PROJECT. Added here 2026-08-12 alongside the
-- frontend so the snapshot stays complete; these are copies of the migration,
-- not a pg_get_functiondef pull. Re-pull and replace this whole section once
-- coach_invite_links.sql has actually been applied in the SQL editor.
--
-- Grants (create/redeem/list/revoke -> authenticated; preview -> anon +
-- authenticated) live in the migration and are NOT repeated here.
--
-- MAINTENANCE RULE for redeem_coach_invite: its RETURNS TABLE output names
-- collide with real columns on profiles/programs/teams. Every column reference
-- must stay alias-qualified or Postgres raises 42702 at CALL time, not CREATE
-- time — it will apply green and fail for the first coach who clicks a link.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_coach_invite(p_core_team_id uuid, p_label text DEFAULT NULL)
 RETURNS TABLE(invite_id uuid, token text, expires_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_program_id uuid;
  v_token      text;
  v_id         uuid;
  v_expires    timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  v_program_id := public.get_my_program_id();

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'no program attached to your account';
  END IF;

  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'only program admins can create coach invites';
  END IF;

  PERFORM 1
  FROM public.teams t
  WHERE t.id = p_core_team_id
    AND t.program_id = v_program_id
    AND t.team_type = 'core';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'core team not found in your program';
  END IF;

  PERFORM 1
  FROM public.programs p
  WHERE p.id = v_program_id
    AND p.status = 'suspended';

  IF FOUND THEN
    RAISE EXCEPTION 'this program is suspended — contact Trench Sports support';
  END IF;

  -- Serialize concurrent Generate clicks for this program.
  PERFORM 1 FROM public.programs p WHERE p.id = v_program_id FOR UPDATE;

  -- One live link per PROGRAM (coach_invite_single_active_link.sql).
  PERFORM 1
  FROM public.coach_invites ci
  WHERE ci.program_id = v_program_id
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now();

  IF FOUND THEN
    RAISE EXCEPTION 'this program already has an active invite link — copy it, or revoke it to create a new one';
  END IF;

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '72 hours';

  INSERT INTO public.coach_invites (
    program_id, core_team_id, created_by, token, token_hash, expires_at, label
  )
  VALUES (
    v_program_id,
    p_core_team_id,
    auth.uid(),
    v_token,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires,
    nullif(btrim(coalesce(p_label, '')), '')
  )
  RETURNING coach_invites.id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_coach_invite(p_token text)
 RETURNS TABLE(program_id uuid, program_name text, core_team_id uuid, core_team_name text, expires_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, t.id, t.name, ci.expires_at
  FROM public.coach_invites ci
  JOIN public.programs p ON p.id = ci.program_id
  JOIN public.teams    t ON t.id = ci.core_team_id
  WHERE p_token ~ '^[0-9a-f]{64}$'
    AND ci.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_coach_invite(p_token text)
 RETURNS TABLE(program_id uuid, core_team_id uuid, program_name text, core_team_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_invite        public.coach_invites;
  v_existing      uuid;
  v_existing_role text;
  v_existing_core uuid;
  v_max_coaches   integer;
  v_coach_count   integer;
  v_program_name  text;
  v_team_name     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'must be authenticated to redeem an invite';
  END IF;

  IF p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid invite link';
  END IF;

  SELECT * INTO v_invite
  FROM public.coach_invites ci
  WHERE ci.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid invite link';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'this invite link has been revoked';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'this invite link has expired';
  END IF;

  -- Serialize on the PROGRAM, not the invite: a program can have several live
  -- links, and locking the invite row lets two redemptions race past the cap.
  PERFORM 1 FROM public.programs p WHERE p.id = v_invite.program_id FOR UPDATE;

  SELECT pr.program_id, pr.role::text
    INTO v_existing, v_existing_role
  FROM public.profiles pr
  WHERE pr.user_id = v_uid;

  IF v_existing_role = 'admin' THEN
    RAISE EXCEPTION 'admin accounts cannot redeem coach invite links';
  END IF;

  IF v_existing IS NOT NULL AND v_existing <> v_invite.program_id THEN
    RAISE EXCEPTION 'your account is already attached to another program';
  END IF;

  IF v_existing IS NULL THEN
    SELECT p.max_coaches INTO v_max_coaches
    FROM public.programs p WHERE p.id = v_invite.program_id;

    IF v_max_coaches IS NOT NULL THEN
      SELECT count(*) INTO v_coach_count
      FROM public.profiles pr
      WHERE pr.program_id = v_invite.program_id
        AND pr.role = 'coach';

      IF v_coach_count >= v_max_coaches THEN
        RAISE EXCEPTION 'this program has reached its coach limit — contact your admin';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.profiles (user_id, program_id, role, email)
  VALUES (
    v_uid,
    v_invite.program_id,
    'coach'::user_role,
    (SELECT u.email FROM auth.users u WHERE u.id = v_uid)
  )
  ON CONFLICT (user_id) DO UPDATE
    SET program_id = v_invite.program_id,
        role       = 'coach'::user_role,
        email      = coalesce(profiles.email, excluded.email);

  SELECT tm.team_id INTO v_existing_core
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.coach_user_id = v_uid
    AND t.team_type = 'core'
  LIMIT 1;

  IF v_existing_core IS NULL THEN
    INSERT INTO public.team_members (
      program_id, team_id, coach_user_id, member_role, added_by
    )
    VALUES (
      v_invite.program_id, v_invite.core_team_id, v_uid, 'coach', v_invite.created_by
    );
  ELSIF v_existing_core <> v_invite.core_team_id THEN
    RAISE EXCEPTION 'your account is already assigned to a different core team — ask your admin to move you';
  END IF;

  INSERT INTO public.coach_invite_redemptions (
    invite_id, program_id, core_team_id, user_id
  )
  VALUES (
    v_invite.id, v_invite.program_id, v_invite.core_team_id, v_uid
  )
  ON CONFLICT (invite_id, user_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.coach_invites
       SET redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     WHERE id = v_invite.id;
  END IF;

  SELECT p.name INTO v_program_name FROM public.programs p WHERE p.id = v_invite.program_id;
  SELECT t.name INTO v_team_name    FROM public.teams    t WHERE t.id = v_invite.core_team_id;

  RETURN QUERY SELECT v_invite.program_id, v_invite.core_team_id, v_program_name, v_team_name;
END;
$function$;

-- NOTE: adding `token` changed the return type, so applying this requires
-- DROP FUNCTION first — CREATE OR REPLACE cannot change a return type, and the
-- DROP also drops the grants. See coach_invite_single_active_link.sql.
CREATE OR REPLACE FUNCTION public.list_coach_invites()
 RETURNS TABLE(invite_id uuid, core_team_id uuid, core_team_name text, label text, token text, created_at timestamptz, expires_at timestamptz, redemption_count integer, last_redeemed_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ci.id, ci.core_team_id, t.name, ci.label, ci.token, ci.created_at,
         ci.expires_at, ci.redemption_count, ci.last_redeemed_at
  FROM public.coach_invites ci
  JOIN public.teams t ON t.id = ci.core_team_id
  WHERE ci.program_id = public.get_my_program_id()
    AND public.get_my_role() = 'admin'
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now()
  ORDER BY ci.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_coach_invite(p_invite_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_program_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  v_program_id := public.get_my_program_id();

  IF v_program_id IS NULL OR public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'only program admins can revoke coach invites';
  END IF;

  UPDATE public.coach_invites
     SET revoked_at = now(),
         token      = NULL
   WHERE id = p_invite_id
     AND program_id = v_program_id
     AND revoked_at IS NULL;

  RETURN FOUND;
END;
$function$;
