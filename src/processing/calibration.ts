// src/processing/calibration.ts

export type Rc = { r: number; c: number }; // 0-based indices

export type LinearModel = {
  model: "linear";
  // pressure_kpa = a * voltage + b
  a: number;
  b: number;
  clamp_kpa?: [number, number];
};

export type PiecewiseModel = {
  model: "piecewise";
  // points sorted by voltage: [[v0,p0],[v1,p1],...]
  points: Array<[number, number]>;
  clamp_kpa?: [number, number];
};

export type VoltageToPressureModel = LinearModel | PiecewiseModel;

export type CalibrationConfig = {
  // sensor geometry
  cell_pitch_mm_x: number;
  cell_pitch_mm_y: number;

  // global model
  v_to_p: VoltageToPressureModel;

  // optional per-cell overrides (key: "r,c" using 0-based)
  per_cell?: Record<string, Partial<VoltageToPressureModel>>;

  // optional: baseline voltage offset to subtract (global or per-cell)
  v_offset?: number;
  per_cell_v_offset?: Record<string, number>;

  units?: {
    voltage?: "V";
    pressure?: "kPa";
    force?: "N";
  };
};

function clamp(x: number, lo?: number, hi?: number) {
  let y = x;
  if (lo != null) y = Math.max(lo, y);
  if (hi != null) y = Math.min(hi, y);
  return y;
}

function interpPiecewise(v: number, points: Array<[number, number]>): number {
  if (points.length === 0) return 0;

  // If out of range, extrapolate flat at ends
  if (v <= points[0][0]) return points[0][1];
  if (v >= points[points.length - 1][0]) return points[points.length - 1][1];

  for (let i = 0; i < points.length - 1; i++) {
    const [v0, p0] = points[i];
    const [v1, p1] = points[i + 1];
    if (v >= v0 && v <= v1) {
      const t = (v - v0) / (v1 - v0 || 1);
      return p0 + t * (p1 - p0);
    }
  }
  return points[points.length - 1][1];
}

function key(rc: Rc) {
  return `${rc.r},${rc.c}`;
}

function effectiveModel(cfg: CalibrationConfig, rc?: Rc): VoltageToPressureModel {
  if (!rc || !cfg.per_cell) return cfg.v_to_p;

  const override = cfg.per_cell[key(rc)];
  if (!override) return cfg.v_to_p;

  // Merge override onto global model where compatible
  if (cfg.v_to_p.model === "linear") {
    return {
      model: "linear",
      a: override.model === "linear" && override.a != null ? override.a : cfg.v_to_p.a,
      b: override.model === "linear" && override.b != null ? override.b : cfg.v_to_p.b,
      clamp_kpa: (override as any).clamp_kpa ?? cfg.v_to_p.clamp_kpa,
    };
  }

  // piecewise
  return {
    model: "piecewise",
    points: override.model === "piecewise" && (override as any).points ? (override as any).points : cfg.v_to_p.points,
    clamp_kpa: (override as any).clamp_kpa ?? cfg.v_to_p.clamp_kpa,
  };
}

function effectiveOffset(cfg: CalibrationConfig, rc?: Rc): number {
  if (!rc) return cfg.v_offset ?? 0;
  return (cfg.per_cell_v_offset?.[key(rc)] ?? cfg.v_offset ?? 0);
}

export function pressureKpaFromVoltage(voltage: number, cfg: CalibrationConfig, rc?: Rc): number {
  const v = voltage - effectiveOffset(cfg, rc);
  const model = effectiveModel(cfg, rc);

  let p = 0;

  if (model.model === "linear") {
    p = model.a * v + model.b;
    if (model.clamp_kpa) p = clamp(p, model.clamp_kpa[0], model.clamp_kpa[1]);
    return p;
  }

  p = interpPiecewise(v, model.points);
  if (model.clamp_kpa) p = clamp(p, model.clamp_kpa[0], model.clamp_kpa[1]);
  return p;
}

export function cellAreaM2(cfg: CalibrationConfig): number {
  const ax = cfg.cell_pitch_mm_x / 1000;
  const ay = cfg.cell_pitch_mm_y / 1000;
  return ax * ay;
}

export function forceNFromPressureKpa(pressureKpa: number, cfg: CalibrationConfig): number {
  const pa = pressureKpa * 1000; // kPa -> Pa
  return pa * cellAreaM2(cfg);
}

export function forceNFromVoltage(voltage: number, cfg: CalibrationConfig, rc?: Rc): {
  pressure_kpa: number;
  force_n: number;
} {
  const p = pressureKpaFromVoltage(voltage, cfg, rc);
  return { pressure_kpa: p, force_n: forceNFromPressureKpa(p, cfg) };
}
