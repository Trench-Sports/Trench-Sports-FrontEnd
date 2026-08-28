-- =====================================================================
-- api_prereqs.sql — schema prerequisites for the Partner API + AMS push
-- =====================================================================
-- Runbook step 1 + 1b · plan phase 0 (§6.1, §6.2, §6.3, §6.6).
--
-- Nothing here is API-specific. Every item closes a gap the API would
-- expose, so this file is independently valuable and ships alone. It
-- depends on no open decision.
--
-- Idempotent: safe to re-run. Every DDL is `if not exists` or
-- `create or replace`, and every backfill is guarded on `is null`.
--
-- Locks: the `set not null` statements scan session_summaries under
-- ACCESS EXCLUSIVE, and the CREATE INDEXes take SHARE (blocking writes).
-- Both are fine at current row counts. If session_summaries ever reaches
-- millions of rows, split the indexes out into `create index
-- concurrently` OUTSIDE a transaction — concurrently cannot run inside
-- one, which is why they are inline here.
--
-- Source of truth for the live schema is the Supabase project. Update
-- supabase/schema.sql after applying this.
-- =====================================================================

begin;

-- =====================================================================
-- 1a. ingested_at — the monotonic sync column
-- =====================================================================
-- WHY THIS EXISTS: there is no column an API partner can safely sync on.
-- date_of_record is when the session was HIT, and src/storage/sessionOutbox.ts
-- is an IndexedDB retry outbox — a coach records offline Friday and the rows
-- land Monday. A partner polling ?since=<last date_of_record seen> would
-- SILENTLY NEVER SEE that session. Silent data loss is the worst bug class
-- available to a sync API, so this column is the reason phase 0 exists.

alter table public.session_summaries add column if not exists ingested_at timestamptz;
alter table public.session_summaries add column if not exists updated_at   timestamptz;

-- Backfill from sessions.created_at, NOT date_of_record.
--
-- The plan (§6.1) originally backfilled from date_of_record, calling it the
-- best available signal. It isn't: sessions.created_at is
-- `timestamptz not null default now()` (schema.sql:135) and is literally the
-- row-arrival timestamp, which is what ingested_at means. Two reasons the
-- coalesce chain below matters:
--   1. session_summaries.date_of_record is NULLABLE (schema.sql:212), so a
--      date_of_record-only backfill leaves NULLs and the `set not null`
--      further down throws.
--   2. Adding the column as `not null default now()` in one statement would
--      stamp every historical row with the migration time, and a follow-up
--      `where ingested_at is null` backfill would then match zero rows —
--      defeating the entire purpose of the column for all existing data.
update public.session_summaries ss
   set ingested_at = coalesce(s.created_at, ss.date_of_record, now())
  from public.sessions s
 where s.id = ss.session_id
   and ss.ingested_at is null;

-- Sweep any summary with no parent session row (preflight check 0.3). If 0.3
-- returned 0 this is a no-op safety net; if it returned non-zero this
-- statement is load-bearing and the `set not null` below depends on it.
update public.session_summaries
   set ingested_at = coalesce(date_of_record, now())
 where ingested_at is null;

alter table public.session_summaries
  alter column ingested_at set default now(),
  alter column ingested_at set not null;

-- updated_at: tools/processSession.ts can rewrite summaries, so reprocessing
-- needs to be visible to an incremental sync. Seed it to ingested_at so the
-- two agree until something is actually reprocessed.
update public.session_summaries set updated_at = ingested_at where updated_at is null;

alter table public.session_summaries
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.touch_session_summary()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Coexists with the live sync_summary_keys_from_session /
-- sync_summary_mode_from_session triggers: those set program_id, core_team_id,
-- athlete_id and mode, this sets updated_at. No column overlap, so relative
-- firing order is irrelevant. (Same-timing triggers fire alphabetically by
-- trigger name — see the VERIFY block for how to list what is live.)
drop trigger if exists trg_session_summaries_touch on public.session_summaries;
create trigger trg_session_summaries_touch
  before update on public.session_summaries
  for each row execute function public.touch_session_summary();


-- =====================================================================
-- 1b. Indexes (plan §6.2)
-- =====================================================================

