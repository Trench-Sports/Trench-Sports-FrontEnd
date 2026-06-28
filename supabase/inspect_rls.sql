-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY: reveal current RLS state. Safe to run anytime. Changes nothing.
-- Run in Supabase SQL editor; copy both result sets back for review.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Which tables have RLS ON / OFF (and FORCEd)?
--    relrowsecurity = RLS enabled.  relforcerowsecurity = enforced even for owner.
SELECT n.nspname                AS schema,
       c.relname                AS table,
       c.relrowsecurity         AS rls_enabled,
       c.relforcerowsecurity    AS rls_forced
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relkind = 'r'
ORDER  BY c.relname;

-- 2) Every policy, with the role(s), command, and the USING / WITH CHECK bodies.
SELECT schemaname            AS schema,
       tablename             AS table,
       policyname            AS policy,
       cmd                   AS command,      -- SELECT / INSERT / UPDATE / DELETE / ALL
       roles                 AS roles,        -- {anon}, {authenticated}, {public}, ...
       qual                  AS using_expr,   -- USING (...)  — read/visibility filter
       with_check            AS check_expr    -- WITH CHECK (...) — write filter
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY tablename, cmd, policyname;

-- 3) The helper functions the policies depend on (confirm they exist + definer mode).
SELECT p.proname                                   AS function,
       pg_get_function_identity_arguments(p.oid)   AS args,
       p.prosecdef                                 AS security_definer,
       pg_get_functiondef(p.oid)                   AS definition
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN ('get_my_program_id','get_my_role','get_my_core_team_id',
                     'is_anon_session','is_anon_event',
                     'sync_summary_keys_from_session','sync_summary_mode_from_session')
ORDER  BY p.proname;
