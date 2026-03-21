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

export async function scanForDevices(opts: {
  durationMs?: number;
  onUpdate: (devices: ScannedDevice[]) => void;
}): Promise<ScannedDevice[]> {
  await ensureInit();

  const { durationMs = 5000, onUpdate } = opts;
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
// Falls back through three requestDevice strategies in order of precision.

export async function connectToAdapterNative(args: {
  serviceUuid: string;
  namePrefix: string;
  onDisconnect?: () => void;
}): Promise<NativeAdapterConnection> {
  await ensureInit();

  const prefix    = args.namePrefix.trim();
  const hasPrefix = prefix.length > 0;
  let dev: BleDevice | null = null;

  // Attempt 1: serviceUuid + namePrefix (most precise — clean picker)
  if (hasPrefix) {
    try {
      dev = await BleClient.requestDevice({
        services: [args.serviceUuid],
        namePrefix: prefix,
        optionalServices: [args.serviceUuid],
        scanMode: ScanMode.LOW_LATENCY,
      } as any);
    } catch (e: any) {
      if (isUserCancel(e?.message ?? "")) throw e;
    }
  }

  // Attempt 2: serviceUuid only (brand-new / never-paired devices)
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

  // Attempt 3: namePrefix only (old firmware, UUID not in adv payload)
  if (!dev) {
    const opts: any = {
      optionalServices: [args.serviceUuid],
      scanMode: ScanMode.LOW_LATENCY,
    };
    if (hasPrefix) opts.namePrefix = prefix;
    dev = await BleClient.requestDevice(opts);
  }

  await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());

  return {
    kind: "native",
    name: dev.name ?? dev.deviceId,
    deviceId: dev.deviceId,
    serviceUuid: args.serviceUuid,
  };
}

function isUserCancel(msg: string): boolean {
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