-- The API cursor index. PARTIAL on `program_id is not null` for two reasons:
-- the pre-signup /m/home funnel writes real sessions with a NULL program
-- under the anon key (reenable_rls_anon_uploads.sql:1-26), and those rows must
-- never be reachable by an API cursor. Excluding them also keeps the index
-- smaller than the table's row count.
create index if not exists idx_session_summaries_ingested
  on public.session_summaries (program_id, ingested_at desc)
  where program_id is not null;

-- /v1/athletes and /v1/teams. Neither index exists today; entitlements.sql
-- :411-422 creates four others, none of which cover these access paths.
create index if not exists idx_athletes_program_core
  on public.athletes (program_id, core_team_id);

create index if not exists idx_team_members_team
  on public.team_members (team_id);


-- =====================================================================
-- 1c. AMS user mapping (plan §6.3)
-- =====================================================================
-- Unique per program, NOT globally: two programs on different AMS instances
-- can legitimately hold the same integer userId. Partial so the many
-- unmapped athletes do not collide on NULL.
alter table public.athletes add column if not exists ams_user_id integer;

create unique index if not exists athletes_ams_user_idx
  on public.athletes (program_id, ams_user_id)
  where ams_user_id is not null;


-- =====================================================================
-- 1d. Athlete email required at Tier III (plan §6.6)
-- =====================================================================
-- WHY: preflight 0.4 returned 7 of 40 athletes with an email (17.5%), against
-- the ~60% the AMS match path needs. §7.3 makes email the only trustworthy
-- match key, so at that coverage the connector maps seven athletes and hands
-- 33 to a human for name-only confirmation.
--
-- Enforced HERE and not only in React because there is no API layer — the
-- browser writes public.athletes directly, so client validation is advisory.
-- Same pattern as tg_limit_athletes (entitlements_enforcement.sql:249).
--
-- SCOPED ON `plan = 'III'`, NOT program_tier(). program_tier
-- (entitlements.sql:160-178) deliberately returns 'III' for any trial still
-- inside its window — "show the ceiling", per the comment at line 155.
-- Enforcing on program_tier would block roster import for every brand-new
-- signup during onboarding, which is where importRoster is used most and
-- where friction costs conversions. Assigned Tier III is the paying
-- integrator; trials get a UI warning instead.

create or replace function public.tg_require_athlete_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan     text;
  v_new_has  boolean;
  v_old_has  boolean;
begin
  -- Assigned in the body rather than as a DECLARE default: referencing NEW in
  -- a declaration's default expression is not a documented guarantee.
  v_new_has := nullif(trim(coalesce(new.email, '')), '') is not null;

  -- Nothing to enforce: no program to look up, or an email is present.
  if new.program_id is null or v_new_has then
    return new;
  end if;

  -- On UPDATE, only object to actively CLEARING an email. A legacy athlete
  -- that never had one stays editable, so a coach fixing an unrelated field
  -- on a pre-upgrade row never sees a baffling error. This is a deliberate
  -- narrowing of "insert-only" as written in the runbook — it closes the
  -- clear-the-email hole without reintroducing the noise that motivated
  -- insert-only in the first place.
  if tg_op = 'UPDATE' then
    v_old_has := nullif(trim(coalesce(old.email, '')), '') is not null;
    if not v_old_has then
      return new;
    end if;
  end if;

  select plan into v_plan from public.programs where id = new.program_id;

  if v_plan = 'III' then
    raise exception
      'Athlete email is required for Tier III programs (needed for Teamworks AMS athlete matching)'
      using errcode = '23514',
            hint = 'Add an email for this athlete, or set programs.plan below III.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_require_athlete_email on public.athletes;
create trigger trg_require_athlete_email
  before insert or update of email on public.athletes
  for each row execute function public.tg_require_athlete_email();

commit;


-- =====================================================================
-- 2. Column grants
-- =====================================================================
-- entitlements.sql:784 revoked whole-table SELECT on session_summaries and
-- granted back a named column list. ingested_at and updated_at are not on it,
-- so they are currently unreadable by anon/authenticated.
--
-- This grant matters ONLY for direct browser reads
-- (`supabase.from("session_summaries").select(...)`). It is NOT needed by the
-- API path: the Vercel function runs as service_role, and the tiered_*/api_*
-- functions are SECURITY DEFINER, which bypasses column grants entirely.
-- Granted anyway so a client-side sort or "last updated" label does not fail
-- with a confusing permission error later.
grant select (ingested_at, updated_at) on public.session_summaries to anon, authenticated;


