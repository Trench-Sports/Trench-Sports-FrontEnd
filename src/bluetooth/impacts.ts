// src/bluetooth/impacts.ts
//
// TSA-V (Model V) ADXL372 impact ingest — the one place that knows the
// {"type":"impact"} wire format and the shape of a public.impact_events row.
//
// WHY THIS IS A MODULE AND NOT INLINE
//
// The BLE notify handler and uploadSession() are triplicated across
// src/pages/session.tsx, src/pages/mobile/session.tsx and
// src/pages/mobile/home.tsx. Every capability added inline to one of them has
// historically failed to reach the other two — see the note at the top of
// src/bluetooth/models.ts, where exactly that happened to the scan-timing
// table. Everything here is pure, so the three call sites are a handful of
// lines each and drift between them shows up as a type error.
//
// WHAT THE FIRMWARE SENDS
//   Components/Electronics/TSA-V/Everything-in-C/main/app_main.c, send_impact()
//
//     {"type":"impact","seq":<n>,"t":<onset ms>,"g":<peak mg>,"a":[x,y,z],
//      "t_peak":<ms>,"dur":<ms>}
//
//   "seq" is a monotonic per-boot record number, added in fw 1.4.2-c and
//   absent on anything older. The device burns it when the FSM closes an
//   event, BEFORE handing the record to a 6-deep tx queue that drops on
//   overflow and reports it only to the serial log. A dropped impact
//   therefore leaves a hole we can see; without it, loss is invisible.
//
//   Fired once per impact on the FSM falling edge, so the peak is final. "t"
//   is the ONSET on the same esp_timer clock the matrix frames carry, which is
//   what lets SQL pair an impact with the matrix event from the same strike.
//
//   Capture conditions do NOT ride on the impact frame. They come from hello
//   once per connection and are stamped onto every row — impact_on / impact_off
//   are runtime tunable over BLE ({"cmd":"imu","thresh":..,"release":..}), so a
//   5 g event from one session and a 5 g event from another were not
//   necessarily detected under the same rule.
//
// Destination schema: supabase/accel_events.sql
//
// NOT HANDLED HERE, on purpose:
//   • {"type":"imu"} 10 Hz telemetry. Live readout only, never persisted.
//   • Rebound coalescing. A swinging bag or a follow-through produces several
//     FSM events per physical strike, and the window that collapses them has
//     never been measured against a real strike. It lives in SQL
//     (mark_impact_rebounds) so it can be retuned and re-run over existing
//     data without an app release.
//   • Impulse and jerk. Not derivable from a peak.
//
// processSessionImpacts() at the bottom is the one exception to "pure": it is
// the post-upload RPC, kept here so the three uploadSession() copies share one
// call instead of three.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionUploadStageFailed } from "../lib/telemetryEvents";

export type ImpactFrame = {
  // null on fw < 1.4.2-c, which did not number its records.
  seq:      number | null;
  tOnsetMs: number;
  tPeakMs:  number;
  durMs:    number;
  peakMg:   number;
  peakXMg:  number;
  peakYMg:  number;
  peakZMg:  number;
};

export type AccelSampleSource = "scan_loop" | "fifo";

// Capture conditions for one connection, read from hello.
export type AccelCapture = {
  present:      boolean;
  gRangeG:      number;
  hpf:          boolean;
  impactOnMg:   number;
  impactOffMg:  number;
  mgPerLsb:     number | null;
  odrHz:        number | null;
  bwHz:         number | null;
  sampleRateHz: number | null;
  sampleSource: AccelSampleSource;
  fwVersion:    string | null;
  hwRev:        string | null;
  // "firmware" = the thresholds as the device reported them, not set by this
  // app. "dev_override" = a dev build replaced them over BLE after hello
  // (configureImu in imuTelemetry.ts), so hello's values are NOT the ones
  // detection ran under.
  thresholdSource: "firmware" | "dev_override";
  // true once the device itself echoed impactOnMg / impactOffMg in an
  // {"type":"imu_cfg"} reply (fw >= 1.4.6-c). false = taken from hello, or
  // assumed from a successful write on firmware that does not reply.
  thresholdConfirmed: boolean;
};

