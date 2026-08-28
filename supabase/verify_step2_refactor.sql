-- =====================================================================
-- verify_step2_refactor.sql — the byte-identical proof for runbook step 2
-- =====================================================================
-- Step 2 refactors §6a of entitlements.sql into scoped_session_summaries()
-- (the shared core) plus tiered_session_summaries() (a thin identity-resolving
-- caller). It is a PURE REFACTOR: the output must not change. This file proves
-- that, and the proof is the entire safety argument.
--
-- EVERYTHING BELOW IS RUNNABLE SQL. Only prose is commented. Run the numbered
-- blocks one at a time — the Supabase SQL editor shows only the last result set
-- when several statements are submitted together.
--
--   BLOCK 1  install the harness            ← before the refactor
--   BLOCK 2  select * from step2_verify.candidates   (eyeball it)
--   BLOCK 3  select * from step2_verify.capture('before')
--   ---- now apply the refactored entitlements.sql §6a ----
--   BLOCK 4  select * from step2_verify.capture('after')
--   BLOCK 5  the three diffs — all must be empty
--   BLOCK 6  the new invariants
--   BLOCK 7  cleanup
--
-- BLOCK 3 MUST RUN BEFORE THE REFACTOR IS APPLIED. Once applied, the "before"
-- snapshot cannot be recreated without reverting.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 — install the harness
-- =====================================================================
-- Lives in its own schema, NOT in public. Supabase exposes public through
-- PostgREST; a snapshot table of real session data sitting there with no RLS
-- would be readable over the API for as long as it existed. step2_verify is
-- not in the exposed-schema list, so it is invisible to PostgREST.

create schema if not exists step2_verify;

-- Test population: one coach per tier for the masking branches, plus a Tier III
-- ADMIN. The admin branch is what api_session_summaries passes in step 3, so
-- omitting it would leave the API's own scoping path as the only unproven one.
-- Programs with zero summaries are excluded — a diff over no rows proves
-- nothing — and where several programs qualify for a label, the one with the
-- most summaries wins.
create or replace view step2_verify.candidates as
with c as (
  select p.user_id,
         p.role::text                                    as role,
         public.program_tier(pr.id)                      as tier,
         pr.id                                           as program_id,
         pr.name                                         as program_name,
         (select count(*) from public.session_summaries ss
           where ss.program_id = pr.id)                  as summaries
    from public.profiles p
    join public.programs pr on pr.id = p.program_id
   where p.program_id is not null
),
labeled as (
  select c.*,
         case
           when tier = 'I'   and role = 'coach' then 't1'
           when tier = 'II'  and role = 'coach' then 't2'
           when tier = 'III' and role = 'coach' then 't3'
           when tier = 'III' and role = 'admin' then 't3admin'
         end as label
    from c
   where summaries > 0
)
select distinct on (label)
       label, user_id, role, tier, program_id, program_name, summaries
  from labeled
 where label is not null
 order by label, summaries desc;

-- Snapshot table, shaped from the function itself so there is no 22-column
-- list to keep in sync. `where false` creates the shape and no rows.
-- IF NOT EXISTS, not DROP: re-pasting BLOCK 1 after BLOCK 3 has run must not
-- destroy the 'before' snapshot, which cannot be recreated once the refactor is
-- applied. capture() clears only its own phase.
create table if not exists step2_verify.snap as
  select 'x'::text as phase,
         'x'::text as label,
         (row_number() over ())::bigint as rn,
         t.*
    from public.tiered_session_summaries() t
   where false;

-- The capture routine. Impersonation works by setting request.jwt.claims:
-- Supabase's auth.uid() reads the 'sub' claim out of that GUC, and
-- get_my_program_id() / get_my_role() / get_my_core_team_id() all resolve from
-- auth.uid(). is_local => true scopes it to the current transaction, which is
-- why the set and the read have to happen inside this one function call.
create or replace function step2_verify.capture(p_phase text)
-- Output names are out_* so nothing can be ambiguous against the candidates
-- view's own label/tier/role columns inside the function body.
returns table (out_label text, out_tier text, out_role text, out_rows bigint)
language plpgsql
as $$
declare
  r record;
  n bigint;
