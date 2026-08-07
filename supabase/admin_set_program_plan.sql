-- =====================================================================
-- TRENCH SPORTS — ADMIN: SET PROGRAM SUBSCRIPTION TIER
-- =====================================================================
-- Lets an internal admin change a program's subscription tier from the
-- /admin observability page. Companion to supabase/telemetry_admin.sql —
-- same SECURITY DEFINER + is_internal_admin() gate.
--
-- Two parts:
--   1. Migrate programs.plan from the legacy trial/free/pro/enterprise
--      vocabulary to the product's tier model: trial / I / II / III.
--   2. admin_set_program_plan(program_id, plan) — the write RPC. It changes
--      ONLY the plan column (limits max_* are left untouched, by decision).
--
-- Run once against the live Supabase project. Idempotent (safe to re-run).
-- =====================================================================


-- ── 1. Migrate the plan vocabulary → trial / I / II / III ────────────
-- The legacy CHECK forbids I/II/III, so it must be dropped BEFORE the
-- remap, then re-added tighter. Ordering matters: drop → remap → re-add.
do $$
begin
  -- Drop whatever CHECK currently guards plan (auto-named programs_plan_check
  -- from the inline definition; the IF EXISTS makes re-runs safe).
  alter table public.programs drop constraint if exists programs_plan_check;

  -- Remap legacy values. Trial stays trial. On a re-run these are no-ops
  -- because free/pro/enterprise no longer exist.
  update public.programs set plan = 'I'   where plan = 'free';
  update public.programs set plan = 'II'  where plan = 'pro';
  update public.programs set plan = 'III' where plan = 'enterprise';

  -- Anything unexpected (should be none) falls back to trial so the new
  -- constraint can't fail the migration.
  update public.programs
     set plan = 'trial'
   where plan not in ('trial', 'I', 'II', 'III');

  -- Re-add the tightened CHECK.
  alter table public.programs
    add constraint programs_plan_check
    check (plan = any (array['trial'::text, 'I'::text, 'II'::text, 'III'::text]));
end $$;

-- Keep the column default aligned with the new vocabulary.
alter table public.programs alter column plan set default 'trial'::text;


-- ── 2. Write RPC — admin_set_program_plan ────────────────────────────
-- Gated on internal_admins. Validates the target tier server-side (never
-- trusts the client), changes ONLY the plan column, and returns the
-- before/after so the UI can confirm what actually happened.
create or replace function public.admin_set_program_plan(
  p_program_id uuid,
  p_new_plan   text
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_old  text;
  v_name text;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_new_plan is null or p_new_plan not in ('trial', 'I', 'II', 'III') then
    raise exception 'invalid plan: %', p_new_plan using errcode = '22023';
  end if;

  select plan, name into v_old, v_name
  from public.programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'program not found: %', p_program_id using errcode = 'P0002';
  end if;

  update public.programs
     set plan = p_new_plan
   where id = p_program_id;

  return jsonb_build_object(
    'id',        p_program_id,
    'name',      v_name,
    'old_plan',  v_old,
    'new_plan',  p_new_plan,
    'changed',   v_old is distinct from p_new_plan
  );
end;
$$;

grant execute on function public.admin_set_program_plan(uuid, text) to authenticated;
