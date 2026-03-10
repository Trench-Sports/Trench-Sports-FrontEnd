// src/tools/processSession.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { normalizeJson, tryParseJson } from "../src/processing/normalize";
import { EventBuilder } from "../src/processing/eventBuilder";
import type { CalibrationConfig } from "../src/processing/calibration";

// -------------------------
// CLI args
// -------------------------
const ndjsonPath = process.argv[2];
if (!ndjsonPath) {
  console.error("Usage: npx tsx tools/process_session.ts <path/to/session.ndjson>");
  process.exit(1);
}

// -------------------------
// Supabase
// -------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in tools/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -------------------------
// Defaults / fallback calibration
// Replace these once you have real calibration.
// -------------------------
function defaultCalibration(): CalibrationConfig {
  return {
    cell_pitch_mm_x: 10, // TODO: set real pitch
    cell_pitch_mm_y: 10, // TODO: set real pitch
    v_to_p: { model: "linear", a: 100, b: 0, clamp_kpa: [0, 1000] }, // TODO: real curve
    units: { voltage: "V", pressure: "kPa", force: "N" },
  };
}

// -------------------------
// Main
// -------------------------
async function main() {
  const text = fs.readFileSync(ndjsonPath, "utf-8");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  let sessionStart: any | null = null;

  // Detect session_start + collect samples
  const samples: Array<{ ts_ms: number; row: number; col: number; voltage: number; raw: any }> = [];

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj) continue;

    const msg = normalizeJson(obj);

    if (msg.kind === "session_start" && !sessionStart) {
      sessionStart = msg.raw;
      continue;
    }

    if (msg.kind === "sample") {
      samples.push({ ts_ms: msg.ts_ms, row: msg.row, col: msg.col, voltage: msg.voltage, raw: msg.raw });
    }
  }

  if (!samples.length) {
    console.error("No samples found in NDJSON.");
    process.exit(1);
  }

  // session metadata
  const started_at_ms = samples[0].ts_ms;
  const ended_at_ms = samples[samples.length - 1].ts_ms;

  const gridSize = sessionStart?.session?.grid_size; // [cols, rows]
  const grid_cols = Number(gridSize?.[0] ?? process.env.DEFAULT_GRID_COLS ?? 8);
  const grid_rows = Number(gridSize?.[1] ?? process.env.DEFAULT_GRID_ROWS ?? 12);

  const session_id =
    sessionStart?.session?.id ??
    `sess_${path.basename(ndjsonPath).replaceAll(".", "_")}_${started_at_ms}`;

  // calibration (use sessionStart.session.calibration if present, else fallback)
  const cal: CalibrationConfig = sessionStart?.session?.calibration ?? defaultCalibration();

  // Event segmentation config (tune these)
  const builder = new EventBuilder(
    {
      threshold_voltage: 0.02, // TODO: tune or switch to threshold_pressure_kpa
      idle_gap_ms: 120,
      min_duration_ms: 10,
      default_dt_ms: 5,
    },
    cal
  );

  const builtEvents = [];
  for (const s of samples) {
    const out = builder.push({
      kind: "sample",
      raw: s.raw,
      ts_ms: s.ts_ms,
      row: s.row,
      col: s.col,
      voltage: s.voltage,
    });
    builtEvents.push(...out);
  }
  builtEvents.push(...builder.flush());

  // -------------------------
  // Build example_data.json-like structure (starter)
  // -------------------------
  const exampleLike = {
    version: sessionStart?.session?.version ?? "0.1",
    session: {
      id: session_id,
      started_at_ms,
      ended_at_ms,
      grid_rows,
      grid_cols,
      device_model: sessionStart?.session?.device_model ?? process.env.DEFAULT_DEVICE_MODEL ?? "UNKNOWN",
      sampling_hz: sessionStart?.session?.sampling_hz ?? null,
      calibration: cal,
      raw: sessionStart ?? { note: "no session_start in ndjson" },
    },
    events: builtEvents.map((e) => ({
      event_id: e.event_id,
      t_start_ms: e.t_start_ms,
      t_end_ms: e.t_end_ms,
      duration_ms: e.duration_ms,
      peak_pressure_kpa: e.peak_pressure_kpa,
      peak_force_n: e.peak_force_n,
      impulse_ns: e.impulse_ns,
      // placeholders — fill in during “accurate post” phase
      rise_time_ms: null,
      decay_time_ms: null,
      angle_deg: null,
      glancing_score: null,
      spatial: {},
      force: {},
      temporal: {},
      angle: {},
      quality: {},
      raw: {
        raw_samples: e.raw_samples,
      },
      cells: e.cells,
    })),
    summary: {
      num_events: builtEvents.length,
      session_duration_ms: ended_at_ms - started_at_ms,
      // placeholders
      cadence_hz_avg: null,
      cadence_hz_median: null,
      heatmap: null,
      quality: {},
    },
  };

  // -------------------------
  // Write to Supabase
  // -------------------------

  // 1) sessions
  const { error: sessErr } = await supabase.from("sessions").upsert({
    id: session_id,
    version: exampleLike.version,
    started_at_ms,
    ended_at_ms,
    grid_rows,
    grid_cols,
    device_model: exampleLike.session.device_model,
    sampling_hz: exampleLike.session.sampling_hz,
    calibration: exampleLike.session.calibration,
    raw: exampleLike.session.raw,
  });

  if (sessErr) throw sessErr;

  // 2) events + event_cells
  for (const e of builtEvents) {
    const { error: evtErr } = await supabase.from("events").upsert({
      event_id: e.event_id,
      session_id,
      t_start_ms: e.t_start_ms,
      t_end_ms: e.t_end_ms,
      duration_ms: e.duration_ms,
      iei_prev_ms: null,
      peak_pressure_kpa: e.peak_pressure_kpa,
      peak_force_n: e.peak_force_n,
      impulse_ns: e.impulse_ns,
      rise_time_ms: null,
      decay_time_ms: null,
      angle_deg: null,
      glancing_score: null,
      spatial: {},
      force: {},
      temporal: {},
      angle: {},
      quality: {},
      raw: { raw_samples: e.raw_samples },
    });

    if (evtErr) throw evtErr;

    if (e.cells.length) {
      const rows = e.cells.map((c) => ({
        event_id: e.event_id,
        r: c.r,
        c: c.c,
        samples: c.samples,
        v_min: c.v_min,
        p_max_kpa: c.p_max_kpa,
        t_first_ms: c.t_first_ms,
        t_last_ms: c.t_last_ms,
      }));

      const { error: cellsErr } = await supabase.from("event_cells").insert(rows);
      if (cellsErr) throw cellsErr;
    }
  }

  // 3) session_summaries (starter)
  const { error: sumErr } = await supabase.from("session_summaries").upsert({
    session_id,
    num_events: builtEvents.length,
    session_duration_ms: ended_at_ms - started_at_ms,
    cadence_hz_avg: null,
    cadence_hz_median: null,
    iei_ms: null,
    longest_pause_ms: null,
    peak_force_stats: null,
    impulse_stats: null,
    duration_ms_stats: null,
    angles_deg: null,
    most_contacted_cell_rc: null,
    center_of_mass_mm: null,
    heatmap: null,
    quality: {},
    player_id: null,
    Date_Of_Record: new Date().toISOString(),
  });

  if (sumErr) throw sumErr;

  // Save the example-like JSON locally too
  const outPath = path.resolve(process.cwd(), `processed_${session_id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(exampleLike, null, 2), "utf-8");

  console.log(`✅ Processed session ${session_id}`);
  console.log(`✅ Wrote Supabase rows for sessions/events/event_cells/session_summaries`);
  console.log(`✅ Saved: ${outPath}`);
}

main().catch((err) => {
  console.error("❌ process_session failed:", err);
  process.exit(1);
});
