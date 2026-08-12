-- =============================================================================
-- COACH INVITE LINKS — temporary, program+core-scoped onboarding links
-- =============================================================================
-- What this adds:
--   A program admin generates a link. Any coach who opens it within 72 hours
--   lands in onboarding with the program AND core team already resolved and
--   locked. Redemption stamps profiles.program_id + role='coach' and inserts
--   the team_members row — the same two writes completeCoachOnboarding() does
--   today, but performed server-side so they can't be tampered with.
--
-- Why SECURITY DEFINER for all of it:
--   The invitee is NOT a program member when they redeem. Every relevant RLS
--   policy is keyed on get_my_program_id() / get_my_core_team_id(), which are
--   both NULL for them — and team_members_insert_coach requires
--   `team_id = get_my_core_team_id()`, which is circular during a first join.
--   Same problem find_program_by_code() and create_program() were built for
--   (see security_h1_program_profile_scope.sql:42-45, 64-67).
--
-- Token model:
--   256-bit token generated in the DB, returned to the admin exactly once, and
--   stored only as a SHA-256 hash. The link IS the credential, so we treat it
--   like a password: never logged, never re-displayable, revocable, expiring.
--
-- Depends on:
--   public.get_my_program_id(), public.get_my_role()   (rls_policies.sql)
--   pgcrypto (gen_random_bytes, digest) — ships enabled on Supabase in the
--   `extensions` schema. Calls are fully qualified as extensions.digest(...) so
--   search_path stays pinned to `public` like every other definer function in
--   this repo. If the preflight below reports a different schema, swap the
--   `extensions.` prefixes to match; the CREATEs will fail loudly otherwise.
--
-- Idempotent: safe to run multiple times. Run in the Supabase SQL editor.
-- =============================================================================

