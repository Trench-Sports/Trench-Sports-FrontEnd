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

  // ── Capacitor BLE plugin filter API ─────────────────────────────────────
  // BleClient.requestDevice() takes FLAT options — not a Web Bluetooth-style
  // `filters` array. Passing a `filters` key is silently ignored, which is
  // why all nearby devices were appearing (acceptAllDevices behaviour).
  //
  // The correct approach for the Capacitor plugin:
  //   • `namePrefix` → narrows the scan at the radio level to "TS-*" / "MPY-*"
  //   • `optionalServices` → tells the GATT stack which service to discover
  //                          after the user picks a device
  //
  // We build a combined prefix that matches both "TS" (current firmware,
  // set by boot.py) and "MPY" (old MicroPython default cached by the OS on
  // previously-paired units). The Capacitor plugin accepts a single string
  // prefix, so we use the shortest common prefix. Since "TS" and "MPY" share
  // no common prefix we make two sequential attempts — but only if the first
  // returns nothing (not a user cancel), so only one picker is ever shown.
  //
  // In practice nearly all units will match on the first attempt ("TS") once
  // firmware is updated. The "MPY" fallback covers legacy units only.

  const tryConnect = async (prefix: string): Promise<BleDevice | null> => {
    try {
      return await BleClient.requestDevice({
        namePrefix: prefix,
        optionalServices: [args.serviceUuid],
      } as any);
    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      // Propagate user cancellation immediately — don't open another picker
      if (msg.includes("cancel") || msg.includes("user denied") || msg.includes("user gesture")) {
        throw e;
      }
      return null;
    }
  };

  // Primary: "TS" prefix — matches TS-001, TS-002, etc. (current firmware)
  let dev: BleDevice | null = await tryConnect(args.namePrefix.trim() || "TS");

  // Fallback: "MPY" prefix — matches legacy units with MicroPython default name
  if (!dev) {
    dev = await tryConnect("MPY");
  }

  // Last resort: show all devices so the user can still connect manually
  if (!dev) {
    dev = await BleClient.requestDevice({
      optionalServices: [args.serviceUuid],
    } as any);
  }

  await BleClient.connect(dev.deviceId, () => args.onDisconnect?.());

  return {
    kind: "native",
    name: dev.name ?? dev.deviceId,
    deviceId: dev.deviceId,
    serviceUuid: args.serviceUuid,
  };
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