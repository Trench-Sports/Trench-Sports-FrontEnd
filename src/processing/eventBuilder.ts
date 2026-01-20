// src/processing/eventBuilder.ts

import type { SampleMsg } from "./normalize";
import type { CalibrationConfig, Rc } from "./calibration";
import { forceNFromVoltage } from "./calibration";

export type EventBuilderConfig = {
  // Use one of these; pressure threshold is preferred once calibrated.
  threshold_voltage?: number;
  threshold_pressure_kpa?: number;

  // If no "active" samples arrive for this long, end event.
  idle_gap_ms: number;

  // Ignore tiny blips
  min_duration_ms?: number;

  // Optional: merge events if they are separated by a tiny gap
  merge_gap_ms?: number;

  // how to compute dt if samples are irregular
  default_dt_ms?: number;
};

export type EventCellSummary = {
  r: number; // 0-based
  c: number; // 0-based
  samples: number;
  v_min: number;
  p_max_kpa: number;
  t_first_ms: number;
  t_last_ms: number;
};

export type BuiltEvent = {
  event_id: string;
  t_start_ms: number;
  t_end_ms: number;
  duration_ms: number;

  peak_pressure_kpa: number;
  peak_force_n: number;
  impulse_ns: number;

  // sparse per-cell summaries
  cells: EventCellSummary[];

  // keep raw for now (you can drop later)
  raw_samples: Array<{
    ts_ms: number;
    row: number; // 1-based
    col: number; // 1-based
    voltage: number;
    pressure_kpa: number;
    force_n: number;
  }>;
};

type RunningCell = {
  r: number;
  c: number;
  samples: number;
  v_min: number;
  p_max_kpa: number;
  t_first_ms: number;
  t_last_ms: number;
};

