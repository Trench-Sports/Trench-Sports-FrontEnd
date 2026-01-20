// src/processing/liveMetrics.ts

import type { CalibrationConfig } from "./calibration";
import { forceNFromVoltage } from "./calibration";
import type { SampleMsg } from "./normalize";

export type LiveCell = {
  voltage: number;
  pressure_kpa: number;
  force_n: number;
  lastUpdateAt: number; // Date.now()
  lastSampleTsMs: number; // stream ts
  hits: number;
  peak_pressure_kpa: number;
  peak_force_n: number;
};

export type LiveMetricsSnapshot = {
  rows: number;
  cols: number;
  grid: LiveCell[][];
  totals: {
    samples: number;
    last_ts_ms: number | null;
    peak_force_n: number;
    peak_pressure_kpa: number;
  };
};

function makeCell(): LiveCell {
  return {
    voltage: 0,
    pressure_kpa: 0,
    force_n: 0,
    lastUpdateAt: 0,
    lastSampleTsMs: 0,
    hits: 0,
    peak_pressure_kpa: 0,
    peak_force_n: 0,
  };
}

export class LiveMetrics {
  private rows: number;
  private cols: number;
  private cal: CalibrationConfig;

  private grid: LiveCell[][];
  private samples = 0;
  private lastTs: number | null = null;

  private peakForce = 0;
  private peakPressure = 0;

  constructor(rows: number, cols: number, calibration: CalibrationConfig) {
    this.rows = rows;
    this.cols = cols;
    this.cal = calibration;
    this.grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell()));
  }

  setGridSize(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell()));
    this.samples = 0;
    this.lastTs = null;
    this.peakForce = 0;
    this.peakPressure = 0;
  }

  applySample(s: SampleMsg) {
    const r = s.row - 1;
    const c = s.col - 1;
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return;

    const derived = forceNFromVoltage(s.voltage, this.cal, { r, c });
    const cell = this.grid[r][c];

    cell.voltage = s.voltage;
    cell.pressure_kpa = derived.pressure_kpa;
    cell.force_n = derived.force_n;
    cell.lastUpdateAt = Date.now();
    cell.lastSampleTsMs = s.ts_ms;
    cell.hits += 1;

    cell.peak_pressure_kpa = Math.max(cell.peak_pressure_kpa, derived.pressure_kpa);
    cell.peak_force_n = Math.max(cell.peak_force_n, derived.force_n);

    this.samples += 1;
    this.lastTs = s.ts_ms;
    this.peakPressure = Math.max(this.peakPressure, derived.pressure_kpa);
    this.peakForce = Math.max(this.peakForce, derived.force_n);
  }

  snapshot(): LiveMetricsSnapshot {
    return {
      rows: this.rows,
      cols: this.cols,
      grid: this.grid,
      totals: {
        samples: this.samples,
        last_ts_ms: this.lastTs,
        peak_force_n: this.peakForce,
        peak_pressure_kpa: this.peakPressure,
      },
    };
  }
}