begin
  if p_phase not in ('before','after') then
    raise exception 'p_phase must be before or after, got %', p_phase;
  end if;

  delete from step2_verify.snap s where s.phase = p_phase;

  for r in select * from step2_verify.candidates loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', r.user_id, 'role', 'authenticated')::text,
      true);

    insert into step2_verify.snap
    select p_phase, r.label, row_number() over (), t.*
      from public.tiered_session_summaries() t;

    get diagnostics n = row_count;

    out_label := r.label;
    out_tier  := r.tier;
    out_role  := r.role;
    out_rows  := n;
    return next;
  end loop;
end;
$$;


-- =====================================================================
-- BLOCK 2 — look at the test population before trusting the proof
-- =====================================================================
-- Read this output. If a label is MISSING you have no coverage of that branch,
-- and the proof is correspondingly weaker — say so rather than assuming.
-- t3admin missing is the one that matters most for step 3.

select * from step2_verify.candidates;


-- =====================================================================
-- BLOCK 3 — snapshot BEFORE the refactor.  RUN THIS FIRST.
-- =====================================================================
-- rows_captured of 0 for a label means that user sees nothing and proves
-- nothing — check their tier is not 'none' and their program has summaries in
-- modes their tier unlocks.

select * from step2_verify.capture('before');


-- =====================================================================
-- BLOCK 4 — snapshot AFTER the refactor
-- =====================================================================
-- Apply the refactored §6a of entitlements.sql, then run this.

-- select * from step2_verify.capture('after');


-- =====================================================================
-- BLOCK 5 — the diffs. All three must come back empty (or zero-delta).
-- =====================================================================

-- 5a. Row multiplicity. EXCEPT in 5b is set-based and collapses duplicates, so
--     a doubled row would slip past it. delta must be 0 on every label.
--
-- select label,
--        count(*) filter (where phase = 'before') as before_n,
--        count(*) filter (where phase = 'after')  as after_n,
--        count(*) filter (where phase = 'before')
--      - count(*) filter (where phase = 'after')  as delta
--   from step2_verify.snap
--  group by label
--  order by label;

-- 5b. Value diff, both directions, all 22 columns including the masked jsonb
--     ones. to_jsonb() of the row minus the two bookkeeping keys means there is
--     no column list to maintain and nothing can be forgotten. jsonb equality
--     compares the nested masked objects correctly. MUST BE EMPTY.
--
-- with b as (select label, to_jsonb(t) - 'phase' - 'rn' as row_json
--              from step2_verify.snap t where phase = 'before'),
--      a as (select label, to_jsonb(t) - 'phase' - 'rn' as row_json
--              from step2_verify.snap t where phase = 'after')
-- select 'in_before_not_after' as side, x.* from (select * from b except select * from a) x
-- union all
-- select 'in_after_not_before'  as side, y.* from (select * from a except select * from b) y;

-- 5c. Emission order. This is the check that matters most for THIS refactor:
--     the core now sorts by (ingested_at desc, session_id desc) and the browser
--     caller re-sorts by date_of_record desc to reproduce the old order. This
--     proves the compensation works.
--
--     Rows at the same rn with the same date_of_record but different session_ids
--     are a tie reshuffle. Ties were already arbitrary before the refactor, so
--     those are acceptable and the last predicate excludes them. Anything this
--     returns is a REAL ordering regression. MUST BE EMPTY.
--
-- select b.label, b.rn,
--        b.session_id     as before_sid, a.session_id     as after_sid,
--        b.date_of_record as before_dor, a.date_of_record as after_dor
--   from step2_verify.snap b
--   join step2_verify.snap a
--     on a.phase = 'after' and a.label = b.label and a.rn = b.rn
--  where b.phase = 'before'
--    and b.session_id <> a.session_id
--    and b.date_of_record is distinct from a.date_of_record;

-- 5d. Tie-shuffle magnitude. Informational, not a failure. If this is large the
--     dashboard may order sessions differently within a single day even though
--     5c passes — worth one visual check of the app if so.
--
-- select b.label, count(*) as tie_reshuffles
--   from step2_verify.snap b
--   join step2_verify.snap a
--     on a.phase = 'after' and a.label = b.label and a.rn = b.rn
--  where b.phase = 'before'
--    and b.session_id <> a.session_id
--    and b.date_of_record = a.date_of_record
--  group by b.label;


