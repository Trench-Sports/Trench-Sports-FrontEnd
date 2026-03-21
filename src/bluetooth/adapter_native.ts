// src/bluetooth/adapter_native.ts
import { BleClient, type BleDevice } from "@capacitor-community/bluetooth-le";

export type NativeAdapterConnection = {
  kind: "native";
  name: string;
  deviceId: string;
  serviceUuid: string;
};

let initPromise: Promise<void> | null = null;

async function ensureInit() {
  if (!initPromise) initPromise = BleClient.initialize();
  await initPromise;
}

function bytesToDataView(u8: Uint8Array) {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

export async function connectToAdapterNative(args: {
  serviceUuid: string;
  namePrefix: string;
  onDisconnect?: () => void;
}): Promise<NativeAdapterConnection> {
  await ensureInit();

  // ── Capacitor BLE filter API ──────────────────────────────────────────────
  // BleClient.requestDevice() takes FLAT options — namePrefix and
  // optionalServices as direct keys. A top-level `filters` array (Web
  // Bluetooth style) is silently ignored by the plugin, which is why an
  // earlier attempt showed every nearby BLE device.
  //
  // We try two namePrefix passes so a single picker covers both name schemes:
  //   1. "TS"  — current firmware (boot.py sets device name to TS-001 etc.)
  //   2. "MPY" — legacy units whose OS-cached name is the MicroPython default
  //
  // Cancellation is detected and re-thrown immediately at pass 1 so we never
  // open a second picker if the user dismissed the first.

  const isCancel = (e: any) => {
    const msg = (e?.message ?? "").toLowerCase();
    return msg.includes("cancel") || msg.includes("user denied") || msg.includes("user gesture");
  };

  // Pass 1 — "TS-*" devices (updated firmware)
  try {
    const dev = await BleClient.requestDevice({
      namePrefix: args.namePrefix.trim() || "TS",
      optionalServices: [args.serviceUuid],
    } as any);
    await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());
    return { kind: "native", name: dev.name ?? dev.deviceId, deviceId: dev.deviceId, serviceUuid: args.serviceUuid };
  } catch (e: any) {
    if (isCancel(e)) throw e; // user dismissed — stop here
  }

  // Pass 2 — "MPY-*" / "MPY ESP32" devices (old cached name)
  try {
    const dev = await BleClient.requestDevice({
      namePrefix: "MPY",
      optionalServices: [args.serviceUuid],
    } as any);
    await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());
    return { kind: "native", name: dev.name ?? dev.deviceId, deviceId: dev.deviceId, serviceUuid: args.serviceUuid };
  } catch (e: any) {
    if (isCancel(e)) throw e;
  }

  // Pass 3 — no name filter; user picks manually from all nearby devices
  const dev: BleDevice = await BleClient.requestDevice({
    optionalServices: [args.serviceUuid],
  } as any);
  await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());
  return { kind: "native", name: dev.name ?? dev.deviceId, deviceId: dev.deviceId, serviceUuid: args.serviceUuid };
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
  await BleClient.startNotifications(conn.deviceId, conn.serviceUuid, characteristicUuid, onValue);
  return { kind: "native", deviceId: conn.deviceId, service: conn.serviceUuid, characteristic: characteristicUuid };
}

export async function writeUtf8Native(conn: NativeAdapterConnection, characteristicUuid: string, text: string) {
  await ensureInit();
  const u8 = new TextEncoder().encode(text);
  const dv = bytesToDataView(u8);
  await BleClient.write(conn.deviceId, conn.serviceUuid, characteristicUuid, dv);
}