// src/bluetooth/imuTelemetry.ts
//
// Sends the per-connection {"cmd":"imu",...} config to a TSA-V (Model V):
// turns off the {"type":"imu"} live-readout stream and, in dev builds only,
// overrides the impact detection thresholds.
//
// MUTING THE STREAM
// Firmware 1.4.x boots with it ON at 10 Hz (s_imu_on / IMU_TELEMETRY_HZ in
// app_main.c) and streams it for the whole connection, session or not. The app
// never consumes it — impacts.ts ingests {"type":"impact"} only — so every one
// of those notifies is radio airtime and battery spent for nothing. Impact
// detection is unaffected: "on" gates send_imu() alone, not the ADXL372 sampling
// or the impact FSM.
//
// If a live g-force readout is ever added, turn the stream back on while that
// view is visible: {"cmd":"imu","on":true,"hz":N}.
//
// DEV THRESHOLD OVERRIDE
// The firmware triggers an impact at 5 g and releases at 3 g (IMPACT_ON_MG /
// IMPACT_OFF_MG). In-bag strikes on 2026-10-03 (ses_1791039002747_357lo) put
// 3 of 13 pad contacts over that line, all within 1 g of it — the trigger is
// truncating the distribution. Rather than ship firmware to find the right
// number, a dev build can set it over BLE:
//
//   .env.local   VITE_ACCEL_THRESH_MG=2500
//                VITE_ACCEL_RELEASE_MG=1500   (optional; default 60 % of thresh,
//                                              the firmware's own 3000/5000 ratio)
//
// Gated on import.meta.env.DEV so a stray variable in a deployed environment
// can never change detection for real users. Once a value is settled it
// belongs in the firmware defaults, where hello reports it without help.
//
// Both settings are RAM-only on the bag and reset at every boot, so this is
// sent after each hello, not once per install. Best-effort, like sendLedColor:
// a failed write costs the battery saving and leaves the firmware thresholds
// in force — and the capture conditions stay the ones hello reported, because
// they are only rewritten after the write succeeds.
//
// CONFIRMATION (fw >= 1.4.6-c)
// The device answers every {"cmd":"imu"} with
//   {"type":"imu_cfg","on":bool,"hz":N,"hpf":bool,"thresh":mg,"release":mg}
// carrying the values actually in force after its own validation. That reply,
// not the write succeeding, is what the capture conditions should record:
// a refused value, or a write that resolved after a second hello, would
// otherwise be stored as though detection had run under it. applyImuCfg()
// handles it. Older firmware never replies, so the write-success path below
// stays as the fallback and marks the thresholds unconfirmed.

import { writeUtf8, type AdapterConnection } from "./adapter";
import type { AccelCapture } from "./impacts";

export type ImpactThreshold = { onMg: number; offMg: number };

// Bounds for the override. Below ~1 g the ~220 mg/axis noise floor and a
// swinging bag trigger constantly; above 50 g nothing a person throws reaches
// it. Out of range is ignored loudly, not clamped — a clamped value would
// silently test something other than what was asked for.
const THRESH_MIN_MG = 1000;
const THRESH_MAX_MG = 50000;

