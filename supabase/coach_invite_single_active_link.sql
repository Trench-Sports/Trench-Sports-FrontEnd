-- =============================================================================
-- COACH INVITE LINKS — one active link per program, permanently re-copyable
-- =============================================================================
-- Follow-up to coach_invite_links.sql (already applied). Two behaviour changes:
--
--   1. A program may hold AT MOST ONE live invite link. While one is live,
--      create_coach_invite() refuses; the admin copies the existing link or
--      revokes it and generates a new one.
--
--   2. The link stays copyable for its whole life. list_coach_invites() now
--      returns the plaintext token, so any admin of the program can re-share
--      it — not just whoever happened to generate it.
--
-- SECURITY TRADE-OFF — read before running.
--   coach_invite_links.sql stored ONLY the SHA-256 of the token, so a database
--   leak yielded no usable links (plan §7). Requirement 2 is incompatible with
--   that: re-displaying a link means the server has to hold it. So this adds a
--   plaintext `token` column and the "a DB leak yields no usable links"
--   property is GONE for coach invites. What still bounds it:
--
--     • at most ONE live token per program (requirement 1)
--     • ≤72h lifetime, unchanged
--     • token NULLed on revoke, below
--     • readable only via list_coach_invites(), which is admin-and-own-program
--       gated, or the equally gated coach_invites_select_admin RLS policy
--
--   token_hash is UNCHANGED and is still the redemption lookup key — redeem and
--   preview never read `token`. Keeping both means an expired row's plaintext
--   is inert: nothing resolves a token except by hash.
--
--   Expired-but-unrevoked rows do retain their plaintext. They are unusable
--   (both preview and redeem check expires_at) and list_coach_invites() never
--   returns them, so this is dead data, not exposure. A periodic
--   `UPDATE coach_invites SET token = NULL WHERE expires_at <= now()` would
--   tidy it if you ever add a scheduled job; there is no cron here today.
--
-- Idempotent: safe to run multiple times. Run in the Supabase SQL editor.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. COLUMN
-- ---------------------------------------------------------------------------
-- Nullable on purpose: invites minted before this migration keep token = NULL.
-- They still redeem correctly (that goes through token_hash) but can no longer
-- be re-copied, and the UI degrades to "revoke and generate a new one".

ALTER TABLE public.coach_invites
  ADD COLUMN IF NOT EXISTS token text;

COMMENT ON COLUMN public.coach_invites.token IS
  'Plaintext invite token, retained so any admin of the program can re-copy a '
  'live link. NULL for invites created before this column existed, and NULLed '
  'on revoke. token_hash — not this column — is the redemption lookup key.';

-- ---------------------------------------------------------------------------
-- 2. CREATE — now refuses while the program already has a live link
-- ---------------------------------------------------------------------------
-- Return type is unchanged, so CREATE OR REPLACE is fine here.
--
-- Note the "one live link" check sits AFTER the program-row lock. Without the
-- lock two admins clicking Generate at the same moment both read zero live
-- invites and both insert — same class of race as the seat cap in
-- redeem_coach_invite, and locking `programs` is what serializes it there too.

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

  -- Serialize concurrent Generate clicks for this program (see header note).
  PERFORM 1 FROM public.programs p WHERE p.id = v_program_id FOR UPDATE;

  -- One live link per PROGRAM, not per core team: a second link is a second
  -- credential to keep track of, and the admin can always revoke to retarget.
  PERFORM 1
  FROM public.coach_invites ci
  WHERE ci.program_id = v_program_id
    AND ci.revoked_at IS NULL
    AND ci.expires_at > now();

  IF FOUND THEN
    RAISE EXCEPTION 'this program already has an active invite link — copy it, or revoke it to create a new one';
  END IF;

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');   -- 256-bit, 64 hex chars
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
$$;

REVOKE ALL ON FUNCTION public.create_coach_invite(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coach_invite(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. LIST — now returns the token so the link is always copyable
-- ---------------------------------------------------------------------------
-- DROP first: Postgres refuses to CREATE OR REPLACE a function whose return
-- type changes ("cannot change return type of existing function"), and adding a
-- column to RETURNS TABLE is a return-type change. Dropping also drops the
-- grants, so they are re-issued below.

DROP FUNCTION IF EXISTS public.list_coach_invites();

CREATE FUNCTION public.list_coach_invites()
RETURNS TABLE(
  invite_id        uuid,
  core_team_id     uuid,
  core_team_name   text,
  label            text,
  token            text,
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
  SELECT ci.id, ci.core_team_id, t.name, ci.label, ci.token, ci.created_at,
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

-- ---------------------------------------------------------------------------
-- 4. REVOKE — also destroys the plaintext
-- ---------------------------------------------------------------------------
-- Revoking is the admin's kill switch and the only way to free the slot for a
-- new link, so it is also the natural place to drop the stored credential.
-- token_hash stays: redemption still has to be able to find the row and tell
-- the coach it was revoked, rather than "invalid invite link".

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
     SET revoked_at = now(),
         token      = NULL
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
-- Column exists:
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'coach_invites' AND column_name = 'token';
--
-- Grants survived the DROP (list should read {authenticated}):
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
-- Manual checks, as a program admin:
--   * First link:      SELECT * FROM create_coach_invite('<core uuid>');  -> token
--   * Second link:     SELECT * FROM create_coach_invite('<core uuid>');  -> raises
--                      'already has an active invite link'
--   * Different core:  SELECT * FROM create_coach_invite('<other core>'); -> ALSO raises
--                      (the cap is per program, not per core team)
--   * SELECT invite_id, core_team_name, token IS NOT NULL AS copyable
--     FROM list_coach_invites();                                          -> 1 row, copyable
--   * Revoke it, then confirm the plaintext is gone and the slot is free:
--       SELECT revoke_coach_invite('<invite uuid>');                      -> true
--       SELECT token FROM coach_invites WHERE id = '<invite uuid>';       -> NULL
--       SELECT * FROM create_coach_invite('<core uuid>');                 -> token
--   * Redemption is untouched — it resolves by hash, never by `token`:
--       SELECT * FROM redeem_coach_invite('<token>');  (as a non-admin)   -> joins
--
-- Pre-existing invites, if any, have token = NULL and list_coach_invites()
-- reports them as not copyable. They still redeem:
--   SELECT id, core_team_id, token IS NULL AS legacy FROM coach_invites
--   WHERE revoked_at IS NULL AND expires_at > now();
-- =============================================================================