-- =====================================================================
-- VERIFY — run each block separately; the SQL editor shows only the last
-- result set when several statements are submitted together.
-- =====================================================================
--
-- V1. ingested_at is fully populated AND did not all get stamped with the
--     migration time. `differs_from_dor` must be > 0 on any project with
--     offline-outbox history — if it is 0 and total is large, the backfill
--     fell through to date_of_record and the column is not doing its job.
--
-- select count(*)                                                   as total,
--        count(*) filter (where ingested_at is null)                as nulls,          -- must be 0
--        count(*) filter (where ingested_at <> date_of_record)      as differs_from_dor,
--        min(ingested_at), max(ingested_at)
--   from public.session_summaries;
--
-- V2. The NULL-program rows exist but are excluded from the cursor index.
--     `null_program` here should equal preflight check 0.2.
--
-- select count(*) filter (where program_id is null) as null_program,
--        count(*)                                   as total
--   from public.session_summaries;
--
-- V3. Indexes and the AMS unique index are live.
--
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public'
--    and indexname in ('idx_session_summaries_ingested','idx_athletes_program_core',
--                      'idx_team_members_team','athletes_ams_user_idx')
--  order by indexname;
--
-- V4. What triggers are actually live on session_summaries, and in what
--     order they fire (alphabetical within the same timing).
--
-- select tgname, tgtype, pg_get_triggerdef(oid)
--   from pg_trigger
--  where tgrelid = 'public.session_summaries'::regclass and not tgisinternal
--  order by tgname;
--
-- V5. updated_at actually moves on write, and ingested_at does NOT.
--
-- begin;
--   update public.session_summaries set num_events = num_events
--    where session_id = (select session_id from public.session_summaries limit 1);
--   select session_id, ingested_at, updated_at, updated_at > ingested_at as touched
--     from public.session_summaries
--    where session_id = (select session_id from public.session_summaries limit 1);
-- rollback;
--
-- V6. The email rule. Run against a plan='III' program, then a plan='trial'
--     one. Expect 23514 on the first and success on the second.
--
-- select p.plan,
--        count(*)                                  as athletes,
--        count(*) filter (where a.email is null)   as missing_email
--   from public.athletes a
--   join public.programs p on p.id = a.program_id
--  group by p.plan
--  order by p.plan;
--
-- V7. Legacy rows on an upgraded program stay editable (the grandfathering
--     consequence — surface these on the phase-5 AMS setup screen as
--     "N athletes missing email", they are NOT blocked here).
--
-- (Postgres has no UPDATE ... LIMIT, hence the ctid subquery.)
-- begin;
--   update public.athletes set position = position
--    where ctid = (select a.ctid from public.athletes a
--                    join public.programs p on p.id = a.program_id
--                   where a.email is null and p.plan = 'III' limit 1);   -- must succeed
--   -- And clearing an email on a Tier III athlete that HAS one must fail 23514:
--   update public.athletes set email = null
--    where ctid = (select a.ctid from public.athletes a
--                    join public.programs p on p.id = a.program_id
--                   where a.email is not null and p.plan = 'III' limit 1);
-- rollback;
--
-- =====================================================================
-- ROLLBACK (development only — dropping ingested_at discards the backfill,
-- and re-running the migration afterwards would re-derive it from
-- sessions.created_at, which is fine, but any reprocessing history in
-- updated_at is lost permanently).
-- =====================================================================
--
-- drop trigger if exists trg_require_athlete_email   on public.athletes;
-- drop trigger if exists trg_session_summaries_touch on public.session_summaries;
-- drop function if exists public.tg_require_athlete_email();
-- drop function if exists public.touch_session_summary();
-- drop index if exists public.athletes_ams_user_idx;
-- drop index if exists public.idx_team_members_team;
-- drop index if exists public.idx_athletes_program_core;
-- drop index if exists public.idx_session_summaries_ingested;
-- alter table public.athletes          drop column if exists ams_user_id;
-- alter table public.session_summaries drop column if exists updated_at;
-- alter table public.session_summaries drop column if exists ingested_at;
