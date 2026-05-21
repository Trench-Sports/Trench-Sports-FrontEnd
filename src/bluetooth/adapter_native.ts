// src/bluetooth/adapter_native.ts
import { BleClient, ScanMode, type BleDevice, type ScanResult } from "@capacitor-community/bluetooth-le";

export type NativeAdapterConnection = {
  kind: "native";
  name: string;
  deviceId: string;
  serviceUuid: string;
};

// A scanned device surfaced to the UI picker
export type ScannedDevice = {
  deviceId: string;
  name: string;       // display name — falls back to deviceId if adv name absent
  rssi: number | null;
};

let initPromise: Promise<void> | null = null;

async function ensureInit() {
  if (!initPromise) {
    initPromise = BleClient.initialize({
      // On Android 12+ (API 31+) BLUETOOTH_SCAN replaces the location permission.
      // Setting this prevents the plugin from requesting location unnecessarily.
      // Safe no-op on iOS.
      androidNeverForLocation: true,
    });
  }
  await initPromise;
}

// ── Env-driven name-prefix helpers ────────────────────────────────────────────
//
// VITE_BLE_NAME_PREFIX        — primary / new-device prefix    (default: "TS")
// VITE_BLE_NAME_PREFIX_LEGACY — returning / paired prefix      (default: "MPY")
//
// Both are read at call-time so they work with import.meta.env tree-shaking.

export function getBleNamePrefixes(): { primary: string; legacy: string; all: string[] } {
  const primary = (import.meta.env.VITE_BLE_NAME_PREFIX        as string | undefined)?.trim() || "TS";
  const legacy  = (import.meta.env.VITE_BLE_NAME_PREFIX_LEGACY as string | undefined)?.trim() || "MPY";
  return { primary, legacy, all: [primary, legacy] };
}

/**
 * Classify a scanned device name by its BLE advertised prefix.
 *
 *   "ts"    → new / first-time device  (matches VITE_BLE_NAME_PREFIX,        default "TS")
 *   "mpy"   → returning / previously paired (matches VITE_BLE_NAME_PREFIX_LEGACY, default "MPY")
 *   "other" → unrecognised — should not appear in a filtered scan but handled defensively
 *
 * Called immediately after the user picks a device so the connection flow can
 * branch:  "ts" → first-time setup path,  "mpy" → direct reconnect path.
 */
export function classifyDevice(name: string): "ts" | "mpy" | "other" {
  const { primary, legacy } = getBleNamePrefixes();
  if (name.startsWith(primary)) return "ts";
  if (name.startsWith(legacy))  return "mpy";
  return "other";
}

