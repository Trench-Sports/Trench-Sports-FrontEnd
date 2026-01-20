// src/visualization/contacts.ts
export type GridSize = { cols: number; rows: number };

export type Cell = {
  voltage: number;
  lastHitAt: number; // Date.now() ms
};

export type HitMsg = {
  type: "hit";
  row: number; // 1-based in your NDJSON
  col: number; // 1-based
  voltage?: number;
  ts_ms?: number;
};

export type SessionStartMsg = {
  type: "session_start";
  session?: {
    grid_size?: [number, number]; // [cols, rows]
  };
};

export type AnyMsg = HitMsg | SessionStartMsg | Record<string, unknown>;

export function makeGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ voltage: 0, lastHitAt: 0 }))
  );
}

export function applyHit(prev: Cell[][], hit: HitMsg): Cell[][] {
  const r = Number(hit.row) - 1; // y
  const c = Number(hit.col) - 1; // x
  if (!Number.isFinite(r) || !Number.isFinite(c)) return prev;
  if (r < 0 || c < 0 || r >= prev.length || c >= prev[0].length) return prev;

  const v = Number(hit.voltage ?? 0);

  const next = prev.map((row) => row.slice());
  next[r][c] = { voltage: v, lastHitAt: Date.now() };
  return next;
}

/**
 * Consumes a running text buffer of NDJSON and returns:
 * - updated buffer (any partial trailing line)
 * - full lines extracted
 */
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

export function tryParseJson(line: string): AnyMsg | null {
  try {
    return JSON.parse(line) as AnyMsg;
  } catch {
    return null;
  }
}

export function extractGridSize(msg: AnyMsg): GridSize | null {
  if ((msg as any)?.type !== "session_start") return null;
  const gs = (msg as any)?.session?.grid_size;
  if (!Array.isArray(gs) || gs.length !== 2) return null;

  const cols = Number(gs[0]);
  const rows = Number(gs[1]);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;

  return { cols, rows };
}

export function isHit(msg: AnyMsg): msg is HitMsg {
  return (msg as any)?.type === "hit" && (msg as any)?.row != null && (msg as any)?.col != null;
}
