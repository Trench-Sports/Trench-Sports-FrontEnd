// src/bluetooth/adapter_native.ts
// # python3 -m thonny
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

  const requestOpts: any = {};
  if (args.namePrefix && args.namePrefix.trim().length > 0) {
    requestOpts.namePrefix = args.namePrefix.trim();
  }

  const dev: BleDevice = await BleClient.requestDevice(requestOpts);

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

  // startNotifications(deviceId, service, characteristic, callback) :contentReference[oaicite:4]{index=4}
  await BleClient.startNotifications(conn.deviceId, conn.serviceUuid, characteristicUuid, onValue);

  // return a lightweight handle (not used by your UI yet)
  return { kind: "native", deviceId: conn.deviceId, service: conn.serviceUuid, characteristic: characteristicUuid };
}

export async function writeUtf8Native(conn: NativeAdapterConnection, characteristicUuid: string, text: string) {
  await ensureInit();

  const u8 = new TextEncoder().encode(text);
  const dv = bytesToDataView(u8);

  // write(deviceId, service, characteristic, value) :contentReference[oaicite:5]{index=5}
  await BleClient.write(conn.deviceId, conn.serviceUuid, characteristicUuid, dv);
}