function readEnvInt(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * The dev threshold override, or null when unset, not a dev build, or invalid.
 * Exported for tests; call sites go through configureImu().
 */
export function devImpactThreshold(env: Record<string, unknown> = import.meta.env): ImpactThreshold | null {
  if (!env.DEV) return null;
  const onMg = readEnvInt(env.VITE_ACCEL_THRESH_MG);
  if (onMg === null) return null;
  const offRaw = readEnvInt(env.VITE_ACCEL_RELEASE_MG);
  const offMg = offRaw === null ? Math.round(onMg * 0.6) : offRaw;

  if (Number.isNaN(onMg) || Number.isNaN(offMg)
      || onMg < THRESH_MIN_MG || onMg > THRESH_MAX_MG
      || offMg <= 0 || offMg >= onMg) {
    console.warn(
      `[ACCEL] ignoring dev threshold override: need ${THRESH_MIN_MG} <= VITE_ACCEL_THRESH_MG <= ${THRESH_MAX_MG} ` +
      "and 0 < VITE_ACCEL_RELEASE_MG < VITE_ACCEL_THRESH_MG",
      { VITE_ACCEL_THRESH_MG: env.VITE_ACCEL_THRESH_MG, VITE_ACCEL_RELEASE_MG: env.VITE_ACCEL_RELEASE_MG },
    );
    return null;
  }
  return { onMg, offMg };
}

/**
 * Mute the imu stream and apply the dev threshold override, in one write.
 *
 * Returns the capture conditions to use from here on when the override was
 * applied, or null when nothing changed (no override, no capture to update, or
 * the write failed). The caller should only swap it in if its capture is still
 * the one it passed — a reconnect may have replaced it in the meantime.
 */
export async function configureImu(
  conn: AdapterConnection | null,
  rxUuid: string,
  capture: AccelCapture | null,
): Promise<AccelCapture | null> {
  if (!conn) return null;
  const override = devImpactThreshold();
  const cmd = override
    ? { cmd: "imu", on: false, thresh: override.onMg, release: override.offMg }
    : { cmd: "imu", on: false };
  try {
    await writeUtf8(conn, rxUuid, JSON.stringify(cmd));
  } catch (err) {
    console.warn("[BLE] configureImu failed:", err);
    return null;
  }
  if (!override) return null;
  console.log(`[ACCEL] dev threshold override applied: on=${override.onMg} mg off=${override.offMg} mg`);
  if (!capture) return null;
  return {
    ...capture,
    impactOnMg:         override.onMg,
    impactOffMg:        override.offMg,
    thresholdSource:    "dev_override",
    thresholdConfirmed: false,
  };
}

function finiteInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Parse an {"type":"imu_cfg"} reply into the thresholds the device confirmed,
 * or null if it is not one or is unusable.
 */
export function parseImuCfg(obj: any): ImpactThreshold | null {
  if (!obj || obj.type !== "imu_cfg") return null;
  const onMg  = finiteInt(obj.thresh);
  const offMg = finiteInt(obj.release);
  // The firmware guarantees 0 <= release < thresh; anything else is a corrupt
  // frame, and a corrupt frame must not overwrite good capture conditions.
  if (onMg === null || offMg === null || onMg <= 0 || offMg < 0 || offMg >= onMg) {
    console.warn("[ACCEL] ignoring malformed imu_cfg", obj);
    return null;
  }
  return { onMg, offMg };
}

/**
 * The capture conditions after an imu_cfg reply: the device's thresholds,
 * marked confirmed. Returns null when there is nothing to update — not an
 * imu_cfg frame, a malformed one, or no capture (adapter without usable hello).
 *
 * Safe to apply whenever it arrives. It may land before or after configureImu()
 * resolves; configureImu's caller only swaps in its own result if the capture
 * is still the one it sent, so a reply that got there first is never
 * overwritten by the unconfirmed assumption.
 */
export function applyImuCfg(capture: AccelCapture | null, obj: any): AccelCapture | null {
  const cfg = parseImuCfg(obj);
  if (!cfg || !capture) return null;

  const override = devImpactThreshold();
  const isOverride = !!override && cfg.onMg === override.onMg && cfg.offMg === override.offMg;
  if (override && !isOverride) {
    console.warn(
      `[ACCEL] device did not take the dev threshold override: asked on=${override.onMg} off=${override.offMg} mg, ` +
      `device reports on=${cfg.onMg} off=${cfg.offMg} mg. Recording the device's values.`,
    );
  } else {
    console.log(`[ACCEL] device confirmed thresholds on=${cfg.onMg} mg off=${cfg.offMg} mg`);
  }

  return {
    ...capture,
    impactOnMg:         cfg.onMg,
    impactOffMg:        cfg.offMg,
    thresholdSource:    isOverride ? "dev_override" : "firmware",
    thresholdConfirmed: true,
  };
}
