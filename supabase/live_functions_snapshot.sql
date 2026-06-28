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
