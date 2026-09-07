// src/bluetooth/models.ts
//
// Single source of truth for per-adapter hardware facts, keyed by the `hw`
// string a device reports in its BLE hello packet.
//
// This lived inline in src/pages/mobile/home.tsx and in an older, II/III-only
// form in src/pages/session.tsx and src/pages/mobile/session.tsx. Each new
// adapter generation had to be added in three places and in practice wasn't —
// both session pages still resolved every non-III device to Model II timing,
// so a IV or V board silently ran with 37 ms / 25 Hz constants. Adding a model
// here now updates all three call sites at once.
//
// The `hw` keys must match the manifest keys in public/firmware/manifest.json,
// which must in turn match what the firmware reports — a mismatch silently
// disables OTA for that device.

export type ScanTiming = { scanPeriodMs: number; samplingHz: number };

// Per-adapter scan timing. scanPeriodMs doubles as the SI rise-time floor — a
// contact can't be resolved faster than one scan cycle — and samplingHz is
// persisted with each session.
//   II  @ 80 MHz  MicroPython         → 37 ms (~27 Hz)
//   III @ 160 MHz MicroPython (batch) → 8 ms  (~120 Hz)
//   IV  @ native C, free-running scan → 2.5 ms (~400 Hz nominal)
//        SCAN_HZ_NOMINAL=400 in app_main.c; verified ~437 Hz on hardware. The
//        native-C firmware also reports its live measured rate in the hello
//        "hz" field, so resolveScanTiming() prefers that over the nominal.
//        (BLE still flushes in batch mode on a 40 ms esp_timer; the scan loop
//         runs flat-out on a dedicated core.)
//   V   @ native C, same scan core as IV → 2.5 ms (~400 Hz nominal)
//        Rev C board; measured ~332 Hz on the first unit, so the live "hz"
//        field matters more here than on IV.
export const SCAN_PROFILES: Record<string, ScanTiming> = {
  "II":  { scanPeriodMs: 37,  samplingHz: 25  },
  "III": { scanPeriodMs: 8,   samplingHz: 120 },
  "IV":  { scanPeriodMs: 2.5, samplingHz: 400 },
  "V":   { scanPeriodMs: 2.5, samplingHz: 400 },
};

// Safe fallback before any hello has been received.
export const SCAN_PERIOD_MS_DEFAULT = 37;

// Resolve a scan profile for a hw string; unknown/missing hw falls back to Model II.
export function scanProfileFor(hw: string | undefined | null): ScanTiming {
  return SCAN_PROFILES[hw ?? ""] ?? SCAN_PROFILES["II"];
}

// Resolve per-device scan timing. If the hello carries a live measured "hz"
// field (native-C firmware), use it for samplingHz / scanPeriodMs; otherwise
// fall back to the adapter's nominal profile. The SI ceiling stays fixed
// (SI_FASTEST_SCAN_HZ) for cross-device comparability — only the per-device
// rise-time floor adapts here.
export function resolveScanTiming(hw: string | undefined | null, hz?: unknown): ScanTiming {
  const base = scanProfileFor(hw);
  if (typeof hz === "number" && Number.isFinite(hz) && hz > 0) {
    return { samplingHz: hz, scanPeriodMs: +(1000 / hz).toFixed(3) };
  }
  return base;
}

// device_model string persisted with each session ("TSII" … "TSV").
export function deviceModelFor(hw: string | undefined | null): string {
  return "TS" + (hw ?? "II");
}

// ─── Per-model hardware capabilities ─────────────────────────────────────────

// Model V is the first board to fit the ADXL372 accelerometer (Rev C silicon;
// /CS_ACCEL on GPIO17). II / III / IV have none.
export const MODELS_WITH_ACCEL = new Set(["V"]);

// Hardware presence only. Build B firmware does not read the ADXL372 yet, so a
// V device reports no accelerometer data until that lands — gate any UI that
// renders accel values on actual data arriving, not on this flag alone.
export function hasAccelFor(hw: string | undefined | null): boolean {
  return MODELS_WITH_ACCEL.has(hw ?? "");
}

// Native-C models (IV, V) drain a 16-deep command queue every 10 ms into a
// 512 B buffer, so they tolerate the FAST OTA write profile. II / III are
// MicroPython and stay on the conservative SLOW profile.
export const NATIVE_C_MODELS = new Set(["IV", "V"]);
export function isNativeCFor(hw: string | undefined | null): boolean {
  return NATIVE_C_MODELS.has(hw ?? "");
}

// ─── Handshake capability resolution ─────────────────────────────────────────
//
// Prefer what the firmware declares over what this table assumes, so a firmware
// that starts reporting the ADXL372 is believed without an app release — and a
// board that ships without the part fitted can say so. Accepted hello shapes:
//
//   {"type":"hello", ..., "accel":true}            explicit boolean
//   {"type":"hello", ..., "accel":"adxl372"}       part name (truthy string)
//   {"type":"hello", ..., "caps":["accel", ...]}   capability list
//
// Anything else (including a plain hello from current Build B firmware) falls
// back to the per-model table above.
export function resolveHasAccel(hw: string | undefined | null, hello?: any): boolean {
  const declared = hello?.accel;
  if (typeof declared === "boolean") return declared;
  if (typeof declared === "string")  return declared.trim() !== "" && declared !== "0" && declared !== "false";
  if (typeof declared === "object" && declared !== null) return true;   // e.g. {"accel":{"part":"adxl372"}}

  const caps = hello?.caps ?? hello?.features;
  if (Array.isArray(caps)) {
    return caps.some(c => typeof c === "string" && c.toLowerCase().startsWith("accel"));
  }
  return hasAccelFor(hw);
}

// ─── UI badge ────────────────────────────────────────────────────────────────
// Per-model accent for the hardware-generation chip. IV (native C) gets its own
// cyan accent to stand apart from the green III; V takes amber.
export type ModelBadge = { rgb: string; ink: string; label: string };

export function modelBadge(hw: string | undefined | null, samplingHz?: number): ModelBadge {
  const hz = typeof samplingHz === "number" && Number.isFinite(samplingHz) && samplingHz > 0
    ? Math.round(samplingHz)
    : null;
  switch (hw) {
    case "V":
      return { rgb: "255,170,0", ink: "#a86a00", label: `V · ${hz ?? 400}Hz` };
    case "IV":
      return { rgb: "0,224,255", ink: "#0091b3", label: `IV · ${hz ?? 400}Hz` };
    case "III":
      return { rgb: "0,255,136", ink: "#00965a", label: "III · 120Hz" };
    default:
      return { rgb: "180,0,255", ink: "#8a00c2", label: "II · 27Hz" };
  }
}
