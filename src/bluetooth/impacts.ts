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

  const byOnset = new Map<number, ImpactFrame>();
  for (const i of impacts) {
    const prev = byOnset.get(i.tOnsetMs);
    if (!prev || i.peakMg > prev.peakMg) byOnset.set(i.tOnsetMs, i);
  }

  const ordered = [...byOnset.values()].sort((a, b) => a.tOnsetMs - b.tOnsetMs);

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
 * The session_summaries accel_* fields this client is entitled to assert.
 *
 * Only two of the five, and that is the point. impact_count, peak_g_mg and
 * mean_impact_g_mg are defined over PRIMARY impacts — rows where rebound_of is
 * null — and nothing has coalesced rebounds at this stage. Writing raw FSM edge
 * counts into those columns would inflate impact_count and deflate
 * mean_impact_g_mg, which is the specific error this design set out to avoid.
 *
 * They stay NULL until rollup_impacts_to_session_summary() runs after
 * mark_impact_rebounds(). NULL reads as "not measured"; a wrong number does
 * not announce itself at all.
 *
 * accel_present is a fact from hello, not an inference from row count: an
 * adapter with an accelerometer that recorded zero impacts is a real and
 * different observation from an adapter that has none.
 */
export function summarizeImpacts(capture: AccelCapture | null): object {
  if (!capture) return {};
  return {
    accel_present:   capture.present,
    accel_g_range_g: capture.gRangeG,
  };
}