// Mirrors the CHECK constraints in supabase/accel_events.sql. A frame that
// would violate one is dropped here rather than failing a whole chunk insert
// and stranding the matrix data with it.
const PEAK_MG_MAX = 250000;   // 200 g at 100 mg/LSB tops out near 204,800 mg

function finiteInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Parse one BLE record into an ImpactFrame, or null if it is not a usable
 * impact. Returning null covers a malformed frame and a well-formed frame that
 * the database would reject — the caller treats both the same way.
 */
export function parseImpactFrame(obj: any): ImpactFrame | null {
  if (!obj || obj.type !== "impact") return null;

  const tOnsetMs = finiteInt(obj.t);
  const tPeakMs  = finiteInt(obj.t_peak);
  const durMs    = finiteInt(obj.dur);
  const peakMg   = finiteInt(obj.g);
  const a        = obj.a;

  if (tOnsetMs === null || tPeakMs === null || durMs === null || peakMg === null) return null;
  if (!Array.isArray(a) || a.length < 3) return null;

  const peakXMg = finiteInt(a[0]);
  const peakYMg = finiteInt(a[1]);
  const peakZMg = finiteInt(a[2]);
  if (peakXMg === null || peakYMg === null || peakZMg === null) return null;

  // Same predicates as impact_events_peak_after_onset / _dur_nonneg / _peak_sane.
  if (tPeakMs < tOnsetMs) return null;
  if (durMs < 0) return null;
  if (peakMg < 0 || peakMg > PEAK_MG_MAX) return null;

  // Optional: a frame without it is still perfectly usable, just not
  // auditable for loss. Never a reason to reject the record.
  const seq = finiteInt(obj.seq);

  return { seq, tOnsetMs, tPeakMs, durMs, peakMg, peakXMg, peakYMg, peakZMg };
}

/**
 * Build the per-connection capture conditions from a hello packet.
 *
 * Returns null when the adapter has no accelerometer, and also when it claims
 * one but omits the detection thresholds. The second case is deliberate: those
 * columns are NOT NULL precisely because a row without them is not comparable
 * to any other row, and substituting the firmware's compile-time defaults
 * would manufacture exactly the false comparability they exist to prevent.
 * Dropping loudly beats storing a plausible fiction.
 *
 * @param hello        the parsed hello object
 * @param hasAccel     resolveHasAccel(hw, hello) from models.ts
 * @param sampleRateHz resolved effective scan rate (timing.samplingHz) — the
 *                     rate the accelerometer was ACTUALLY read at, since
 *                     accel_sample() runs once per matrix frame inside
 *                     scan_task. This is NOT the part's 400 Hz ODR.
 */
