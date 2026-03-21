// src/bluetooth/adapter_native.ts
import { BleClient, ScanMode, type BleDevice } from "@capacitor-community/bluetooth-le";

export type NativeAdapterConnection = {
  kind: "native";
  name: string;
  deviceId: string;
  serviceUuid: string;
};

let initPromise: Promise<void> | null = null;

async function ensureInit() {
  if (!initPromise) {
    initPromise = BleClient.initialize({
      // androidNeverForLocation: on Android 12+ (API 31+) BLUETOOTH_SCAN
      // replaces the location permission — set this so the plugin doesn't
      // request location unnecessarily. Safe no-op on iOS.
      androidNeverForLocation: true,
    });
  }
  await initPromise;
}

function bytesToDataView(u8: Uint8Array) {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

// ── Filtering strategy ──────────────────────────────────────────────────────
//
// Root cause of "new devices not found" on native (iOS/Android via Capacitor):
//
// The old code used namePrefix as the primary filter. On native platforms this
// is matched against the OS-cached name from a prior scan or pairing. A device
// that has never been seen by this phone has no cached name, so it is excluded
// even when it is advertising right next to the phone.
//
// Additionally, on iOS namePrefix matching is case-sensitive and requires the
// OS to have decoded the "Complete Local Name" AD structure in a prior scan —
// which doesn't happen reliably in BALANCED scan mode.
//
// Fixes applied:
//
//   1. ScanMode.LOW_LATENCY on Android ensures the radio scans aggressively
//      so the OS name cache is populated before the picker evaluates namePrefix.
//      iOS ignores ScanMode but it's harmless to set it.
//
//   2. Primary filter is now serviceUuid only (attempt 2 below).
//      The NUS UUID is included in the ESP32's adv payload as AD type 0x07
//      (Complete list of 128-bit UUIDs) in the current main.py, so it is
//      present in every live advertisement packet regardless of OS caching.
//
//   3. Attempt 1 (serviceUuid + namePrefix) still runs first when a prefix
//      is available — it keeps the picker clean by excluding unrelated NUS
//      peripherals (dev boards, etc.) on phones where the name IS cached.
//
//   4. Attempt 3 (namePrefix only) is a last-resort for old-firmware units
//      that pre-date the UUID-in-adv-payload change but have a cached name.
//
// All attempts pass optionalServices so GATT service discovery succeeds
// regardless of which filter matched.

export async function connectToAdapterNative(args: {
  serviceUuid: string;
  namePrefix: string;
  onDisconnect?: () => void;
}): Promise<NativeAdapterConnection> {
  await ensureInit();

  const prefix = args.namePrefix.trim();
  const hasPrefix = prefix.length > 0;

  let dev: BleDevice | null = null;

  // ── Attempt 1: serviceUuid + namePrefix ─────────────────────────────────────
  // Most precise — only shows TS bags in the picker. Works when the OS has a
  // cached name for the device (previously paired or scanned on this phone).
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
      // Name not cached yet — fall through to UUID-only.
    }
  }

  // ── Attempt 2: serviceUuid only ─────────────────────────────────────────────
  // Finds brand-new / never-paired devices. Relies on the NUS UUID being
  // present in the live advertisement packet (current main.py includes it).
  if (!dev) {
    try {
      dev = await BleClient.requestDevice({
        services: [args.serviceUuid],
        optionalServices: [args.serviceUuid],
        scanMode: ScanMode.LOW_LATENCY,
      } as any);
    } catch (e: any) {
      if (isUserCancel(e?.message ?? "")) throw e;
      // Fall through to name-only last resort.
    }
  }

  // ── Attempt 3: namePrefix only ──────────────────────────────────────────────
  // Catches old-firmware units whose adv payload pre-dates the UUID inclusion
  // but whose name is already cached by the OS.
  if (!dev) {
    const opts: any = {
      optionalServices: [args.serviceUuid],
      scanMode: ScanMode.LOW_LATENCY,
    };
    if (hasPrefix) opts.namePrefix = prefix;
    // Let any error (including user cancel) propagate — all fallbacks exhausted.
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
    m.includes("cancel") ||
    m.includes("user denied") ||
    m.includes("user cancelled") ||
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
  onValue: (dv: DataView) => void
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