// src/lib/strengthIndex.ts
//
// Strength Index (SI) v2 — the one place SI is computed.
//
// WHY THIS IS A MODULE
//
// SI used to live inline in session.tsx, mobile/session.tsx and mobile/home.tsx,
// and the copies had drifted: the two session pages scored per frame against a
// Model III ceiling (396 mV/ms), home scored per strike against a Model IV
// ceiling (1320 mV/ms). The same hit scored differently depending on the
// screen that recorded it. Everything here is pure, so the call sites are a
// few lines each and drift shows up as a type error.
//
// WHAT v1 GOT WRONG (Oct 2026 TSA-V sessions)
//
//   • Every session's peak voltage sat at the 3.3 V rail, and the rate-log p90
//     equalled the max in all six: ≥10 % of strikes were pinned at the ceiling.
//   • The ceiling was a full-rail climb in ONE scan, so max SI tracked the
//     scan rate, not the athlete — 327 Hz sessions topped out at ~787, 400 Hz
//     at ~960, whatever the hit.
//   • Peak g across the same sessions ranged 8–29 g. The accelerometer keeps
//     discriminating after the pad saturates; v1 ignored it.
//
// v2
//
//   V   = 0.6 · slopeN + 0.4 · contactN          pad: speed-to-peak + contact
//   G   = ln(g / G_FLOOR) / ln(G_REF / G_FLOOR)  accelerometer, log scaled
//   raw = accel ? 0.4·V + 0.6·G : V
//   SI  = round(1000 · (1 − e^(−K·raw)))         raw 1 → 900; 1000 is asymptotic
//
// slopeN uses a fixed reference instead of the scan period, so two TSA-V
// sessions at 327 Hz and 400 Hz score on the same scale. contactN sums the
// de-spiked peaks of every real contact cell, which keeps rising after the
// dominant cell rails. G breaks the remaining ties.
//
// When the adapter has an accelerometer but no impact paired to a strike, the
// strike stayed under impact_on — that is a measurement (G = 0), not missing
// data. Adapters without an accelerometer score on V alone.
//
// Every constant marked PROVISIONAL is a starting point, not a calibration.
// Recalibrate from rate_log / peak_g distributions once paired strikes exist,
// and bump SI_VERSION whenever the formula or a constant changes so stored
// scores stay comparable within a version.

import type { ImpactFrame } from "../bluetooth/impacts";

/** Stored with every SI so v1 and v2 scores are never compared blindly. */
export const SI_VERSION = 2;

// ── Constants ────────────────────────────────────────────────────────────────

/** Firmware HIT_THRESHOLD_V. The voltage a cell crossed up from at onset. */
export const HIT_THRESHOLD_MV = 100;

/**
 * A strike is a run of frames with no gap longer than this. One SI per strike.
 */
export const IDLE_GAP_MS = 90;

/**
 * PROVISIONAL. slope that maps to slopeN = 1: a threshold-to-rail climb in one
 * ~300 Hz scan. Below every TSA-V effective scan rate seen (327–400 Hz), so all
 * of them reach slopeN = 1 on a rail hit, and the accelerometer separates those.
 * Model III (120 Hz) tops out near 0.4, Model II near 0.09 — slower hardware
 * still cannot resolve a fast rise, by design.
 */
export const SI_SLOPE_REF_MV_PER_MS = 960;

/**
 * Cells whose de-spiked peak stays below this are not counted as contact.
 * Filters the 100–150 mV row/column ghosting seen on hard hits.
 */
export const CONTACT_MIN_MV = 300;

/** PROVISIONAL. Summed contact peak for contactN = 1: four cells at the rail. */
export const CONTACT_REF_MV = 4 * 3200;

/** PROVISIONAL. g at G = 0 — at or below the lowest impact_on in use. */
export const G_FLOOR_G = 3;

