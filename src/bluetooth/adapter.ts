// src/bluetooth/adapter.ts

export type AdapterConnection = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
};

function normalizeUuid(u?: string) {
  const s = (u ?? "").trim();
  return s ? s.toLowerCase() : undefined;
}

function isLocalhost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function getBleConfig() {
  return {
    SERVICE_UUID: normalizeUuid(import.meta.env.VITE_BLE_SERVICE_UUID as string | undefined),
    CHAR_UUID_RX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_RX as string | undefined),
    CHAR_UUID_TX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_TX as string | undefined),
    NAME_PREFIX: ((import.meta.env.VITE_BLE_NAME_PREFIX as string | undefined) ?? "MPY").trim(),
  };
}

export function getBluetoothDiagnostics() {
  const navAny = navigator as any;
  return {
    url: location.href,
    protocol: location.protocol,
    secureContext: window.isSecureContext,
    localhost: isLocalhost(),
    hasBluetooth: typeof navAny.bluetooth !== "undefined",
    hasRequestDevice: !!navAny.bluetooth?.requestDevice,
    userAgent: navigator.userAgent,
  };
}

export async function connectToAdapter(): Promise<AdapterConnection> {
  const navAny = navigator as any;

  if (!window.isSecureContext && !isLocalhost()) {
    throw new Error("Web Bluetooth requires HTTPS (secure context).");
  }
  if (!navAny.bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth not supported in this browser/context.");
  }

  const { SERVICE_UUID, NAME_PREFIX } = getBleConfig();
  if (!SERVICE_UUID) throw new Error("Missing VITE_BLE_SERVICE_UUID.");

  // Try namePrefix first (your desired behavior)
  const filtered: RequestDeviceOptions = {
    filters: [{ namePrefix: NAME_PREFIX }],
    optionalServices: [SERVICE_UUID],
  };

  // Fallback to acceptAllDevices if the filter yields nothing / throws
  const fallback: RequestDeviceOptions = {
    acceptAllDevices: true,
    optionalServices: [SERVICE_UUID],
  };

  let device: BluetoothDevice;

  try {
    device = await navAny.bluetooth.requestDevice(filtered);
  } catch {
    device = await navAny.bluetooth.requestDevice(fallback);
  }

  if (!device.gatt) throw new Error("Selected device has no GATT.");

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);

  return { device, server, service };
}

export async function disconnect(conn: AdapterConnection | null) {
  try {
    if (conn?.device?.gatt?.connected) conn.device.gatt.disconnect();
  } catch {
    // ignore
  }
}

export async function startNotifications(
  conn: AdapterConnection,
  characteristicUuid: string,
  onValue: (dv: DataView) => void
) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing notify characteristic UUID (VITE_BLE_CHAR_UUID_TX).");

  const ch = await conn.service.getCharacteristic(uuid);
  await ch.startNotifications();

  ch.addEventListener("characteristicvaluechanged", (ev) => {
    const t = ev.target as BluetoothRemoteGATTCharacteristic;
    if (t?.value) onValue(t.value);
  });

  return ch;
}

export async function writeUtf8(conn: AdapterConnection, characteristicUuid: string, text: string) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing write characteristic UUID (VITE_BLE_CHAR_UUID_RX).");

  const ch = await conn.service.getCharacteristic(uuid);
  const enc = new TextEncoder();
  await ch.writeValue(enc.encode(text));
}
