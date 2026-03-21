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

  // ── Filtering strategy ────────────────────────────────────────────────────
  //
  // Root cause of "new devices not found" on native (iOS/Android via Capacitor):
  //
  // The old code passed only `namePrefix` to BleClient.requestDevice(). On
  // native platforms this filters by the name the OS has *cached* from a prior
  // pairing (or from a previous scan where the name AD was decoded). A device
  // that has never been seen before has no cached name, so it is excluded even
  // when it is advertising at full power right next to the phone.
  //
  // The Capacitor BLE plugin supports a `services` filter which matches against
  // the UUID(s) broadcast in the live advertisement packet. Because main.py now
  // includes the NUS UUID in its _adv_payload, this filter reliably finds any
  // powered-on ESP32 bag regardless of whether it has ever been paired.
  //
  // Strategy:
  //   1. Try services + namePrefix together — tightest match, avoids showing
  //      unrelated BLE devices that happen to run NUS (e.g. other dev boards).
  //   2. Fall back to services only — finds TS bags whose OS-cached name hasn't
  //      been populated yet (brand-new device, different phone).
  //   3. Fall back to namePrefix only — catches old firmware units that don't
  //      yet include the UUID in their ad payload but whose name is cached.
  //
  // All three options pass `services` in optionalServices so GATT service
  // discovery succeeds even if the service wasn't in the scan filter.

  let dev: BleDevice | null = null;

  // Attempt 1: service UUID + namePrefix (most precise)
  try {
    dev = await BleClient.requestDevice({
      services: [args.serviceUuid],
      namePrefix: args.namePrefix.trim() || undefined,
      optionalServices: [args.serviceUuid],
    } as any);
  } catch (e: any) {
    const msg = (e?.message ?? "").toLowerCase();
    // Propagate explicit user cancellations immediately
    if (msg.includes("cancel") || msg.includes("user denied")) throw e;
    // Otherwise fall through to next strategy
  }

  // Attempt 2: service UUID only (finds new devices with no cached name)
  if (!dev) {
    try {
      dev = await BleClient.requestDevice({
        services: [args.serviceUuid],
        optionalServices: [args.serviceUuid],
      } as any);
    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      if (msg.includes("cancel") || msg.includes("user denied")) throw e;
    }
  }

  // Attempt 3: namePrefix only (old firmware, pre-UUID-in-adv-payload)
  if (!dev) {
    const requestOpts: any = {};
    if (args.namePrefix && args.namePrefix.trim().length > 0) {
      requestOpts.namePrefix = args.namePrefix.trim();
    }
    dev = await BleClient.requestDevice(requestOpts);
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