/**
 * PROVISIONAL. g at G = 1. Roughly twice the 29 g maximum seen so far, which
 * was sampled once per scan loop and so under-reads short peaks. Set from the
 * p99.9 of paired primary impacts once they exist.
 */
export const G_REF_G = 60;

/** G may exceed 1 a little; the curve, not a clamp, keeps SI under 1000. */
const G_MAX = 1.25;

/** Curve steepness: raw = 1 → 1000 · (1 − e^−ln10) = 900. */
const SI_CURVE_K = Math.LN10;

/**
 * An impact pairs with a strike when its onset falls this many ms before to
 * PAIR_AFTER_MS after the strike's first contact. The accelerometer crosses
 * impact_on 20–50 ms after the pad sees the glove (measured on Oct 14 at
 * impact_on = 5 g); 80 leaves margin until impact_pair_delta_stats() gives a
 * measured p99.
 */
export const PAIR_BEFORE_MS = 10;
export const PAIR_AFTER_MS  = 80;

const V_SLOPE_WEIGHT   = 0.6;
const V_CONTACT_WEIGHT = 0.4;
const RAW_V_WEIGHT     = 0.4;
const RAW_G_WEIGHT     = 0.6;

// ── Types ────────────────────────────────────────────────────────────────────

/** [row, col, mv, t_first_ms, t_peak_ms, v_peak_mv, is_new] — the BLE hit tuple. */
export type SiHit = readonly [number, number, number, number, number, number, number];

/** The fields of a recorded frame that SI needs. */
export type SiFrame = {
  event_id:    string;
  t_device_ms: number;
  hits:        readonly SiHit[];
};

/** Per-strike cell accumulator, shared by the upload path and live feeds. */
export type StrikeCell = { r: number; c: number; samples: { mv: number; t: number }[] };

export type StrikeScore = {
  r:          number;          // dominant cell
  c:          number;
  peakMv:     number;          // dominant cell's de-spiked peak
  slope:      number;          // dominant cell's steepest genuine rise, mV/ms
  contactMv:  number;          // Σ de-spiked peaks of cells ≥ CONTACT_MIN_MV
  cellCount:  number;
  peakMg:     number | null;   // paired impact's peak, null when none paired
  si:         number;
};

export type Strike = StrikeScore & {
  tOnset:   number;            // earliest cell onset in the strike (device ms)
  tStart:   number;            // first frame time
  tEnd:     number;            // last frame time
  eventIds: string[];
};

/**
 * Accelerometer context for scoring. `present` false (or no context at all)
 * means the adapter has no accelerometer and SI is pad-only.
 */
export type AccelContext = {
  present: boolean;
  impacts: readonly ImpactFrame[];
};

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Pad term, 0–1. */
export function padTerm(slopeMvPerMs: number, contactMv: number): number {
  const slopeN   = Math.min(1, Math.max(0, slopeMvPerMs) / SI_SLOPE_REF_MV_PER_MS);
  const contactN = Math.min(1, Math.max(0, contactMv) / CONTACT_REF_MV);
  return V_SLOPE_WEIGHT * slopeN + V_CONTACT_WEIGHT * contactN;
}

/** Accelerometer term, 0–G_MAX. 0 below G_FLOOR_G, including no paired impact. */
export function accelTerm(peakMg: number | null): number {
  if (peakMg === null) return 0;
  const g = peakMg / 1000;
  if (!(g > G_FLOOR_G)) return 0;
  return Math.min(G_MAX, Math.log(g / G_FLOOR_G) / Math.log(G_REF_G / G_FLOOR_G));
}

/**
 * SI v2 from its inputs. `accelPresent` false scores on the pad alone;
 * true with peakMg null means the strike stayed under impact_on (G = 0).
 */
