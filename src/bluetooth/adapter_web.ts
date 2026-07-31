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

  // ── Filtering strategy ────────────────────────────────────────────────────
  //
  // Root cause of "new devices not found":
  //
  // The old code used `filters: [{ namePrefix }]` as the primary filter.
  // The Web Bluetooth namePrefix filter matches against the name the OS has
  // *cached* from a previous pairing — NOT the name in the live advertisement
  // packet. A brand-new device that has never been paired has no cached name,
  // so it never appears in the picker even when it's sitting right next to the
  // phone. Previously-connected devices worked because their name ("MPY ESP32",
  // the MicroPython GAP default) was already in the OS cache.
  //
  // The correct primary filter is `services: [serviceUuid]`. This is evaluated
  // against the live advertisement packet on every scan — no prior pairing
  // required. As long as the ESP32 includes the NUS UUID in its ad payload
  // (fixed in main.py's _adv_payload), any device in range will appear.
  //
  // We pass `namePrefix` as a *second* filter option so users on platforms
  // where service-UUID filtering isn't supported (rare, but exists on some
  // Android WebViews) still get a narrowed list. Both filters are tried;
  // if both fail we fall all the way back to acceptAllDevices so the user
  // can always manually identify their bag.
  //
  // Filter cascade:
  //   1. services UUID — works on all fresh/new devices (radio-level filter)
  //   2. namePrefix "TS" — narrows to TS-XXX devices (cached-name filter, old devices)
  //   3. acceptAllDevices — last resort; user picks manually

  const serviceFilter: RequestDeviceOptions = {
    filters: [{ services: [args.serviceUuid] }],
    optionalServices: [args.serviceUuid],
  };

  const namePrefixFilter: RequestDeviceOptions = {
    filters: [{ namePrefix: args.namePrefix }],
    optionalServices: [args.serviceUuid],
  };

  const fallback: RequestDeviceOptions = {
    acceptAllDevices: true,
    optionalServices: [args.serviceUuid],
  };

  let device: BluetoothDevice | null = null;

  // Try service-UUID filter first — finds new devices by their ad payload
  try {
    device = await navAny.bluetooth.requestDevice(serviceFilter);
  } catch (e: any) {
    // NotFoundError means no matching devices in range (or user cancelled).
    // Any other error means the filter itself was rejected — fall through.
    if (e?.name === "NotFoundError" || (e?.message ?? "").toLowerCase().includes("cancel")) {
      throw e; // propagate cancellation so the UI goes back to idle
    }
  }

  // Try namePrefix filter — catches previously-paired devices whose OS cache
  // has "TS-001" / "TS-002" etc. but whose ad payload may not yet include UUID
  // (e.g. units running old firmware before the _adv_payload fix)
  if (!device) {
    try {
      device = await navAny.bluetooth.requestDevice(namePrefixFilter);
    } catch (e: any) {
      if (e?.name === "NotFoundError" || (e?.message ?? "").toLowerCase().includes("cancel")) {
        throw e;
      }
    }
  }

  // Last resort — show all nearby BLE devices
  if (!device) {
    device = await navAny.bluetooth.requestDevice(fallback);
  }

  // requestDevice returns `any` (navAny), so the reassignment above doesn't
  // narrow `device` off null — assert it explicitly before use.
  if (!device) throw new Error("No Bluetooth device was selected.");

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

  ch.addEventListener("characteristicvaluechanged", (ev: Event) => {
    const t = ev.target as BluetoothRemoteGATTCharacteristic;
    if (t?.value) onValue(t.value);
  });

  return ch;
}

export async function writeUtf8Web(
  conn: WebAdapterConnection,
  characteristicUuid: string,
  text: string,
  opts?: { withoutResponse?: boolean },
) {
  const ch = await conn.service.getCharacteristic(characteristicUuid);
  const data = new TextEncoder().encode(text);
  // Without-response skips the per-write ATT ACK so chunks pipeline within a
  // connection event (used for fast OTA). Falls back to writeValue if the
  // platform/characteristic doesn't expose it.
  if (opts?.withoutResponse && typeof (ch as any).writeValueWithoutResponse === "function") {
    await (ch as any).writeValueWithoutResponse(data);
  } else {
    await ch.writeValue(data);
  }
}