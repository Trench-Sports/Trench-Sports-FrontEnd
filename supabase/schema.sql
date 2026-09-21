-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Source of truth: live Supabase project. Keep in sync after migrations.
CREATE TABLE public.programs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text NOT NULL,
  location text,
  onboarding_code character NOT NULL UNIQUE CHECK (onboarding_code ~ '^[0-9]{6}$'::text),
  max_coaches integer,
  max_athletes integer,
  plan text NOT NULL DEFAULT 'trial'::text CHECK (plan = ANY (ARRAY['trial'::text, 'I'::text, 'II'::text, 'III'::text])),
  status text NOT NULL DEFAULT 'trial'::text CHECK (status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text])),
  trial_ends_at timestamp with time zone,
  billing_period_end timestamp with time zone,
  grace_period_end timestamp with time zone,
  max_devices integer,
  max_sessions_per_month integer,
  status_changed_at timestamp with time zone,
  is_grandfathered boolean NOT NULL DEFAULT false,
  plan_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT programs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profiles (
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  role USER-DEFINED NOT NULL DEFAULT 'coach'::user_role,
  program_id uuid,
  first_name text,
  last_name text,
  email text,
  profile_pic text,
  position text,
  city text,
  state text,
  date_of_birth date,
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT profiles_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);
CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  program_id uuid NOT NULL,
  created_by uuid,
  name text NOT NULL,
  team_type USER-DEFINED NOT NULL,
  parent_team_id uuid,
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT teams_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id),
  CONSTRAINT teams_parent_team_id_fkey FOREIGN KEY (parent_team_id) REFERENCES public.teams(id)
);
CREATE TABLE public.athletes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  program_id uuid NOT NULL,
  core_team_id uuid NOT NULL,
  coach_user_id uuid,
  created_by uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  city text,
  state text,
  height text,
  weight text,
  date_of_birth date,
  sport text,
  position text,
  CONSTRAINT athletes_pkey PRIMARY KEY (id),
  CONSTRAINT athletes_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT athletes_core_team_id_fkey FOREIGN KEY (core_team_id) REFERENCES public.teams(id),
  CONSTRAINT athletes_coach_user_id_fkey FOREIGN KEY (coach_user_id) REFERENCES public.profiles(user_id),
  CONSTRAINT athletes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  program_id uuid NOT NULL,
  team_id uuid NOT NULL,
  added_by uuid,
  coach_user_id uuid,
  athlete_id uuid,
  member_role text,
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(user_id),
  CONSTRAINT team_members_coach_user_id_fkey FOREIGN KEY (coach_user_id) REFERENCES public.profiles(user_id),
  CONSTRAINT team_members_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES public.athletes(id)
);
-- Temporary program+core-scoped onboarding links for coaches.
-- Source: supabase/coach_invite_links.sql. token_hash is SHA-256 hex of the
-- plaintext token; the plaintext is returned once by create_coach_invite() and
-- never stored. Multi-use until expires_at (created_at + 72h) or revoked_at.
CREATE TABLE public.coach_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  program_id uuid NOT NULL,
  core_team_id uuid NOT NULL,
  created_by uuid,
  token_hash text NOT NULL UNIQUE,
  -- Plaintext, retained so any admin can re-copy a live link (source:
  -- coach_invite_single_active_link.sql). NULLed on revoke. token_hash, not
  -- this, is the redemption lookup key.
  token text,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  redemption_count integer NOT NULL DEFAULT 0,
  last_redeemed_at timestamp with time zone,
  label text,
  CONSTRAINT coach_invites_pkey PRIMARY KEY (id),
  CONSTRAINT coach_invites_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT coach_invites_core_team_id_fkey FOREIGN KEY (core_team_id) REFERENCES public.teams(id),
  -- profiles, NOT auth.users: redemption copies created_by into
  -- team_members.added_by, which FKs profiles(user_id). See coach_invite_links.sql.
  CONSTRAINT coach_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.coach_invite_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  invite_id uuid NOT NULL,
  program_id uuid NOT NULL,
  core_team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT coach_invite_redemptions_pkey PRIMARY KEY (id),
  CONSTRAINT coach_invite_redemptions_unique UNIQUE (invite_id, user_id),
  CONSTRAINT coach_invite_redemptions_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.coach_invites(id),
  CONSTRAINT coach_invite_redemptions_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT coach_invite_redemptions_core_team_id_fkey FOREIGN KEY (core_team_id) REFERENCES public.teams(id),
  CONSTRAINT coach_invite_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.sessions (
  id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  program_id uuid,
  core_team_id uuid,
  athlete_id uuid,
  created_by uuid,
  version text,
  started_at_ms bigint,
  ended_at_ms bigint,
  grid_rows integer,
  grid_cols integer,
  device_model text,
  sampling_hz integer,
  calibration jsonb,
  raw jsonb NOT NULL,
  mode USER-DEFINED NOT NULL DEFAULT 'power'::session_mode,
  location jsonb,
  device_uid text,
  device_id text,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT sessions_core_team_id_fkey FOREIGN KEY (core_team_id) REFERENCES public.teams(id),
  CONSTRAINT sessions_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES public.athletes(id),
  CONSTRAINT sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.events (
  event_id text NOT NULL,
  session_id text NOT NULL,
  t_start_ms bigint,
  t_end_ms bigint,
  duration_ms numeric,
  iei_prev_ms numeric,
  impulse_index numeric,
  rise_time_ms numeric,
  decay_time_ms numeric,
  angle_deg numeric,
  accuracy jsonb,
  strength_index jsonb,
  temporal jsonb,
  quality jsonb,
  raw jsonb NOT NULL,
  reaction_time_ms numeric,
  -- Accelerometer rollup (supabase/accel_events.sql). All nullable; NULL means
  -- NOT MEASURED and must never be read as zero g. accel_azimuth_deg is a
  -- SECOND estimate alongside angle_deg (matrix centroid) — neither overwrites
  -- the other, and their disagreement is a quality signal.
  accel_impact_id bigint,
  accel_peak_mg integer,
  accel_azimuth_deg numeric,
  accel_elevation_deg numeric,
  accel_impulse_g_ms numeric,
  CONSTRAINT events_pkey PRIMARY KEY (event_id),
  CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id),
  CONSTRAINT events_accel_impact_id_fkey FOREIGN KEY (accel_impact_id) REFERENCES public.impact_events(id)
);
CREATE TABLE public.event_cells (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  event_id text NOT NULL,
  r integer NOT NULL,
  c integer NOT NULL,
  samples integer,
  v_min numeric,
  t_first_ms bigint,
  t_last_ms bigint,
  t_peak_ms bigint,
  v_peak numeric,
  CONSTRAINT event_cells_pkey PRIMARY KEY (id),
  CONSTRAINT event_cells_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id)
);
CREATE TABLE public.session_summaries (
  session_id text NOT NULL,
  program_id uuid,
  core_team_id uuid,
  athlete_id uuid,
  num_events integer,
  session_duration_ms bigint,
  cadence_hz_avg numeric,
  cadence_hz_median numeric,
  iei_ms jsonb,
  longest_pause_ms bigint,
  peak_force_stats jsonb,
  impulse_stats jsonb,
  duration_ms_stats jsonb,
  angles_deg jsonb,
  most_contacted_cell_rc jsonb,
  center_of_mass_mm jsonb,
  heatmap jsonb,
  quality jsonb,
  date_of_record timestamp with time zone DEFAULT now(),
  mode USER-DEFINED,
  captured_tier text,
  captured_entitled boolean,
  -- Accelerometer rollup. impact_count / peak_g_mg / mean_impact_g_mg are
  -- defined over PRIMARY impacts (impact_events.rebound_of is null) and are
  -- written by rollup_impacts_to_session_summary(), NOT by the client — the
  -- app cannot coalesce rebounds, so it writes only the two facts it has from
  -- hello. accel_present NULL = not measured; false = adapter reported none.
  accel_present boolean,
  impact_count integer,
  peak_g_mg integer,
  mean_impact_g_mg integer,
  accel_g_range_g smallint,
  CONSTRAINT session_summaries_pkey PRIMARY KEY (session_id),
  CONSTRAINT session_summaries_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id),
  CONSTRAINT session_summaries_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT session_summaries_core_team_id_fkey FOREIGN KEY (core_team_id) REFERENCES public.teams(id),
  CONSTRAINT session_summaries_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES public.athletes(id)
);
CREATE TABLE public.devices (
  id text NOT NULL,
  program_id uuid,
  name text,
  fw_version text,
  fw_target text,
  features jsonb DEFAULT '{}'::jsonb,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  hw text,
  mode text,
  claimed_at timestamp with time zone,
  deactivated_at timestamp with time zone,
  CONSTRAINT devices_pkey PRIMARY KEY (id),
  CONSTRAINT devices_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);

