// src/bluetooth/protocol.ts
// Newline-delimited framing + chunked write utility

export class LineAssembler {
  private buf = "";

  // Feed raw notification bytes. Returns completed lines (without the trailing '\n').
  feed(chunk: ArrayBuffer): string[] {
    const text = new TextDecoder().decode(chunk);
    this.buf += text;

    const lines: string[] = [];
    while (true) {
      const idx = this.buf.indexOf("\n");
      if (idx === -1) break;

      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);

      if (line) lines.push(line);
    }
    return lines;
  }

  flushRemainder(): string | null {
    const s = this.buf.trim();
    this.buf = "";
    return s ? s : null;
  }
}

// Web Bluetooth write helper. Uses writeValue (with response).
// If you later want without-response, you can add writeValueWithoutResponse when available.
export async function chunkedWriteUtf8(
  characteristic: BluetoothRemoteGATTCharacteristic,
  text: string,
  chunkSize = 128,
  chunkDelayMs = 10
) {
  const enc = new TextEncoder();
  const data = enc.encode(text);

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await characteristic.writeValue(chunk);

    if (chunkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
  }
}
