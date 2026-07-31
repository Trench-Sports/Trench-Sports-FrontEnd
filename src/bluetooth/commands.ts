// src/bluetooth/commands.ts
import type { AdapterConnection } from "./adapter";
import { chunkedWriteUtf8 } from "./protocol";

export async function getCharacteristic(
  conn: AdapterConnection,
  uuid: string
): Promise<BluetoothRemoteGATTCharacteristic> {
  // `service` exists only on the Web Bluetooth adapter connection; the native
  // adapter writes through its own path. Narrow the union before accessing it.
  if (conn.kind !== "web") {
    throw new Error("getCharacteristic is only supported on the Web Bluetooth adapter.");
  }
  return await conn.service.getCharacteristic(uuid);
}

export async function sendCommand(
  conn: AdapterConnection,
  rxUuid: string,
  cmd: string,
  opts?: { chunkSize?: number; delayMs?: number }
) {
  const rx = await getCharacteristic(conn, rxUuid);

  // Match Python sanitization
  const sanitized = cmd.trim().replaceAll("\\n", "").replaceAll("\\r", "");
  const line = sanitized.endsWith("\n") ? sanitized : sanitized + "\n";

  await chunkedWriteUtf8(
    rx,
    line,
    opts?.chunkSize ?? 128,
    opts?.delayMs ?? 10
  );
}