function bytesToDataView(u8: Uint8Array) {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

// ── scanForDevices ────────────────────────────────────────────────────────────
//
// Runs a BLE scan for `durationMs` and calls `onUpdate` each time a new device
// is found or an RSSI update arrives for a known device. The caller renders the
// live list; the user picks one; the caller passes it to connectToDeviceNative.
//
// Why scan instead of requestDevice?
//   requestDevice() delegates filtering to the OS picker, which relies on the
//   OS name-cache. Brand-new devices with no cached name are silently excluded.
//   Scanning ourselves gives us every raw advertisement packet so we can show
//   ALL nearby BLE devices (or filter client-side) regardless of cache state.
//
// Scan strategy:
//   - ScanMode.LOW_LATENCY for fast discovery (acceptable battery cost for a
//     short manual scan).
//   - No service-UUID filter in the scan call — we collect everything and let
//     the UI label TS bags distinctly. This also catches old firmware units
//     whose adv payload pre-dates the UUID inclusion.
//   - Deduplication is by deviceId; RSSI is updated on repeat sightings.
//
// Prefix filtering:
//   Pass `namePrefixes: getBleNamePrefixes().all` (or a custom array) to limit
//   results to known bag prefixes — both "TS" (new) and "MPY" (returning).

export async function scanForDevices(opts: {
  durationMs?: number;
  // When provided, only devices whose resolved name starts with one of these
  // prefixes (case-insensitive) are surfaced to the caller.
  // Devices whose name falls back to their deviceId are always excluded when
  // a filter is active (they have no meaningful advertised name).
  namePrefixes?: string[];
  // Multi-bag: skip devices that are already connected to this app.
  // The caller passes the deviceIds of the primary connection + every active
  // slot.conn so the picker can't surface a bag the user has already paired.
  // Matched case-insensitively against scan.deviceId.
  excludeDeviceIds?: string[];
  onUpdate: (devices: ScannedDevice[]) => void;
}): Promise<ScannedDevice[]> {
  await ensureInit();

  const { durationMs = 5000, namePrefixes, excludeDeviceIds, onUpdate } = opts;

  // Normalise prefixes once so the hot callback path is cheap
  const prefixes = namePrefixes?.map(p => p.toLowerCase()) ?? [];
  const hasFilter = prefixes.length > 0;

  // Pre-normalise excludes to a Set for O(1) lookup in the hot path.
  const excludes = new Set<string>(
    (excludeDeviceIds ?? [])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map(id => id.toLowerCase())
  );

  function matchesFilter(name: string, id: string): boolean {
    if (hasFilter) {
      // Exclude devices that never advertised a real name
      if (name === id) return false;
      const lower = name.toLowerCase();
      if (!prefixes.some(p => lower.startsWith(p))) return false;
    }
    if (excludes.size > 0 && excludes.has(id.toLowerCase())) return false;
    return true;
  }

  const seen = new Map<string, ScannedDevice>();

  const emit = () => onUpdate(Array.from(seen.values()));

  await BleClient.requestLEScan(
    { scanMode: ScanMode.LOW_LATENCY },
    (result: ScanResult) => {
      const id   = result.device.deviceId;
      const name = result.device.name?.trim() ||
                   result.localName?.trim()   ||
                   id;
      const rssi = result.rssi ?? null;

      if (!matchesFilter(name, id)) return;

      const existing = seen.get(id);
      if (!existing || existing.rssi !== rssi || existing.name !== name) {
        seen.set(id, { deviceId: id, name, rssi });
        emit();
      }
    },
  );

  // Stop scan after the requested duration
  await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  await BleClient.stopLEScan();

  return Array.from(seen.values());
}

// Aborts an in-progress scan early (e.g. user cancelled the picker)
export async function stopScan() {
  try {
    await BleClient.stopLEScan();
  } catch {
    // already stopped — safe to ignore
  }
}

// ── connectToDeviceNative ─────────────────────────────────────────────────────
//
// Connects directly to a device the user picked from the scan list.
// Skips requestDevice entirely — no OS picker, no name-cache dependency.
//
// The caller should check classifyDevice(device.name) before calling this to
// decide whether to show first-time setup UI ("ts") or reconnect UI ("mpy").

export async function connectToDeviceNative(opts: {
  device: ScannedDevice;
  serviceUuid: string;
  onDisconnect?: () => void;
}): Promise<NativeAdapterConnection> {
  await ensureInit();

  await BleClient.connect(opts.device.deviceId, () => opts.onDisconnect?.());

  return {
    kind: "native",
    name: opts.device.name,
    deviceId: opts.device.deviceId,
    serviceUuid: opts.serviceUuid,
  };
}

// ── connectToAdapterNative (legacy path — kept for web fallback parity) ───────
//
// Used by connectToAdapter() in adapter.ts when a scan+pick flow is not desired.
// Falls back through strategies in order of precision.
//
// Now accepts both a primary and legacy prefix so returning MPY devices are
// reachable on the web Bluetooth path as well as brand-new TS devices.

export async function connectToAdapterNative(args: {
  serviceUuid: string;
  namePrefix?: string;    // kept for backward compat — single prefix
  namePrefixes?: string[]; // preferred: try each prefix in order
  onDisconnect?: () => void;
}): Promise<NativeAdapterConnection> {
  await ensureInit();

  // Build the ordered list of prefixes to try.
  // If neither is provided, fall back to env-driven defaults.
  const prefixList: string[] = args.namePrefixes
    ?? (args.namePrefix ? [args.namePrefix] : getBleNamePrefixes().all);

  let dev: BleDevice | null = null;

  // Attempt 1: serviceUuid + namePrefix for each known prefix (most precise)
  for (const prefix of prefixList) {
    if (dev) break;
    const p = prefix.trim();
    if (!p) continue;
    try {
      dev = await BleClient.requestDevice({
        services: [args.serviceUuid],
        namePrefix: p,
        optionalServices: [args.serviceUuid],
        scanMode: ScanMode.LOW_LATENCY,
      } as any);
    } catch (e: any) {
      if (isUserCancel(e?.message ?? "")) throw e;
    }
  }

  // Attempt 2: serviceUuid only (brand-new / never-paired devices, or firmware
  // whose adv payload does not include the prefix yet)
  if (!dev) {
    try {
      dev = await BleClient.requestDevice({
        services: [args.serviceUuid],
        optionalServices: [args.serviceUuid],
        scanMode: ScanMode.LOW_LATENCY,
      } as any);
    } catch (e: any) {
      if (isUserCancel(e?.message ?? "")) throw e;
    }
  }

  // Attempt 3: namePrefix only (old firmware, UUID not in adv payload) —
  // try each prefix in order, widening to no-filter if all fail
  if (!dev) {
    for (const prefix of [...prefixList, ""]) {
      const p = prefix.trim();
      const opts: any = { optionalServices: [args.serviceUuid], scanMode: ScanMode.LOW_LATENCY };
      if (p) opts.namePrefix = p;
      try {
        dev = await BleClient.requestDevice(opts);
        if (dev) break;
      } catch (e: any) {
        if (isUserCancel(e?.message ?? "")) throw e;
      }
    }
  }

  if (!dev) throw new Error("No device selected");

  await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());

  return {
    kind: "native",
    name: dev.name ?? dev.deviceId,
    deviceId: dev.deviceId,
    serviceUuid: args.serviceUuid,
  };
}

export function isUserCancel(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("cancel")        ||
    m.includes("user denied")   ||
    m.includes("user cancelled")||
    m.includes("chooser")
  );
}

export async function disconnectNative(conn: NativeAdapterConnection | null) {
  if (!conn) return;
  await ensureInit();
  await BleClient.disconnect(conn.deviceId);
}

export async function startNotificationsNative(
  conn: NativeAdapterConnection,
  characteristicUuid: string,
  onValue: (dv: DataView) => void,
) {
  await ensureInit();

  await BleClient.startNotifications(
    conn.deviceId,
    conn.serviceUuid,
    characteristicUuid,
    onValue,
  );

  return {
    kind: "native",
    deviceId: conn.deviceId,
    service: conn.serviceUuid,
    characteristic: characteristicUuid,
  };
}

export async function writeUtf8Native(
  conn: NativeAdapterConnection,
  characteristicUuid: string,
  text: string,
) {
  await ensureInit();

  const u8 = new TextEncoder().encode(text);
  const dv = bytesToDataView(u8);

  await BleClient.write(conn.deviceId, conn.serviceUuid, characteristicUuid, dv);
}