export function captureFromHello(
  hello: any,
  hasAccel: boolean,
  sampleRateHz: number | null,
): AccelCapture | null {
  if (!hasAccel) return null;

  const impactOnMg  = finiteInt(hello?.impact_on);
  const impactOffMg = finiteInt(hello?.impact_off);
  if (impactOnMg === null || impactOffMg === null || impactOffMg >= impactOnMg) {
    console.warn(
      "[ACCEL] hello declares an accelerometer but no usable impact_on/impact_off; " +
      "impacts will not be recorded for this connection",
      { impact_on: hello?.impact_on, impact_off: hello?.impact_off },
    );
    return null;
  }

  // FIRMWARE TODO: send_hello() does not yet advertise mg_per_lsb / odr_hz /
  // bw_hz. They stay null rather than being filled from the known constants
  // (100 mg/LSB, ODR 400 Hz, BW 200 Hz) — fw_version is stored per row, so the
  // real values stay recoverable, whereas a backfilled assumption does not
  // announce itself when it is wrong.
  const mgPerLsb = finiteInt(hello?.mg_per_lsb);
  const odrHz    = finiteInt(hello?.odr_hz);
  const bwHz     = finiteInt(hello?.bw_hz);

  // The current firmware samples inside scan_task. When the ADXL372 FIFO drain
  // path lands it MUST advertise {"accel_src":"fifo"} in hello — the app has no
  // other way to tell the two apart, and mislabelled rows are worse than
  // missing ones because they compare cleanly against data they do not match.
  const declaredSrc = hello?.accel_src;
  const sampleSource: AccelSampleSource = declaredSrc === "fifo" ? "fifo" : "scan_loop";

  return {
    present:      true,
    gRangeG:      finiteInt(hello?.g_range) ?? 200,
    hpf:          hello?.hpf !== false,
    impactOnMg,
    impactOffMg,
    mgPerLsb,
    odrHz,
    bwHz,
    sampleRateHz: typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz) && sampleRateHz > 0
      ? +sampleRateHz.toFixed(2)
      : null,
    sampleSource,
    fwVersion:    typeof hello?.fw === "string" ? hello.fw : null,
    hwRev:        typeof hello?.hw === "string" ? hello.hw : null,
    thresholdSource: "firmware",
    thresholdConfirmed: false,
  };
}

/**
 * Build public.impact_events rows for one session.
 *
 * Deduplicates on tOnsetMs, keeping the larger peak. impact_events has a
 * unique index on (session_id, t_onset_ms) — the FSM cannot open two events at
 * the same onset, so a collision means a duplicated BLE record, and the whole
 * chunk insert would fail on it. event_id and rebound_of are left unset; both
 * are resolved in SQL after upload.
 */
export function buildImpactRows(
  sessionId: string,
  impacts: ImpactFrame[],
  capture: AccelCapture | null,
): object[] {
  if (impacts.length === 0) return [];

  // Impacts were detected but there is nothing to stamp them with. That means
  // hello was never seen, or was seen without usable thresholds — the 273-byte
  // hello has been lost to framing bugs before. Say so: these rows are being
  // discarded, and a silent discard here looks identical to an adapter with no
  // accelerometer, which is a different fact entirely.
  if (!capture || !capture.present) {
    console.warn(
      `[ACCEL] discarding ${impacts.length} buffered impact(s) for session ${sessionId}: ` +
      "no capture conditions from hello, so the rows would not be comparable to any other",
    );
    return [];
  }

  const ordered = dedupeImpacts(impacts);

  const missing = countImpactSeqGaps(ordered);
  if (missing > 0) {
    console.warn(
      `[ACCEL] ${missing} impact record(s) lost in transit for session ${sessionId} ` +
      `(${ordered.length} received). Most likely the device tx queue overflowed during ` +
      "a flurry of hits. impact_count for this session is a floor, not a total.",
    );
  }

  return ordered
    .map(i => ({
      session_id:               sessionId,
      impact_seq:               i.seq,
      t_onset_ms:               i.tOnsetMs,
      t_peak_ms:                i.tPeakMs,
      dur_ms:                   i.durMs,
      peak_mg:                  i.peakMg,
      peak_x_mg:                i.peakXMg,
      peak_y_mg:                i.peakYMg,
      peak_z_mg:                i.peakZMg,
      g_range_g:                capture.gRangeG,
      hpf:                      capture.hpf,
      impact_on_mg:             capture.impactOnMg,
      impact_off_mg:            capture.impactOffMg,
      mg_per_lsb:               capture.mgPerLsb,
      odr_hz:                   capture.odrHz,
      bw_hz:                    capture.bwHz,
      sample_rate_hz_effective: capture.sampleRateHz,
      sample_source:            capture.sampleSource,
      fw_version:               capture.fwVersion,
      hw_rev:                   capture.hwRev,
      // azimuth_deg / elevation_deg are generated columns — do not send them.
    }));
}

/**
 * One frame per onset, the larger peak winning, in onset order. A collision
 * means a duplicated BLE record — see buildImpactRows().
 */
