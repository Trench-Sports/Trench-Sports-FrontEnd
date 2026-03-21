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

  // ── Single requestDevice call with combined filters ───────────────────────
  //
  // Previous approach opened multiple requestDevice() calls in a waterfall,
  // which caused multiple picker dialogs to appear back-to-back if the first
  // filter returned no results — a broken UX.
  //
  // The Capacitor BLE plugin accepts an array of filter objects in `services`.
  // The OS shows a device in the picker if it matches ANY of the provided
  // filters (OR logic), so combining service UUID + namePrefix in one call
  // is both correct and shows only one picker dialog.
  //
  // Filter logic (device appears if it matches either):
  //   • services: [NUS UUID]  — matches on the UUID broadcast in the ad payload
  //                             (main.py fix); works for brand-new unpaired units
  //   • namePrefix: "TS"      — matches OS-cached name "TS-001" etc.; catches
  //                             old-firmware units whose ad payload lacks UUID
  //
  // optionalServices ensures GATT service discovery succeeds regardless of
  // which filter triggered the match.
  //
  // Note: the Capacitor plugin's TypeScript types don't expose `filters[]` as
  // an array directly, so we cast to `any`. The underlying native layer on both
  // iOS (CoreBluetooth) and Android (BluetoothLeScanner) supports multiple
  // scan filters natively.

  const scanFilters: any[] = [
    { services: [args.serviceUuid] },
  ];
  if (args.namePrefix.trim()) {
    scanFilters.push({ namePrefix: args.namePrefix.trim() });
  }

  const dev: BleDevice = await BleClient.requestDevice({
    filters: scanFilters,
    optionalServices: [args.serviceUuid],
  } as any);

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