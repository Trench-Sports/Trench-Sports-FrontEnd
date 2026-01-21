/**
 * Minimal Web Bluetooth helper for a BLE adapter/peripheral.
 *
 * Notes:
 * - Web Bluetooth only works in secure contexts (HTTPS) and supported browsers (Chromium-based).
 * - UUIDs must match your firmware's GATT service/characteristic.
 */

export type AdapterConnection = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
};

function normalizeUuid(u?: string) {
  const s = (u ?? "").trim();
  return s ? s.toLowerCase() : undefined;
}

function isLocalhostHost() {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function getBleConfig() {
  const SERVICE_UUID = normalizeUuid(import.meta.env.VITE_BLE_SERVICE_UUID as string | undefined);

  // Optional example characteristics (TX notify / RX write)
  const CHAR_UUID_TX = normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_TX as string | undefined);
  const CHAR_UUID_RX = normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_RX as string | undefined);

  // Optional: make the device filter configurable
  const DEVICE_NAME_PREFIX = (import.meta.env.VITE_BLE_DEVICE_NAME_PREFIX as string | undefined)?.trim() || "MPY";

  // Optional: allow bypassing namePrefix filter when debugging
  // set VITE_BLE_ACCEPT_ALL_DEVICES="true" on Vercel to show everything
  const ACCEPT_ALL_DEVICES = String(import.meta.env.VITE_BLE_ACCEPT_ALL_DEVICES ?? "")
    .toLowerCase()
    .trim() === "true";

  return { SERVICE_UUID, CHAR_UUID_TX, CHAR_UUID_RX, DEVICE_NAME_PREFIX, ACCEPT_ALL_DEVICES };
}

export async function connectToAdapter(): Promise<AdapterConnection> {
  // Secure context check: localhost is special-cased by browsers
  if (!isLocalhostHost() && !window.isSecureContext) {
    throw new Error("Web Bluetooth requires HTTPS (secure context). Open the https:// Vercel URL in Chrome/Edge.");
  }

  if (!("bluetooth" in navigator)) {
    throw new Error("Web Bluetooth is not available in this browser. Try Chrome/Edge on desktop (or supported Android).");
  }

  const { SERVICE_UUID, DEVICE_NAME_PREFIX, ACCEPT_ALL_DEVICES } = getBleConfig();
  if (!SERVICE_UUID) {
    throw new Error("Missing VITE_BLE_SERVICE_UUID. Set it on Vercel and redeploy.");
  }

  const requestOptions: RequestDeviceOptions = ACCEPT_ALL_DEVICES
    ? {
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      }
    : {
        // If your device name doesn’t start with MPY in production, this will hide it.
        // Set VITE_BLE_DEVICE_NAME_PREFIX on Vercel or set VITE_BLE_ACCEPT_ALL_DEVICES="true".
        filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
        optionalServices: [SERVICE_UUID],
      };

  const device = await navigator.bluetooth.requestDevice(requestOptions);

  if (!device.gatt) throw new Error("No GATT on selected device.");

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
  onValue: (value: DataView) => void
) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing notify characteristic UUID.");

  const char = await conn.service.getCharacteristic(uuid);
  await char.startNotifications();

  char.addEventListener("characteristicvaluechanged", (ev) => {
    const target = ev.target as BluetoothRemoteGATTCharacteristic;
    if (target.value) onValue(target.value);
  });

  return char;
}

export async function writeUtf8(conn: AdapterConnection, characteristicUuid: string, text: string) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing write characteristic UUID.");

  const char = await conn.service.getCharacteristic(uuid);
  const enc = new TextEncoder();
  await char.writeValue(enc.encode(text));
}

export async function getCharacteristic(conn: AdapterConnection, uuidRaw: string) {
  const uuid = normalizeUuid(uuidRaw);
  if (!uuid) throw new Error("Missing characteristic UUID.");
  return await conn.service.getCharacteristic(uuid);
}
