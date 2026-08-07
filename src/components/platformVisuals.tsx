// src/components/platformVisuals.tsx
// Three purpose-built mockup visuals for the landing page's "Platform" section —
// each one illustrates its own feature card instead of a generic random grid.

import React, { useEffect, useMemo, useState } from "react";
import { IconActivity, IconAlertTriangle, IconAngle, IconTrendUp } from "./icons";
import { useVisible } from "../hooks/useVisible";

const GRID_ROWS = 8;
const GRID_COLS = 12;

function buildCells() {
  const cells: { row: number; col: number; index: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      cells.push({ row, col, index: row * GRID_COLS + col });
    }
  }
  return cells;
}

// Ticks a counter up in short bursts while `active` — a single number
// re-rendering, not 96 nodes, so this stays cheap even left running.
function useTickingCount(active: boolean, min = 40, max = 160, intervalMs = 180) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setCount((c) => c + min + Math.floor(Math.random() * (max - min)));
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, min, max, intervalMs]);
  return count;
}

// ── 1. Hardware: raw sensor data capture — a live sampling waveform, a ─────
//      scanning read-out row, and a running captured-samples counter.
export function DataCaptureVisual() {
  const { ref, visible } = useVisible();
  const samples = useTickingCount(visible);
  return (
    <div className={`ts-pv-frame ${visible ? "ts-pv-frame--visible" : ""}`} ref={ref}>
      <div className="ts-pv-captureHead">
        <span className="ts-pv-liveDot" />
        <span className="ts-pv-captureLabel">Sampling</span>
        <span className="ts-pv-captureHz">3,600 Hz</span>
      </div>
      <div className="ts-pv-wave" />
      <div className="ts-pv-scanRow">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="ts-pv-scanDot" style={{ animationDelay: `${i * 0.09}s` }} />
        ))}
      </div>
      <div className="ts-pv-readout">
        <span className="ts-pv-readoutLabel">Samples Captured</span>
        <span className="ts-pv-readoutValue">{samples.toLocaleString()}</span>
      </div>
      <div className="ts-pv-caption">96 cells read every 0.28ms — nothing gets missed</div>
    </div>
  );
}

// ── 2. Software: live impacts propagating across the pad, decaying by ──────
//      distance (area effect) and by time. Driven entirely by a looping CSS
//      keyframe (per-cell delay + peak baked in via a custom property) —
//      no ongoing JS timers, so the tab isn't re-rendering 96 nodes forever.
const PROP_RADIUS = 6.4;
const PROP_SPEED = 15; // grid units / second
const CYCLE_SEC = 2.2;

export function ImpactPropagationVisual() {
  const { ref, visible } = useVisible();
  const origin = useMemo(
    () => ({ row: 2 + Math.floor(Math.random() * 4), col: 3 + Math.floor(Math.random() * 6) }),
    []
  );
  const cells = useMemo(() => {
    return buildCells().map((c) => {
      const dist = Math.hypot(c.row - origin.row, c.col - origin.col);
      const arrival = Math.min((dist / PROP_SPEED), CYCLE_SEC - 0.4);
      const peak = Math.max(0, 1 - dist / PROP_RADIUS);
      return { ...c, arrival, peak };
    });
  }, [origin]);

  return (
    <div className={`ts-pv-frame ${visible ? "ts-pv-frame--visible" : ""}`} ref={ref}>
      <div className="ts-pv-grid">
        {cells.map((c) => (
          <div
            key={c.index}
            className="ts-pv-cell ts-pv-cell--impact"
            style={{
              animationDelay: `${c.arrival}s`,
              "--pv-peak": c.peak,
            } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="ts-pv-readout ts-pv-readout--impact">
        <span className="ts-pv-readoutLabel">Strength Index</span>
        <span className="ts-pv-readoutValue">612</span>
        <div className="ts-pv-decayTrack">
          <div className="ts-pv-decayFill ts-pv-decayFill--impact" />
        </div>
      </div>
      <div className="ts-pv-caption">Impact detected → strength index decays across the pad in ~900ms</div>
    </div>
  );
}

// ── 3. Intelligence: AI reading the session for what a coach would miss ────
export function AIInsightVisual() {
  return (
    <div className="ts-pv-frame">
      <div className="ts-pv-aiGrid">
        <div className="ts-pv-aiCard">
          <div className="ts-pv-aiHead" style={{ color: "#ffb020" }}><IconActivity size={13} /> Output Index</div>
          <svg className="ts-pv-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none">
            <polyline
              points="0,10 15,14 30,12 45,20 60,18 75,26 100,24"
              fill="none" stroke="#ffb020" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          <div className="ts-pv-aiValue">+12% vs. session start</div>
        </div>

        <div className="ts-pv-aiCard">
          <div className="ts-pv-aiHead" style={{ color: "#00dcff" }}><IconTrendUp size={13} /> Reaction Time</div>
          <div className="ts-pv-aiBig">312<span>ms</span></div>
          <div className="ts-pv-aiValue" style={{ color: "#00dcff" }}>▼ 18ms faster</div>
        </div>

        <div className="ts-pv-aiCard">
          <div className="ts-pv-aiHead" style={{ color: "#ff5c8a" }}><IconAlertTriangle size={13} /> L/R Asymmetry</div>
          <div className="ts-pv-splitBar">
            <div className="ts-pv-splitL" style={{ width: "54%" }}>54%</div>
            <div className="ts-pv-splitR" style={{ width: "46%" }}>46%</div>
          </div>
          <div className="ts-pv-aiValue" style={{ color: "#ff5c8a" }}>8% imbalance flagged</div>
        </div>

        <div className="ts-pv-aiCard">
          <div className="ts-pv-aiHead" style={{ color: "#00ff88" }}><IconAngle size={13} /> Impact Angle</div>
          <svg className="ts-pv-angle" viewBox="0 0 80 44">
            <line x1="6" y1="40" x2="74" y2="40" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
            <line x1="6" y1="40" x2="50" y2="8" stroke="#ff5c8a" strokeWidth="2" strokeDasharray="3 3" />
            <line x1="6" y1="40" x2="38" y2="8" stroke="#00ff88" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M22 40a16 16 0 0 1 6-12.5" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
          </svg>
          <div className="ts-pv-aiValue" style={{ color: "#00ff88" }}>71° → 84° corrected</div>
        </div>
      </div>
      <div className="ts-pv-caption">AI flags what to fix — rep by rep, session over session</div>
    </div>
  );
}
