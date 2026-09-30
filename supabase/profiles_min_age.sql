-- supabase/profiles_min_age.sql
-- Account holders (profiles = coaches/admins) must be 18+.
--
-- The signup + onboarding UIs already refuse an under-18 date_of_birth
-- (src/lib/age.ts), but with no API layer the client can write profiles
-- directly, so the rule has to live here too. A CHECK constraint can't be used
-- because the cutoff depends on current_date (not immutable), hence a trigger.
--
-- NULL is still allowed: the profile row can exist before onboarding collects
-- DOB, and RequireOnboarding keeps a NULL/underage DOB out of the app.
--
-- Only fires when date_of_birth is set or changed, so existing rows are left
-- alone until someone edits them. Idempotent — safe to re-run.

create or replace function public.profiles_enforce_min_age()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_birth is not null
     and new.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'You must be at least 18 years old to create a Trench Sports account.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_min_age on public.profiles;
create trigger profiles_enforce_min_age
  before insert or update of date_of_birth on public.profiles
  for each row execute function public.profiles_enforce_min_age();

-- Audit: existing account holders who would fail the rule (run manually).
-- select user_id, email, date_of_birth
--   from public.profiles
--  where date_of_birth > (current_date - interval '18 years')::date;
