-- =====================================================================
-- Fix: "session not found for summary" on anonymous /m/home saves
-- =====================================================================
-- Root cause: sync_summary_keys_from_session() raised the exception
-- whenever the parent session's program_id was NULL. Anonymous /m/home
-- sessions are saved with program_id = NULL by design (attributed via
-- device_uid + location instead), so the trigger treated every valid
-- anonymous session as "not found".
--
-- Fixes:
--   1. Detect a genuinely missing row with NOT FOUND, not a NULL column.
--   2. SECURITY DEFINER + pinned search_path so the parent-session lookup
--      bypasses RLS and reliably sees the just-inserted session regardless
--      of program scoping.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_summary_keys_from_session()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
declare s record;
begin
  select program_id, core_team_id, athlete_id into s
  from public.sessions
  where id = new.session_id;

  -- Genuinely missing parent row — NOT a null program_id (anonymous sessions
  -- have a null program_id but still exist).
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
  SET search_path = public
AS $function$
begin
  new.mode := (select mode from public.sessions where id = new.session_id);
  return new;
end $function$;