export function dedupeImpacts(impacts: ImpactFrame[]): ImpactFrame[] {
  const byOnset = new Map<number, ImpactFrame>();
  for (const i of impacts) {
    const prev = byOnset.get(i.tOnsetMs);
    if (!prev || i.peakMg > prev.peakMg) byOnset.set(i.tOnsetMs, i);
  }
  return [...byOnset.values()].sort((a, b) => a.tOnsetMs - b.tOnsetMs);
}

/**
 * How many impact records the device sent that never arrived.
 *
 * Sums the positive holes between consecutive sequence numbers rather than
 * using (last - first + 1 - count), so a device reset mid-session — which
 * restarts the counter and produces a negative step — reads as zero missing
 * instead of a wild negative. Rows without a seq are skipped entirely.
 *
 * Two losses are invisible by construction and no formula fixes them: a record
 * dropped after the last impact of a session, and one dropped while the app was
 * disconnected. This is a floor on loss, never an exact count.
 */
export function countImpactSeqGaps(ordered: ImpactFrame[]): number {
  const seqs = ordered.map(i => i.seq).filter((s): s is number => s !== null).sort((a, b) => a - b);
  let missing = 0;
  for (let i = 1; i < seqs.length; i++) {
    const hole = seqs[i] - seqs[i - 1] - 1;
    if (hole > 0) missing += hole;
  }
  return missing;
}

/**
 * What happened to the impact frames of one session, from BLE to insert.
 *
 * Without this a session with impact_count NULL could mean any of: nothing
 * crossed the threshold, the frames were malformed, hello was lost so the rows
 * were discarded, or the insert failed — and session ses_1790871892578_t17ff
 * (2026-10-01) could not be told apart from any of them. Each count here rules
 * one of those out.
 *
 * The capture conditions are repeated on purpose. impact_events stamps them on
 * every row, but a session with zero impacts has no rows, and "0 impacts at a
 * 5 g trigger" is a different observation from "0 impacts at 2 g".
 */
export type AccelCaptureDiagnostics = {
  v:                    1;
  frames_received:      number;   // {"type":"impact"} frames seen during the session
  frames_rejected:      number;   // malformed, or would violate a table CHECK
  duplicates_dropped:   number;   // same onset twice — duplicated BLE record
  discarded_no_capture: number;   // valid frames thrown away because hello was unusable
  rows_built:           number;
  rows_inserted:        number;   // < rows_built means the impact_events insert failed
  seq_first:            number | null;
  seq_last:             number | null;
  seq_missing:          number;   // floor — see countImpactSeqGaps()
  capture: {
    impact_on_mg:   number;
    impact_off_mg:  number;
    hpf:            boolean;
    g_range_g:      number;
    sample_rate_hz: number | null;
    sample_source:  AccelSampleSource;
    fw_version:     string | null;
    hw_rev:         string | null;
    threshold_source: AccelCapture["thresholdSource"];
    threshold_confirmed: boolean;
  } | null;
};

// How the impact_events stage of one upload went.
export type ImpactUpload = {
  rowsBuilt:    number;
  rowsInserted: number;
};

/**
 * Build session_summaries.accel_capture. Null for an adapter with no
 * accelerometer that also sent nothing — there is nothing to diagnose, and a
 * diagnostics object on a Model II session would read as an accelerometer
 * that saw nothing.
 */
