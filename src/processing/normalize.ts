// src/processing/normalize.ts

export type NdjsonMessage =
  | SessionStartMsg
  | SampleMsg
  | CmdRxMsg
  | AckMsg
  | UnknownMsg;

export type SessionStartMsg = {
  kind: "session_start";
  raw: any;
  ts_ms?: number;
  session?: {
    id?: string;
    grid_size?: [number, number]; // [cols, rows]
    sampling_hz?: number;
    device_model?: string;
    calibration?: any;
    [k: string]: unknown;
  };
};

export type SampleMsg = {
  kind: "sample";
  raw: any;
  ts_ms: number;
  row: number; // 1-based
  col: number; // 1-based
  voltage: number;
};

export type CmdRxMsg = {
  kind: "cmd_rx";
  raw: any;
  ts_ms?: number;
  cmd?: string;
};

export type AckMsg = {
  kind: "ack";
  raw: any;
  ts_ms?: number;
  ok?: boolean;
  msg?: string;
};

export type UnknownMsg = {
  kind: "unknown";
  raw: any;
};

export function popNdjsonLines(buffer: string): { buffer: string; lines: string[] } {
  const lines: string[] = [];
  let rest = buffer;

  while (true) {
    const idx = rest.indexOf("\n");
    if (idx === -1) break;
    const line = rest.slice(0, idx).trim();
    rest = rest.slice(idx + 1);
    if (line) lines.push(line);
  }

  return { buffer: rest, lines };
}

export function tryParseJson(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function normalizeJson(obj: any): NdjsonMessage {
  // Native 'type' messages
  const type = obj?.type;

  if (type === "session_start") {
    return {
      kind: "session_start",
      raw: obj,
      ts_ms: num(obj?.ts_ms) ?? undefined,
      session: obj?.session,
    };
  }

  if (type === "cmd_rx") {
    return { kind: "cmd_rx", raw: obj, ts_ms: num(obj?.ts_ms) ?? undefined, cmd: obj?.cmd };
  }

  if (type === "ack") {
    return {
      kind: "ack",
      raw: obj,
      ts_ms: num(obj?.ts_ms) ?? undefined,
      ok: typeof obj?.ok === "boolean" ? obj.ok : undefined,
      msg: typeof obj?.msg === "string" ? obj.msg : undefined,
    };
  }

  // Heuristic sample detection (many of your lines don’t include type)
  const r = num(obj?.row);
  const c = num(obj?.col);
  const v = num(obj?.voltage);
  const t = num(obj?.ts_ms);

  if (r != null && c != null && v != null && t != null) {
    return {
      kind: "sample",
      raw: obj,
      ts_ms: t,
      row: r,
      col: c,
      voltage: v,
    };
  }

  return { kind: "unknown", raw: obj };
}

/**
 * Feed streaming BLE text chunks into this to get:
 * - updated buffer
 * - parsed messages
 * - raw lines (useful for logging / persistence)
 */
export function normalizeChunk(buffer: string, chunkText: string): {
  buffer: string;
  messages: NdjsonMessage[];
  rawLines: string[];
} {
  const merged = buffer + chunkText;
  const popped = popNdjsonLines(merged);

  const messages: NdjsonMessage[] = [];
  for (const line of popped.lines) {
    const obj = tryParseJson(line);
    if (!obj) continue;
    messages.push(normalizeJson(obj));
  }

  return { buffer: popped.buffer, messages, rawLines: popped.lines };
}
