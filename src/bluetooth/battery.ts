// src/bluetooth/battery.ts
//
// Bag battery level — protocol parsing and alert thresholds, shared by the
// desktop session page, the mobile session page and mobile home.
//
// Wire format (TSA-V firmware 1.4.4-c and later):
//   hello:  {"type":"hello", ..., "batt_mv":3912, "batt_pct":64}
//   batt:   {"type":"batt", "t":<ms>, "batt_mv":3912, "batt_pct":64}   every 30 s
// Both fields are null when the firmware sees no cell on J3.3 (e.g. a bench
// board running from USB), or when J3.3 reads above 4.35 V — a wiring fault
// (J3.3 on the charge module's 5 V OUT instead of B+), never "100 %".
// Firmware already filters and applies ±2 % hysteresis, so the app displays
// the value as-is.
//
// The percentage is a voltage-curve estimate from a 1S LiPo, not coulomb
// counting: good for "about half" and "charge it soon", not a precise gauge.

// Warn at or below this. Critical is a second, louder tier that re-raises a
// warning the coach already dismissed at the "low" tier.
export const BATT_LOW_PCT      = 15;
export const BATT_CRITICAL_PCT = 5;

// Extract the battery percentage from a hello or batt frame.
//   undefined → the frame carries no battery field (older firmware, or a frame
//               type that never does) — leave the current reading alone.
//   null      → the device explicitly reports "unknown" — clear the reading.
//   number    → 0–100.
// `batt_pct` is the shipped key; the others were accepted by mobile home before
// any firmware reported battery and are kept so nothing that relied on them
// regresses.
export function parseBatteryPct(obj: any): number | null | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const keys = ["batt_pct", "battery_pct", "batt", "battery", "soc"];
  const key = keys.find(k => k in obj);
  if (key === undefined) return undefined;
  const raw = obj[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Badge tone: green ≥ 50, amber 20–49, red < 20. `rgb` is the neon used on
// dark backgrounds, `ink` the darker variant that stays legible on white.
export function batteryTone(pct: number): { rgb: string; ink: string } {
  if (pct >= 50) return { rgb: "0,255,136", ink: "#00965a" };
  if (pct >= 20) return { rgb: "255,200,0", ink: "#a67c00" };
  return { rgb: "255,68,68", ink: "#c0392b" };
}

export type BattAlertLevel = "low" | "critical";

export function battAlertLevel(pct: number | null | undefined): BattAlertLevel | null {
  if (pct == null) return null;
  if (pct <= BATT_CRITICAL_PCT) return "critical";
  if (pct <= BATT_LOW_PCT) return "low";
  return null;
}

export type BattBag   = { key: string; label: string; pct: number | null | undefined };
export type BattAlert = { key: string; label: string; pct: number; level: BattAlertLevel };

// Bags that should currently show a low-battery warning. `dismissed` maps a bag
// key to the level the coach dismissed; a bag reappears only when it drops to a
// more severe level than the one dismissed (low → critical).
export function lowBatteryAlerts(
  bags: BattBag[],
  dismissed: Record<string, BattAlertLevel>,
): BattAlert[] {
  const out: BattAlert[] = [];
  for (const b of bags) {
    const level = battAlertLevel(b.pct);
    if (!level) continue;
    const d = dismissed[b.key];
    if (d === level || (d === "critical" && level === "low")) continue;
    out.push({ key: b.key, label: b.label, pct: b.pct as number, level });
  }
  return out;
}