export function captureDiagnostics(
  impacts: ImpactFrame[],
  rejected: number,
  capture: AccelCapture | null,
  upload: ImpactUpload,
): AccelCaptureDiagnostics | null {
  const present = !!capture?.present;
  if (!present && impacts.length === 0 && rejected === 0) return null;

  const ordered = dedupeImpacts(impacts);
  const seqs    = ordered.map(i => i.seq).filter((s): s is number => s !== null);

  return {
    v:                    1,
    frames_received:      impacts.length + rejected,
    frames_rejected:      rejected,
    duplicates_dropped:   impacts.length - ordered.length,
    discarded_no_capture: present ? 0 : ordered.length,
    rows_built:           upload.rowsBuilt,
    rows_inserted:        upload.rowsInserted,
    seq_first:            seqs.length ? Math.min(...seqs) : null,
    seq_last:             seqs.length ? Math.max(...seqs) : null,
    seq_missing:          countImpactSeqGaps(ordered),
    capture: capture && present ? {
      impact_on_mg:   capture.impactOnMg,
      impact_off_mg:  capture.impactOffMg,
      hpf:            capture.hpf,
      g_range_g:      capture.gRangeG,
      sample_rate_hz: capture.sampleRateHz,
      sample_source:  capture.sampleSource,
      fw_version:     capture.fwVersion,
      hw_rev:         capture.hwRev,
      threshold_source: capture.thresholdSource,
      threshold_confirmed: capture.thresholdConfirmed,
    } : null,
  };
}

/**
 * The session_summaries accel_* fields this client is entitled to assert.
 *
 * accel_present, accel_g_range_g and accel_capture — and that is the point.
 * impact_count, peak_g_mg and mean_impact_g_mg are defined over PRIMARY
 * impacts — rows where rebound_of is null — and nothing has coalesced rebounds
 * at this stage. Writing raw FSM edge counts into those columns would inflate
 * impact_count and deflate mean_impact_g_mg, which is the specific error this
 * design set out to avoid.
 *
 * They stay NULL until processSessionImpacts() runs after upload (which
 * runs mark_impact_rebounds() then rollup_impacts_to_session_summary()). NULL
 * reads as "not measured"; a wrong number does not announce itself at all.
 *
 * accel_present is a fact from hello, not an inference from row count: an
 * adapter with an accelerometer that recorded zero impacts is a real and
 * different observation from an adapter that has none. accel_capture is
 * written even without a usable hello, since impacts arriving with nothing to
 * stamp them with is exactly the case it exists to expose.
 */
export function summarizeImpacts(
  capture: AccelCapture | null,
  diagnostics: AccelCaptureDiagnostics | null = null,
): object {
  return {
    ...(capture ? { accel_present: capture.present, accel_g_range_g: capture.gRangeG } : {}),
    ...(diagnostics ? { accel_capture: diagnostics } : {}),
  };
}

/**
 * Run the SQL impact pipeline for one uploaded session: rebound coalescing,
 * pairing to matrix events, and the events / session_summaries accel rollups
 * (supabase/process_session_impacts.sql).
 *
 * Call it after the LAST insert of the upload — pairing needs the events rows
 * and the summary rollup needs the session_summaries row.
 *
 * Runs whenever hello declared an accelerometer, including with zero impact
 * rows: the rollup then writes impact_count = 0, so NULL is left meaning "not
 * measured" and nothing else (supabase/accel_capture_diagnostics.sql).
 *
 * Skipped when the impact_events insert did not land in full. The rollup would
 * then count only what arrived — a zero, or a partial total — and store it as
 * though it were the session's real count. Leaving the counts NULL is honest;
 * accel_capture.rows_inserted records the shortfall, and the session can be
 * re-run server side with reprocess_session_impacts() once the rows are in.
 *
 * Never throws, for the same reason the impact_events insert does not: the
 * matrix upload is already complete, and the outbox replays from a sessions
 * insert that would now collide. A failure is reported to telemetry.
 */
export async function processSessionImpacts(
  client: SupabaseClient,
  sessionId: string,
  upload: ImpactUpload,
  capture: AccelCapture | null,
): Promise<void> {
  if (upload.rowsInserted < upload.rowsBuilt) return;
  if (upload.rowsBuilt === 0 && !capture?.present) return;
  const { error } = await client.rpc("process_session_impacts", { p_session_id: sessionId });
  if (error) {
    sessionUploadStageFailed({ session_id: sessionId, stage: "impact_processing", error_code: error.message?.slice(0, 64) });
    console.warn(`[ACCEL] process_session_impacts failed, continuing: ${error.message}`);
  }
}
