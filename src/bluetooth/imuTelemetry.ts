// src/bluetooth/imuTelemetry.ts
//
// Turns off the TSA-V (Model V) {"type":"imu"} live-readout stream.
//
// Firmware 1.4.x boots with it ON at 10 Hz (s_imu_on / IMU_TELEMETRY_HZ in
// app_main.c) and streams it for the whole connection, session or not. The app
// never consumes it — impacts.ts ingests {"type":"impact"} only — so every one
// of those notifies is radio airtime and battery spent for nothing. Impact
// detection is unaffected: "on" gates send_imu() alone, not the ADXL372 sampling
// or the impact FSM.
//
// The flag is RAM-only on the bag, so it resets to ON at every boot. Send this
// after each hello, not once per install. Best-effort, like sendLedColor: a
// failed write only costs the battery saving.
//
// If a live g-force readout is ever added, turn the stream back on while that
// view is visible: {"cmd":"imu","on":true,"hz":N}.

import { writeUtf8, type AdapterConnection } from "./adapter";

export async function muteImuTelemetry(conn: AdapterConnection | null, rxUuid: string) {
  if (!conn) return;
  try {
    await writeUtf8(conn, rxUuid, JSON.stringify({ cmd: "imu", on: false }));
  } catch (err) {
    console.warn("[BLE] muteImuTelemetry failed:", err);
  }
}