export function strengthIndexV2(p: {
  slopeMvPerMs: number;
  contactMv:    number;
  peakMg:       number | null;
  accelPresent: boolean;
}): number {
  if (!(p.slopeMvPerMs > 0)) return 0;
  const v   = padTerm(p.slopeMvPerMs, p.contactMv);
  const raw = p.accelPresent ? RAW_V_WEIGHT * v + RAW_G_WEIGHT * accelTerm(p.peakMg) : v;
  return Math.round(1000 * (1 - Math.exp(-SI_CURVE_K * raw)));
}

// 3-point median — drops an isolated single-sample saturation spike before the
// slope is measured, while preserving a genuine multi-sample rise.
function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * De-spiked peak (mV) and steepest genuine rising slope (mV/ms) of one cell.
 * scanPeriodMs is the smallest Δt the adapter can measure; a single-sample
 * cell rose at least from the hit threshold within one scan.
 */
export function cellRise(samples: { mv: number; t: number }[], scanPeriodMs: number): { peak: number; slope: number } {
  const floorDt = Math.max(scanPeriodMs, 0.1);
  if (samples.length === 0) return { peak: 0, slope: 0 };
  if (samples.length === 1) {
    const peak = samples[0].mv;
    return { peak, slope: Math.max(0, (peak - HIT_THRESHOLD_MV) / floorDt) };
  }
  const mv = samples.map((s, i) =>
    (i === 0 || i === samples.length - 1) ? s.mv : median3(samples[i - 1].mv, s.mv, samples[i + 1].mv));
  let maxSlope = 0;
  for (let i = 1; i < samples.length; i++) {
    if (mv[i] > mv[i - 1]) {
      const slope = (mv[i] - mv[i - 1]) / Math.max(samples[i].t - samples[i - 1].t, floorDt);
      if (slope > maxSlope) maxSlope = slope;
    }
  }
  const peak = Math.max(...mv);
  // Never rose after de-spiking (flat/declining) → onset fallback from the peak.
  if (maxSlope === 0) maxSlope = Math.max(0, (peak - HIT_THRESHOLD_MV) / floorDt);
  return { peak, slope: maxSlope };
}

/**
 * Score one strike. Slope comes from the DOMINANT cell (highest de-spiked
 * peak), so a neighbour that blips to the rail can't hijack it; contact sums
 * every cell that made real contact.
 */
export function scoreStrike(
  cells:        Map<number, StrikeCell>,
  scanPeriodMs: number,
  peakMg:       number | null,
  accelPresent: boolean,
): StrikeScore | null {
  let best: { r: number; c: number; peak: number; slope: number } | null = null;
  let contactMv = 0;
  for (const cell of cells.values()) {
    const cr = cellRise(cell.samples, scanPeriodMs);
    if (cr.peak >= CONTACT_MIN_MV) contactMv += cr.peak;
    if (!best || cr.peak > best.peak) best = { r: cell.r, c: cell.c, peak: cr.peak, slope: cr.slope };
  }
  if (!best) return null;
  return {
    r: best.r, c: best.c, peakMv: best.peak, slope: best.slope, contactMv,
    cellCount: cells.size,
    peakMg,
    si: strengthIndexV2({ slopeMvPerMs: best.slope, contactMv, peakMg, accelPresent }),
  };
}

/**
 * Largest impact peak whose onset falls in [tOnset − PAIR_BEFORE_MS,
 * tOnset + PAIR_AFTER_MS]. Rebounds of the same strike land in the window too;
 * taking the max keeps the primary. null when nothing pairs.
 */
export function pairedPeakMg(impacts: readonly ImpactFrame[], tOnset: number, claimed?: Set<ImpactFrame>): number | null {
  let peak: number | null = null;
  for (const imp of impacts) {
    if (claimed?.has(imp)) continue;
    const d = imp.tOnsetMs - tOnset;
    if (d < -PAIR_BEFORE_MS || d > PAIR_AFTER_MS) continue;
    claimed?.add(imp);
    if (peak === null || imp.peakMg > peak) peak = imp.peakMg;
  }
  return peak;
}

