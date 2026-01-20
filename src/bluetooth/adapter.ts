/**
 * Minimal Web Bluetooth helper for a BLE adapter/peripheral.
 *
 * IMPORTANT:
 * - Web Bluetooth only works in secure contexts (HTTPS) and supported browsers (Chromium-based).
 * - UUIDs must match your firmware's GATT service/characteristic.
 */

export type AdapterConnection = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
};

export function getBleConfig() {

  const SERVICE_UUID = import.meta.env.VITE_BLE_SERVICE_UUID as string | undefined;

  // Optional example characteristics (TX notify / RX write)
  const CHAR_UUID_TX = import.meta.env.VITE_BLE_CHAR_UUID_TX as string | undefined;
  const CHAR_UUID_RX = import.meta.env.VITE_BLE_CHAR_UUID_RX as string | undefined;

  return { SERVICE_UUID, CHAR_UUID_TX, CHAR_UUID_RX };
}

export async function connectToAdapter(): Promise<AdapterConnection> {
  if (!("bluetooth" in navigator)) {
    throw new Error("Web Bluetooth is not available in this browser.");
  }

  const { SERVICE_UUID } = getBleConfig();
  if (!SERVICE_UUID) {
    throw new Error("Missing VITE_BLE_SERVICE_UUID. Set it and rebuild.");
  }

  // Web Bluetooth prefers lowercase UUID strings
  const serviceUuid = SERVICE_UUID.toLowerCase();

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "MPY" }],        // matches BLE_client.py DEVICE_NAME = "MPY ESP32"
    optionalServices: [serviceUuid],         // allows getPrimaryService(serviceUuid)
  });

  if (!device.gatt) throw new Error("No GATT on selected device.");

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(serviceUuid);

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
  const char = await conn.service.getCharacteristic(characteristicUuid);
  await char.startNotifications();
  char.addEventListener("characteristicvaluechanged", (ev) => {
    const target = ev.target as BluetoothRemoteGATTCharacteristic;
    if (target.value) onValue(target.value);
  });
  return char;
}

export async function writeUtf8(
  conn: AdapterConnection,
  characteristicUuid: string,
  text: string
) {
  const char = await conn.service.getCharacteristic(characteristicUuid);
  const enc = new TextEncoder();
  await char.writeValue(enc.encode(text));
}

export async function getCharacteristic(
  conn: AdapterConnection,
  uuid: string
): Promise<BluetoothRemoteGATTCharacteristic> {
  return await conn.service.getCharacteristic(uuid);
}