function uuidLike(prefix = "evt"): string {
  // deterministic enough for client-side; replace with crypto.randomUUID() if you want
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class EventBuilder {
  private cfg: EventBuilderConfig;
  private cal: CalibrationConfig;

  private inEvent = false;
  private eventId: string | null = null;

  private tStart = 0;
  private tLastActive = 0;
  private tLastAny = 0;

  private peakP = 0;
  private peakF = 0;
  private impulseNs = 0;

  private lastSampleTs: number | null = null;

  private cellMap = new Map<string, RunningCell>();
  private rawSamples: BuiltEvent["raw_samples"] = [];

  constructor(cfg: EventBuilderConfig, calibration: CalibrationConfig) {
    this.cfg = cfg;
    this.cal = calibration;
  }

  reset() {
    this.inEvent = false;
    this.eventId = null;
    this.tStart = 0;
    this.tLastActive = 0;
    this.tLastAny = 0;
    this.peakP = 0;
    this.peakF = 0;
    this.impulseNs = 0;
    this.lastSampleTs = null;
    this.cellMap.clear();
    this.rawSamples = [];
  }

  private isActiveSample(voltage: number, pressureKpa: number): boolean {
    if (this.cfg.threshold_pressure_kpa != null) return pressureKpa >= this.cfg.threshold_pressure_kpa;
    if (this.cfg.threshold_voltage != null) return voltage >= this.cfg.threshold_voltage;
    // default: treat any non-zero-ish as active
    return pressureKpa > 0;
  }

  private updateCell(rc: Rc, ts: number, voltage: number, pressureKpa: number) {
    const k = `${rc.r},${rc.c}`;
    const existing = this.cellMap.get(k);
    if (!existing) {
      this.cellMap.set(k, {
        r: rc.r,
        c: rc.c,
        samples: 1,
        v_min: voltage,
        p_max_kpa: pressureKpa,
        t_first_ms: ts,
        t_last_ms: ts,
      });
      return;
    }
    existing.samples += 1;
    existing.v_min = Math.min(existing.v_min, voltage);
    existing.p_max_kpa = Math.max(existing.p_max_kpa, pressureKpa);
    existing.t_last_ms = ts;
  }

  private integrateImpulse(ts: number, totalForceN: number) {
    // integrate as rectangle between samples using dt = current_ts - last_ts
    const dtMs =
      this.lastSampleTs != null
        ? Math.max(0, ts - this.lastSampleTs)
        : (this.cfg.default_dt_ms ?? 0);

    // N * s => Ns (but here ms, so /1000)
    const dtS = dtMs / 1000;
    this.impulseNs += totalForceN * dtS;

    this.lastSampleTs = ts;
  }

  /**
   * Push a sample. Returns 0..N finished events (usually 0 or 1).
   */
  push(sample: SampleMsg): BuiltEvent[] {
    const out: BuiltEvent[] = [];

    const rc: Rc = { r: sample.row - 1, c: sample.col - 1 };
    const derived = forceNFromVoltage(sample.voltage, this.cal, rc);
    const active = this.isActiveSample(sample.voltage, derived.pressure_kpa);

    this.tLastAny = sample.ts_ms;

    if (!this.inEvent) {
      if (!active) return out;

      // start event
      this.inEvent = true;
      this.eventId = uuidLike("evt");
      this.tStart = sample.ts_ms;
      this.tLastActive = sample.ts_ms;
      this.peakP = 0;
      this.peakF = 0;
      this.impulseNs = 0;
      this.lastSampleTs = null;
      this.cellMap.clear();
      this.rawSamples = [];
    }

    // If in event, update state on every sample (active or not), but keep "active time" only for active
    if (active) this.tLastActive = sample.ts_ms;

    // per-cell summaries
    this.updateCell(rc, sample.ts_ms, sample.voltage, derived.pressure_kpa);

    // peaks (per-sample; if you later compute total-force across all cells per timestamp,
    // you’ll replace this with a per-frame total force calculation)
    this.peakP = Math.max(this.peakP, derived.pressure_kpa);
    this.peakF = Math.max(this.peakF, derived.force_n);

    // impulse integration (approx on sample stream)
    this.integrateImpulse(sample.ts_ms, derived.force_n);

    // keep raw
    this.rawSamples.push({
      ts_ms: sample.ts_ms,
      row: sample.row,
      col: sample.col,
      voltage: sample.voltage,
      pressure_kpa: derived.pressure_kpa,
      force_n: derived.force_n,
    });

    // Check end condition
    const idle = sample.ts_ms - this.tLastActive;
    if (idle >= this.cfg.idle_gap_ms) {
      const tEnd = this.tLastActive; // event ends at last active time
      const duration = tEnd - this.tStart;

      const minDur = this.cfg.min_duration_ms ?? 0;
      if (duration >= minDur && this.eventId) {
        out.push({
          event_id: this.eventId,
          t_start_ms: this.tStart,
          t_end_ms: tEnd,
          duration_ms: duration,
          peak_pressure_kpa: this.peakP,
          peak_force_n: this.peakF,
          impulse_ns: this.impulseNs,
          cells: Array.from(this.cellMap.values()),
          raw_samples: this.rawSamples,
        });
      }

      // reset and allow next event
      this.reset();
    }

    return out;
  }

  /**
   * Call at end-of-session to flush an open event even if idle gap not reached.
   */
  flush(): BuiltEvent[] {
    if (!this.inEvent || !this.eventId) return [];
    const tEnd = this.tLastActive;
    const duration = tEnd - this.tStart;

    const minDur = this.cfg.min_duration_ms ?? 0;
    const evt: BuiltEvent | null =
      duration >= minDur
        ? {
            event_id: this.eventId,
            t_start_ms: this.tStart,
            t_end_ms: tEnd,
            duration_ms: duration,
            peak_pressure_kpa: this.peakP,
            peak_force_n: this.peakF,
            impulse_ns: this.impulseNs,
            cells: Array.from(this.cellMap.values()),
            raw_samples: this.rawSamples,
          }
        : null;

    this.reset();
    return evt ? [evt] : [];
  }
}