CREATE TABLE public.internal_admins (
  user_id uuid NOT NULL,
  added_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT internal_admins_pkey PRIMARY KEY (user_id),
  CONSTRAINT internal_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.app_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  ts timestamp with time zone NOT NULL DEFAULT now(),
  client_ts timestamp with time zone,
  name text NOT NULL,
  client_id text NOT NULL,
  user_id uuid,
  program_id uuid,
  session_id text,
  device_id text,
  platform text CHECK (platform = ANY (ARRAY['web'::text, 'ios'::text])),
  app_version text,
  ok boolean,
  error_code text,
  duration_ms integer,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT app_events_pkey PRIMARY KEY (id),
  CONSTRAINT app_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT app_events_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);
CREATE TABLE public.entitlement_settings (
  id boolean NOT NULL DEFAULT true CHECK (id),
  reject_unentitled_modes boolean NOT NULL DEFAULT false,
  enforce_limits boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_settings_pkey PRIMARY KEY (id)
);
-- ADXL372 impact events from the TSA-V adapter, one row per falling edge of the
-- firmware impact FSM. Units are mg throughout. Source: supabase/accel_events.sql
-- plus supabase/accel_events_seq.sql.
--
-- READ THIS BEFORE "FIXING" azimuth_deg / elevation_deg: they are
-- GENERATED ALWAYS AS (...) STORED, not defaults. The Supabase dashboard's
-- schema export renders a generated expression in the DEFAULT slot because both
-- live in pg_attrdef and it does not check pg_attribute.attgenerated. A DEFAULT
-- cannot legally reference another column of the same row, so Postgres would
-- have rejected these outright had they really been defaults. CONFIRMED against
-- the live project 2026-09-21: attgenerated = 's' for both. Re-check with:
--   select attname, attgenerated from pg_attribute
--    where attrelid = 'public.impact_events'::regclass and attgenerated <> '';
--
-- Aggregate over rows where rebound_of IS NULL — the rest are follow-on FSM
-- edges of the same physical strike.
CREATE TABLE public.impact_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  session_id text NOT NULL,
  event_id text,
  pair_delta_ms integer,
  rebound_of bigint,
  impact_seq integer,
  t_onset_ms integer NOT NULL,
  t_peak_ms integer NOT NULL,
  dur_ms integer NOT NULL CHECK (dur_ms >= 0),
  peak_mg integer NOT NULL CHECK (peak_mg >= 0 AND peak_mg <= 250000),
  peak_x_mg integer NOT NULL,
  peak_y_mg integer NOT NULL,
  peak_z_mg integer NOT NULL,
  azimuth_deg numeric GENERATED ALWAYS AS (
    CASE WHEN peak_x_mg = 0 AND peak_y_mg = 0 THEN NULL::numeric
    ELSE round((degrees(atan2(peak_y_mg::double precision, peak_x_mg::double precision)))::numeric, 2)
    END) STORED,
  elevation_deg numeric GENERATED ALWAYS AS (
    CASE WHEN peak_x_mg = 0 AND peak_y_mg = 0 AND peak_z_mg = 0 THEN NULL::numeric
    ELSE round((degrees(atan2(peak_z_mg::double precision,
         sqrt(peak_x_mg::double precision * peak_x_mg::double precision
            + peak_y_mg::double precision * peak_y_mg::double precision))))::numeric, 2)
    END) STORED,
  g_range_g smallint NOT NULL DEFAULT 200,
  hpf boolean NOT NULL DEFAULT true,
  impact_on_mg integer NOT NULL,
  impact_off_mg integer NOT NULL,
  mg_per_lsb integer,
  odr_hz integer,
  bw_hz integer,
  sample_rate_hz_effective numeric,
  sample_source text NOT NULL CHECK (sample_source = ANY (ARRAY['scan_loop'::text, 'fifo'::text])),
  fw_version text,
  hw_rev text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ingested_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Multi-column CHECKs. The dashboard export omits these entirely (it emits
  -- only PK/FK at table level and single-column CHECKs inline), so their
  -- absence from a pasted dump is not evidence they are missing. Verify with:
  --   select conname, pg_get_constraintdef(oid) from pg_constraint
  --    where conrelid = 'public.impact_events'::regclass and contype = 'c';
  CONSTRAINT impact_events_peak_after_onset CHECK (t_peak_ms >= t_onset_ms),
  CONSTRAINT impact_events_release_below_trigger CHECK (impact_off_mg < impact_on_mg),
  CONSTRAINT impact_events_rebound_not_self CHECK (rebound_of IS NULL OR rebound_of <> id),
  CONSTRAINT impact_events_pkey PRIMARY KEY (id),
  CONSTRAINT impact_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id),
  CONSTRAINT impact_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id),
  CONSTRAINT impact_events_rebound_of_fkey FOREIGN KEY (rebound_of) REFERENCES public.impact_events(id)
);
