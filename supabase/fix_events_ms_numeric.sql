-- ─────────────────────────────────────────────────────────────────────────────
-- events: convert integer millisecond columns to numeric (Model IV)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes: POST /rest/v1/events 400 —
--   "invalid input syntax for type integer: \"2.5\""
--
-- Model IV runs a ~2.5 ms free-running scan (SCAN_PROFILES["IV"].scanPeriodMs,
-- and resolveScanTiming() can yield values like 2.288 from the live "hz").
-- Single-frame events set duration_ms to that scan period (home.tsx:2101), so a
-- fractional value is written into events.duration_ms, which was typed integer.
-- Models II (37 ms) / III (8 ms) have whole-ms periods, so this only appears on IV.
--
-- These are millisecond timing metrics; their siblings rise_time_ms and
-- decay_time_ms are already numeric. Converting aligns the types and preserves
-- Model IV sub-ms precision. Existing integer values cast losslessly.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ALTER COLUMN duration_ms     TYPE numeric USING duration_ms::numeric,
  ALTER COLUMN iei_prev_ms     TYPE numeric USING iei_prev_ms::numeric,
  ALTER COLUMN reaction_time_ms TYPE numeric USING reaction_time_ms::numeric;

COMMENT ON COLUMN public.events.duration_ms IS
  'Contact-window duration in ms. numeric to hold Model IV sub-ms scan periods (~2.5 ms).';

-- PostgREST schema cache reload.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after) ─────────────────────────────────────────────────
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='events'
--     AND column_name IN ('duration_ms','iei_prev_ms','reaction_time_ms');
--   -- all three should report 'numeric'. Then run a full /m/home save on Model IV.
