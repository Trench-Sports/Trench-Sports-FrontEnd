// src/components/ContactGrid.tsx
import type { Cell, GridSize } from "../visualization/contacts";

export type MetricMode = "voltage" | "force";

export function ContactGrid({
  grid,
  gridSize,
  hitGlowMs = 300,
  flipY = false,
  mode,
  getForceN,
}: {
  grid: Cell[][];
  gridSize: GridSize;
  hitGlowMs?: number;
  flipY?: boolean;
  mode: MetricMode;
  // r,c are 0-based
  getForceN?: (r: number, c: number, voltage: number) => number;
}) {
  const now = Date.now();
  const rows = flipY ? [...grid].reverse() : grid;

  // compute max for normalization (avoid hardcoded voltage ranges)
  let maxVal = 0;
  for (let rr = 0; rr < grid.length; rr++) {
    for (let cc = 0; cc < grid[0].length; cc++) {
      const v = grid[rr][cc].voltage ?? 0;
      const val = mode === "voltage" ? v : (getForceN ? getForceN(rr, cc, v) : 0);
      if (Number.isFinite(val)) maxVal = Math.max(maxVal, val);
    }
  }
  if (maxVal <= 0) maxVal = 1;

  const unit = mode === "voltage" ? "V" : "N";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <strong style={{ textAlign: "center" }}>
          Contacts ({gridSize.rows}y × {gridSize.cols}x) — {mode.toUpperCase()} ({unit})
        </strong>
      </div>


      {/* Center the grid regardless of parent width */}
      <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridSize.cols}, 26px)`,
            gridTemplateRows: `repeat(${gridSize.rows}, 26px)`,
            gap: 6,
            width: "fit-content",
          }}
        >
          {rows.map((rowCells, rDisplay) =>
            rowCells.map((cell, c) => {
              // r for compute should match original grid indexing
              const r = flipY ? gridSize.rows - 1 - rDisplay : rDisplay;

              const age = now - cell.lastHitAt;
              const active = cell.lastHitAt > 0 && age < hitGlowMs;

              const v = cell.voltage || 0;
              const force = getForceN ? getForceN(r, c, v) : 0;
              const val = mode === "voltage" ? v : force;

              const norm = Math.max(0, Math.min(1, val / maxVal));
              const opacity = active ? 0.20 + 0.80 * norm : 0.08;

              const y = flipY ? gridSize.rows - rDisplay : rDisplay + 1;

              return (
                <div
                  key={`${rDisplay}-${c}`}
                  title={`(x=${c + 1}, y=${y}) V=${v.toFixed(3)}  F=${force.toFixed(2)}N`}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: `rgba(0, 255, 120, ${opacity})`,
                    boxShadow: active ? "0 0 10px rgba(0,255,120,0.35)" : "none",
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
