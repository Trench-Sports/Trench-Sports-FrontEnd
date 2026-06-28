-- ─────────────────────────────────────────────────────────────────────────────
-- Add sessions.device_id  (Model IV)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes: POST /rest/v1/sessions 400 — "Could not find the 'device_id' column
-- of 'sessions' in the schema cache".
--
-- Model IV firmware (Everything-in-C/main/app_main.c → send_hello) advertises a
-- per-device id in the BLE hello packet ("id": s_dev_id, persisted in NVS).
-- home.tsx reads it into deviceInfo.id and saveSession() writes it to
-- sessions.device_id. The column never existed in the live schema, so every
-- insert that included device_id was rejected.
--
-- Design notes:
--   * text, to match the firmware id (e.g. "TS-UNKNOWN") and devices.id.
--   * NULLABLE — anonymous MVP recordings have no programId, so the device-claim
--     path in home.tsx (`if (supabase && programIdRef.current)`) is skipped and
--     NO row is created in public.devices. A hard FK to devices(id) would reject
--     those inserts and reintroduce the 400. We therefore add a plain indexed
--     column with no foreign key. (See commented FK block below if/when every
--     session is guaranteed a devices row.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS device_id text;

-- Index for dashboards / queries that filter sessions by hardware device.
CREATE INDEX IF NOT EXISTS idx_sessions_device_id
  ON public.sessions (device_id);

COMMENT ON COLUMN public.sessions.device_id IS
  'Hardware device id from the BLE hello packet (firmware s_dev_id / devices.id). '
  'Nullable: anonymous sessions may not have a corresponding public.devices row.';

-- ── Optional: promote to a real foreign key later ────────────────────────────
-- Only enable once every saved session is guaranteed to have a matching
-- public.devices row (i.e. the device-claim path always runs). Until then this
-- WILL break anonymous inserts.
--
-- ALTER TABLE public.sessions
--   ADD CONSTRAINT sessions_device_id_fkey
--   FOREIGN KEY (device_id) REFERENCES public.devices (id)
--   ON DELETE SET NULL;

-- PostgREST caches the schema; reload so the new column is visible immediately.
NOTIFY pgrst, 'reload schema';
