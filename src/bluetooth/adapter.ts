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
    CHAR_UUID_TX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_TX as string | undefined),
    CHAR_UUID_RX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_RX as string | undefined),
  };
}

export function getBluetoothDiagnostics() {
  const navAny = navigator as any;

  const hasBluetooth = typeof navAny.bluetooth !== "undefined";
  const hasRequestDevice = !!navAny.bluetooth?.requestDevice;

  // Some browsers expose partial objects; be explicit
  const ua = navigator.userAgent;
  const platform = (navigator as any).userAgentData?.platform ?? navigator.platform;

  return {
    url: location.href,
    protocol: location.protocol,
    hostname: location.hostname,
    secureContext: window.isSecureContext,
    localhost: isLocalhost(),
    userAgent: ua,
    platform,
    hasBluetooth,
    hasRequestDevice,
  };
}

export async function connectToAdapter(): Promise<AdapterConnection> {
  const diag = getBluetoothDiagnostics();

  // Hard guards so we always surface a reason
  if (!diag.secureContext && !diag.localhost) {
    throw new Error(
      `Web Bluetooth blocked: not a secure context. Open the HTTPS Vercel URL in Chrome/Edge. (protocol=${diag.protocol})`
    );
  }

  const navAny = navigator as any;
  if (!navAny.bluetooth || !navAny.bluetooth.requestDevice) {
    throw new Error(
      "Web Bluetooth not available in this browser/context. Use Chrome/Edge desktop or supported Android Chrome. (Safari/Firefox/iOS/in-app browsers won't work.)"
    );
  }

  const { SERVICE_UUID } = getBleConfig();
  if (!SERVICE_UUID) {
    throw new Error("Missing VITE_BLE_SERVICE_UUID (set it in Vercel env vars and redeploy).");
  }

  // Most reliable: acceptAllDevices + optionalServices
  // This prevents namePrefix filter from hiding your device.
  const device: BluetoothDevice = await navAny.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE_UUID],
  });

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
}

export async function writeUtf8(conn: AdapterConnection, characteristicUuid: string, text: string) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing write characteristic UUID (VITE_BLE_CHAR_UUID_RX).");

  const ch = await conn.service.getCharacteristic(uuid);
  const enc = new TextEncoder();
  await ch.writeValue(enc.encode(text));
}