/** Earliest firmware-tracked cell onset among a frame's hits. */
function frameOnset(f: SiFrame): number {
  let t = f.t_device_ms;
  for (const h of f.hits) if (h[3] < t) t = h[3];
  return t;
}

/**
 * Split the frame stream into idle-gap-separated strikes and score each once.
 *
 * A strike's onset is the earliest cell onset in its first frame — firmware
 * tracks it per cell, so it survives dropped BLE frames. A new strike starts
 * only after a gap with no contact at all, so no cell held over from an
 * earlier strike can drag that onset back.
 */
export function segmentStrikes(
  frames:       readonly SiFrame[],
  scanPeriodMs: number,
  accel?:       AccelContext | null,
): Strike[] {
  const strikes: Strike[] = [];
  const accelPresent = accel?.present === true;
  const claimed = new Set<ImpactFrame>();
  let cur: { tOnset: number; tStart: number; tEnd: number; eventIds: string[]; cells: Map<number, StrikeCell> } | null = null;

  const close = () => {
    if (!cur) return;
    const peakMg = accelPresent ? pairedPeakMg(accel!.impacts, cur.tOnset, claimed) : null;
    const sc = scoreStrike(cur.cells, scanPeriodMs, peakMg, accelPresent);
    if (sc) strikes.push({ tOnset: cur.tOnset, tStart: cur.tStart, tEnd: cur.tEnd, eventIds: cur.eventIds, ...sc });
    cur = null;
  };

  for (const f of frames) {
    if (!f.hits.length) continue;
    const ft = f.t_device_ms;
    if (cur && ft - cur.tEnd > IDLE_GAP_MS) close();
    if (!cur) cur = { tOnset: frameOnset(f), tStart: ft, tEnd: ft, eventIds: [], cells: new Map() };
    cur.tEnd = ft;
    cur.eventIds.push(f.event_id);
    for (const h of f.hits) {
      const key = h[0] * 100 + h[1];
      let cell = cur.cells.get(key);
      if (!cell) { cell = { r: h[0], c: h[1], samples: [] }; cur.cells.set(key, cell); }
      cell.samples.push({ mv: h[2], t: ft });
    }
  }
  close();
  return strikes;
}

/**
 * Map each frame's event_id to its strike's SI, so the per-frame events table
 * stays intact while every frame in a strike shares one stable score.
 */
export function strikeSiByEvent(strikes: readonly Strike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of strikes) for (const id of s.eventIds) m.set(id, s.si);
  return m;
}

/**
 * Per-session distribution of strike slopes and paired peaks — the data the
 * PROVISIONAL constants above get recalibrated from. Persisted in
 * session_summaries.quality.rate_log.
 */
export function strikeRateLog(strikes: readonly Strike[], scanPeriodMs: number): {
  count: number; max: number; mean: number; p50: number; p90: number; p95: number;
  scan_period_ms: number; si_version: number;
  paired: number; peak_g_p50: number | null; peak_g_max: number | null;
} | null {
  const slopes = strikes.map(s => s.slope).filter(s => s > 0).sort((a, b) => a - b);
  if (!slopes.length) return null;
  const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  const gs = strikes.map(s => s.peakMg).filter((g): g is number => g !== null).sort((a, b) => a - b);
  return {
    count:          slopes.length,
    max:            +slopes[slopes.length - 1].toFixed(2),
    mean:           +(slopes.reduce((a, b) => a + b, 0) / slopes.length).toFixed(2),
    p50:            +q(slopes, 0.50).toFixed(2),
    p90:            +q(slopes, 0.90).toFixed(2),
    p95:            +q(slopes, 0.95).toFixed(2),
    scan_period_ms: scanPeriodMs,
    si_version:     SI_VERSION,
    paired:         gs.length,
    peak_g_p50:     gs.length ? +(q(gs, 0.5) / 1000).toFixed(2) : null,
    peak_g_max:     gs.length ? +(gs[gs.length - 1] / 1000).toFixed(2) : null,
  };
}
