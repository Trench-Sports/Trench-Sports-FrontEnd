// src/bluetooth/adapter_web.ts

export type WebAdapterConnection = {
  kind: "web";
  name: string;
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
};

function isLocalhost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export async function connectToAdapterWeb(args: {
  serviceUuid: string;
  namePrefix: string;
  onDisconnect?: () => void;
}): Promise<WebAdapterConnection> {
  const navAny = navigator as any;

  if (!window.isSecureContext && !isLocalhost()) {
    throw new Error("Web Bluetooth requires HTTPS (secure context).");
  }
  if (!navAny.bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth not supported in this browser/context.");
  }

  const filtered: RequestDeviceOptions = {
    filters: [{ namePrefix: args.namePrefix }],
    optionalServices: [args.serviceUuid],
  };

  const fallback: RequestDeviceOptions = {
    acceptAllDevices: true,
    optionalServices: [args.serviceUuid],
  };

  let device: BluetoothDevice;
  try {
    device = await navAny.bluetooth.requestDevice(filtered);
  } catch {
    device = await navAny.bluetooth.requestDevice(fallback);
  }

  if (!device.gatt) throw new Error("Selected device has no GATT.");

  device.addEventListener("gattserverdisconnected", () => args.onDisconnect?.());

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(args.serviceUuid);

  return {
    kind: "web",
    name: device.name ?? "device",
    device,
    server,
    service,
  };
}

export async function disconnectWeb(conn: WebAdapterConnection | null) {
  try {
    if (conn?.device?.gatt?.connected) conn.device.gatt.disconnect();
  } catch {
    // ignore
  }
}

export async function startNotificationsWeb(
  conn: WebAdapterConnection,
  characteristicUuid: string,
  onValue: (dv: DataView) => void
) {
  const ch = await conn.service.getCharacteristic(characteristicUuid);
  await ch.startNotifications();

  ch.addEventListener("characteristicvaluechanged", (ev) => {
    const t = ev.target as BluetoothRemoteGATTCharacteristic;
    if (t?.value) onValue(t.value);
  });

  return ch;
}

export async function writeUtf8Web(conn: WebAdapterConnection, characteristicUuid: string, text: string) {
  const ch = await conn.service.getCharacteristic(characteristicUuid);
  const enc = new TextEncoder();
  await ch.writeValue(enc.encode(text));
}