-- =====================================================================
-- BLOCK 6 — the invariants the refactor introduces
-- =====================================================================

-- 6a. The core is NOT reachable by a client. This is the entire reason the
--     revoke exists: without it a browser console could pass an arbitrary
--     p_program_id and read any program's sessions. Must FAIL with
--     "permission denied for function scoped_session_summaries".
--
-- begin;
--   set local role authenticated;
--   select * from public.scoped_session_summaries(
--     (select id from public.programs limit 1), 'admin', null, 'III');
-- rollback;

-- 6b. Structural checks against pg_proc, so they test what is actually
--     installed rather than what the file says. Both counts must be 0.
--
-- select
--   (select count(*) from pg_proc
--     where proname = 'scoped_session_summaries'
--       and (prosrc like '%auth.uid()%'      or prosrc like '%get_my_program_id%'
--         or prosrc like '%get_my_role%'     or prosrc like '%get_my_core_team_id%'
--         or prosrc like '%my_tier()%')) as core_identity_leaks,
--   (select count(*) from pg_proc
--     where proname = 'tiered_session_summaries'
--       and (prosrc like '%session_summaries s%' or prosrc like '%mask_quality%'
--         or prosrc like '%mask_stats%'))        as caller_predicate_copies;

-- 6c. export_session_summaries (6c in entitlements.sql) still works. It does
--     `select * from tiered_session_summaries(...)` into a fixed 22-column
--     returns table, which is exactly why the browser caller's return type had
--     to stay at 22 columns. This is the regression test for that constraint.
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select user_id from step2_verify.candidates
--                               where label = 't3' limit 1),
--                       'role','authenticated')::text, true);
--   select count(*) from public.export_session_summaries();   -- must not error
-- rollback;

-- 6d. The browser caller is still UNLIMITED. least(NULL, 200) returns 200 in
--     Postgres, so a naive `limit least(coalesce(p_limit,100),200)` would
--     silently cap the app at 200 rows. via_rpc must equal via_table.
--     Meaningful only if the program has more than 200 summaries — check the
--     `summaries` column in BLOCK 2 first.
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select user_id from step2_verify.candidates
--                               where label = 't3admin' limit 1),
--                       'role','authenticated')::text, true);
--   select (select count(*) from public.tiered_session_summaries()) as via_rpc,
--          (select count(*) from public.session_summaries ss
--            where ss.program_id = public.get_my_program_id()
--              and ss.mode::text = any(public.tier_modes('III'))) as via_table;
-- rollback;

-- 6e. The new API params. Not a refactor check — a readiness check for step 3.
--     Cursor pagination must return each row exactly once, so overlap = 0.
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select user_id from step2_verify.candidates
--                               where label = 't3admin' limit 1),
--                       'role','authenticated')::text, true);
--
--   create temp table pg1 as
--     select session_id, ingested_at from public.scoped_session_summaries(
--       public.get_my_program_id(), 'admin', null, 'III',
--       null, null, null, null, null, null, null, null, 5);
--
--   create temp table pg2 as
--     select session_id, ingested_at from public.scoped_session_summaries(
--       public.get_my_program_id(), 'admin', null, 'III',
--       null, null, null, null, null, null,
--       (select min(ingested_at) from pg1),
--       (select session_id from pg1 order by ingested_at, session_id limit 1),
--       5);
--
--   select (select count(*) from pg1) as page1,
--          (select count(*) from pg2) as page2,
--          (select count(*) from (select session_id from pg1
--                                 intersect
--                                 select session_id from pg2) x) as overlap;
-- rollback;


-- =====================================================================
-- BLOCK 7 — cleanup, once the proof has passed
-- =====================================================================
-- Drops the snapshot data. step2_verify is outside the PostgREST-exposed
-- schemas so this is not urgent, but the snapshot holds real session rows with
-- no RLS on them — do not leave it indefinitely.
--
-- drop schema if exists step2_verify cascade;