-- PREFLIGHT — must return one row reading `pgcrypto | extensions`:
--   SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'pgcrypto';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_invites (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  program_id        uuid        NOT NULL,
  core_team_id      uuid        NOT NULL,
  created_by        uuid,
  -- SHA-256 hex of the plaintext token. The plaintext is never stored.
  token_hash        text        NOT NULL,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  -- Multi-use: one link can onboard a whole staff until it expires.
  redemption_count  integer     NOT NULL DEFAULT 0,
  last_redeemed_at  timestamptz,
  -- Optional admin-facing note, e.g. "Fall 2026 staff".
  label             text,
  CONSTRAINT coach_invites_pkey PRIMARY KEY (id),
  CONSTRAINT coach_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT coach_invites_program_id_fkey
    FOREIGN KEY (program_id) REFERENCES public.programs(id) ON DELETE CASCADE,
  CONSTRAINT coach_invites_core_team_id_fkey
    FOREIGN KEY (core_team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Points at profiles, NOT auth.users: redemption copies this into
  -- team_members.added_by, which FKs profiles(user_id) with NO ACTION. Pointing
  -- at auth.users would let a deleted-profile-but-live-auth-user admin turn
  -- every redemption of their invites into a raw FK error.
  CONSTRAINT coach_invites_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL
);

-- The UNIQUE constraint on token_hash already provides the redemption-lookup
-- index; don't add a second btree on the same column.
CREATE INDEX IF NOT EXISTS coach_invites_program_id_idx
  ON public.coach_invites (program_id, created_at DESC);

-- Audit trail: who actually walked through each link.
CREATE TABLE IF NOT EXISTS public.coach_invite_redemptions (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  invite_id    uuid        NOT NULL,
  program_id   uuid        NOT NULL,
  core_team_id uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  CONSTRAINT coach_invite_redemptions_pkey PRIMARY KEY (id),
  CONSTRAINT coach_invite_redemptions_unique UNIQUE (invite_id, user_id),
  CONSTRAINT coach_invite_redemptions_invite_id_fkey
    FOREIGN KEY (invite_id) REFERENCES public.coach_invites(id) ON DELETE CASCADE,
  CONSTRAINT coach_invite_redemptions_program_id_fkey
    FOREIGN KEY (program_id) REFERENCES public.programs(id) ON DELETE CASCADE,
  CONSTRAINT coach_invite_redemptions_core_team_id_fkey
    FOREIGN KEY (core_team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT coach_invite_redemptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
-- Reads: admins, own program only. token_hash is safe to expose (it is a hash,
-- and it is useless without the plaintext).
-- Writes: NO policy at all — every mutation goes through the definer RPCs
-- below, so nothing can forge, extend, or un-revoke an invite.

ALTER TABLE public.coach_invites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_invite_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_invites_select_admin" ON public.coach_invites;
CREATE POLICY "coach_invites_select_admin"
  ON public.coach_invites
  FOR SELECT
  USING (
    program_id = public.get_my_program_id()
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "coach_invite_redemptions_select_admin" ON public.coach_invite_redemptions;
CREATE POLICY "coach_invite_redemptions_select_admin"
  ON public.coach_invite_redemptions
  FOR SELECT
  USING (
    program_id = public.get_my_program_id()
    AND public.get_my_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 3. CREATE — admin generates a link
-- ---------------------------------------------------------------------------
-- Returns the plaintext token EXACTLY ONCE. There is no way to retrieve it
-- again; if the admin loses it they generate a new one.

CREATE OR REPLACE FUNCTION public.create_coach_invite(
  p_core_team_id uuid,
  p_label        text DEFAULT NULL
)
RETURNS TABLE(invite_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- The core team must belong to the caller's own program and actually be a
  -- core. Never trust the id the client passed.
  PERFORM 1
  FROM public.teams t
  WHERE t.id = p_core_team_id
    AND t.program_id = v_program_id
    AND t.team_type = 'core';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'core team not found in your program';
  END IF;

  -- A suspended program shouldn't be able to onboard new staff.
  PERFORM 1
  FROM public.programs p
  WHERE p.id = v_program_id
    AND p.status = 'suspended';

  IF FOUND THEN
    RAISE EXCEPTION 'this program is suspended — contact Trench Sports support';
  END IF;

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');   -- 256-bit, 64 hex chars
  v_expires := now() + interval '72 hours';

  INSERT INTO public.coach_invites (
    program_id, core_team_id, created_by, token_hash, expires_at, label
  )
  VALUES (
    v_program_id,
    p_core_team_id,
    auth.uid(),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires,
    nullif(btrim(coalesce(p_label, '')), '')
  )
  RETURNING coach_invites.id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.create_coach_invite(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coach_invite(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. PREVIEW — unauthenticated peek at what the link is for
-- ---------------------------------------------------------------------------
-- Granted to anon because the invitee clicks the link before they have an
-- account. Returns display names only: no onboarding_code, no billing fields,
-- no member list, no PII. Returns zero rows for unknown/expired/revoked
-- tokens, which the UI renders as "this link is no longer valid".
--
-- Enumeration: the token is 256 bits of CSPRNG output. Guessing is infeasible.

CREATE OR REPLACE FUNCTION public.preview_coach_invite(p_token text)
RETURNS TABLE(
  program_id     uuid,
  program_name   text,
  core_team_id   uuid,
  core_team_name text,
  expires_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- The regex is a filter, not a short-circuit guard — SQL gives no evaluation
  -- ordering, so digest() may run on malformed input. Harmless (it hashes any
  -- bytes), but don't read this as input validation the way redeem's explicit
  -- IF ... RAISE is.
  SELECT p.id, p.name, t.id, t.name, ci.expires_at
  FROM public.coach_invites ci
  JOIN public.programs p ON p.id = ci.program_id
  JOIN public.teams    t ON t.id = ci.core_team_id
  WHERE p_token ~ '^[0-9a-f]{64}$'
    AND ci.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.preview_coach_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_coach_invite(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. REDEEM — attach the signed-in coach to the program + core
-- ---------------------------------------------------------------------------
-- Performs the same two writes as completeCoachOnboarding() (onboarding.tsx
-- :294-322 — except added_by is the inviting admin, not the coach themselves)
-- plus the seat-cap check the app has never enforced. Forces role='coach'
-- server-side, which also closes the self-asserted-role hole for invited users
-- (profiles_update_own currently lets anyone set role='admin').
--
-- Idempotent: re-redeeming the same live link as the same user succeeds.
--
-- MAINTENANCE RULE: the RETURNS TABLE output names (program_id, core_team_id,
-- program_name, core_team_name) are also plpgsql variables in this body, and
-- they collide with real column names on profiles/programs/teams. Every column
-- reference inside an expression MUST stay alias-qualified (pr.program_id,
-- p.max_coaches, t.name). Drop an alias and Postgres raises 42702 "column
-- reference is ambiguous" — at CALL time, not CREATE time, so it will apply
-- clean in the SQL editor and fail for the first coach who clicks a link.

CREATE OR REPLACE FUNCTION public.redeem_coach_invite(p_token text)
RETURNS TABLE(program_id uuid, core_team_id uuid, program_name text, core_team_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Serialize on the PROGRAM, not the invite. A program can have several live
  -- links (one per core team), and locking the invite row would let two
  -- redemptions of two different links race past the seat cap below.
  PERFORM 1 FROM public.programs p WHERE p.id = v_invite.program_id FOR UPDATE;

  SELECT pr.program_id, pr.role::text
    INTO v_existing, v_existing_role
  FROM public.profiles pr
  WHERE pr.user_id = v_uid;

  -- Admins must never redeem: the profiles upsert below force-sets
  -- role='coach', so a program admin clicking their own link would demote
  -- themselves out of their own program. Recoverable only via the
  -- self-asserted-role hole that profiles_update_own leaves open — once that is
  -- fixed, a single-admin program would be permanently locked out.
  IF v_existing_role = 'admin' THEN
    RAISE EXCEPTION 'admin accounts cannot redeem coach invite links';
  END IF;

  -- Already in a DIFFERENT program: refuse. An admin must detach them first
  -- (program.jsx handleRemove nulls program_id), otherwise a stray link could
  -- silently move a coach and orphan their athletes/sessions.
  IF v_existing IS NOT NULL AND v_existing <> v_invite.program_id THEN
    RAISE EXCEPTION 'your account is already attached to another program';
  END IF;

  -- Seat cap (programs.max_coaches). Enforced here because this is the only
  -- server-side chokepoint for joining a program.
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

  -- Write 1: attach to program, force role. Other profile fields (name,
  -- position, city, state, DOB) are written by the onboarding steps and are
  -- deliberately left untouched here.
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

  -- Write 2: core-team membership. get_my_core_team_id() does `LIMIT 1`, so a
  -- coach must never hold two core memberships. Three distinct cases — do NOT
  -- collapse them into a single "insert if none exists", because that silently
  -- no-ops for a coach who already has a different core while this function
  -- still returns the invite's core, so the UI shows one core and the dashboard
  -- scopes to another.
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

  -- Bookkeeping. redemption_count counts distinct humans, not clicks.
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
$$;

REVOKE ALL ON FUNCTION public.redeem_coach_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_coach_invite(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. LIST / REVOKE — admin management
-- ---------------------------------------------------------------------------
-- Live links only, newest first. Deliberately returns NO token material, so
-- there is no way to recover a link after generation.

CREATE OR REPLACE FUNCTION public.list_coach_invites()
RETURNS TABLE(
  invite_id        uuid,
  core_team_id     uuid,
  core_team_name   text,
  label            text,
  created_at       timestamptz,
  expires_at       timestamptz,
  redemption_count integer,
  last_redeemed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ci.id, ci.core_team_id, t.name, ci.label, ci.created_at,
         ci.expires_at, ci.redemption_count, ci.last_redeemed_at
  FROM public.coach_invites ci
  JOIN public.teams t ON t.id = ci.core_team_id
  WHERE ci.program_id = public.get_my_program_id()
    AND public.get_my_role() = 'admin'
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now()
  ORDER BY ci.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_coach_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_coach_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_coach_invite(p_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     SET revoked_at = now()
   WHERE id = p_invite_id
     AND program_id = v_program_id
     AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_coach_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_coach_invite(uuid) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Policies exist and RLS is on:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('coach_invites','coach_invite_redemptions');
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('coach_invites','coach_invite_redemptions');
--
-- Grants are as intended (preview should be the only one with anon):
--   SELECT p.proname, array_agg(a.rolname ORDER BY a.rolname)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
--   JOIN pg_roles a ON a.oid = acl.grantee
--   WHERE n.nspname = 'public'
--     AND p.proname LIKE '%coach_invite%'
--     AND acl.privilege_type = 'EXECUTE'
--   GROUP BY p.proname;
--
-- Manual checks:
--   * As a coach:   SELECT * FROM create_coach_invite('<core uuid>');   -> raises
--   * As an admin:  SELECT * FROM create_coach_invite('<core uuid>');   -> token
--   * Cross-program core uuid, or a team_type='sub' uuid                -> raises
--   * Logged out:   SELECT * FROM preview_coach_invite('<token>');      -> 1 row
--   * Logged out:   SELECT * FROM coach_invites;                        -> 0 rows
--   * As the admin who made it: SELECT * FROM redeem_coach_invite(...)  -> raises
--                   ('admin accounts cannot redeem') — NOT a demotion
--   * Coach already in core A redeems a core-B link (same program)      -> raises
--   * Same coach redeems the same live link twice -> succeeds, and
--                   redemption_count stays at 1
--   * Expiry:       UPDATE coach_invites SET expires_at = now() - interval '1 min'
--                   WHERE id = '<id>';
--                   SELECT * FROM preview_coach_invite('<token>');      -> 0 rows
--                   SELECT * FROM redeem_coach_invite('<token>');       -> raises
--
-- Seat cap under concurrency (the reason we lock programs, not coach_invites):
--   Set max_coaches to current coach count + 1, mint TWO links for different
--   core teams, redeem both simultaneously in separate sessions. Exactly one
--   must succeed. Then confirm no coach holds two core memberships:
--     SELECT tm.coach_user_id, count(*)
--     FROM team_members tm JOIN teams t ON t.id = tm.team_id
--     WHERE t.team_type = 'core'
--     GROUP BY 1 HAVING count(*) > 1;            -> 0 rows
-- =============================================================================
