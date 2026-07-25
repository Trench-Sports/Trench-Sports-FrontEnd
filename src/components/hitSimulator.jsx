// src/components/hitSimulator.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import tsLogoMark from "../images/TS Logo Enhancement Set 2-01.png";

// ─── Types & Constants ────────────────────────────────────────────────────────

const MODES = ["Power", "Accuracy", "Reaction", "Volume", "Target"];

// ─── Zone definitions for Target mode ────────────────────────────────────────
// Grid is 10 rows × 6 cols (0-indexed). Zones split into 3×3 named regions.
// Rows: top=0-2, middle=3-6, bottom=7-9  |  Cols: left=0-1, center=2-3, right=4-5
const ALL_ZONES = [
  { row: "top",    col: "left"   }, { row: "top",    col: "center" }, { row: "top",    col: "right"  },
  { row: "middle", col: "left"   }, { row: "middle", col: "center" }, { row: "middle", col: "right"  },
  { row: "bottom", col: "left"   }, { row: "bottom", col: "center" }, { row: "bottom", col: "right"  },
];

function randomZone() {
  return ALL_ZONES[Math.floor(Math.random() * ALL_ZONES.length)];
}

// Map a clicked cell (row, col on 10×6) to its named zone
function cellToZone(row, col) {
  const zRow = row <= 2 ? "top" : row <= 6 ? "middle" : "bottom";
  const zCol = col <= 1 ? "left" : col <= 3 ? "center" : "right";
  return { row: zRow, col: zCol };
}

function zonesMatch(a, b) { return a.row === b.row && a.col === b.col; }

// Returns the grid row/col bounds for a named zone (for overlay rendering)
function zoneBounds(zone) {
  const rowStart = zone.row === "top" ? 0 : zone.row === "middle" ? 3 : 7;
  const rowEnd   = zone.row === "top" ? 2 : zone.row === "middle" ? 6 : 9;
  const colStart = zone.col === "left" ? 0 : zone.col === "center" ? 2 : 4;
  const colEnd   = zone.col === "left" ? 1 : zone.col === "center" ? 3 : 5;
  return { rowStart, rowEnd, colStart, colEnd };
}

const MODE_META = {
  Power: {
    icon: "💥",
    color: "#b400ff",
    glow: "rgba(180,0,255,0.55)",
    label: "Hit anywhere",
    desc: "Strike any zone on the bag. Every impact is captured — force, speed, and placement logged in real time.",
    bullets: ["Full-bag impact detection", "Force + velocity analytics", "Auto session logging"],
  },
  Accuracy: {
    icon: "🎯",
    color: "#00dcff",
    glow: "rgba(0,220,255,0.55)",
    label: "Hit the center",
    desc: "Precision training mode. The bag scores each strike by how close you land to the bullseye. Tighten your technique.",
    bullets: ["Bullseye proximity scoring", "Strike consistency tracking", "Drift pattern heatmaps"],
  },
  Reaction: {
    icon: "⚡️",
    color: "#ffcc00",
    glow: "rgba(255,200,0,0.55)",
    label: "React & Strike",
    desc: "Wait for the prompt. React and hit as fast as you can. Reaction time is measured from signal to impact.",
    bullets: ["Signal-to-impact latency", "Reaction trend charts", "Fatigue tracking over sets"],
  },
  Volume: {
    icon: "🥊",
    color: "#ff6a00",
    glow: "rgba(255,106,0,0.55)",
    label: "Punch volume",
    desc: "Wait for the signal, then throw as many strikes as possible inside 5 seconds. Score = total hits per window.",
    bullets: ["Per-window hit count", "Strength index across window", "Fatigue slope across rounds"],
  },
  Target: {
    icon: "🏹",
    color: "#00ff88",
    glow: "rgba(0,255,136,0.55)",
    label: "Hit the zone",
    desc: "A zone lights up on the bag — strike it as fast and accurately as you can. Both reaction time and zone accuracy are scored.",
    bullets: ["Zone accuracy tracking", "Reaction time (correct hits)", "3×3 zone breakdown"],
  },
};

// ─── Strength Index ───────────────────────────────────────────────────────────
// Mirrors the formula in session.tsx:
//   speed component  (40%) — normalised IEI: fast cadence scores higher
//   force component  (60%) — normalised force against sensor ceiling
//   result: 0–1000 integer

const MAX_FORCE_LB = 45; // simulated ceiling — maps to voltNorm = 1.0
const MIN_IEI_MS   = 100;
const MAX_IEI_MS   = 2000;

function strengthIndex(forceOrMv, ieiMs) {
  const speedNorm = ieiMs == null
    ? 0.5  // first hit of session — neutral
    : Math.max(0, Math.min(1, 1 - (ieiMs - MIN_IEI_MS) / (MAX_IEI_MS - MIN_IEI_MS)));
  const forceNorm = Math.max(0, Math.min(1, forceOrMv / MAX_FORCE_LB));
  return Math.round((speedNorm * 0.4 + forceNorm * 0.6) * 1000);
}

// ─── Sub-component: ImpactRipple ──────────────────────────────────────────────

function ImpactRipple({ x, y, color, id, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {/* Core flash */}
      <div style={{
        width: 14, height: 14, borderRadius: "50%",
        background: color,
        boxShadow: `0 0 16px 6px ${color}`,
        animation: "tsCorePulse 0.9s ease-out forwards",
      }} />
      {/* Ripple ring */}
      <div style={{
        position: "absolute",
        left: "50%", top: "50%",
        width: 14, height: 14,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        animation: "tsRipple 0.9s ease-out forwards",
      }} />
    </div>
  );
}

// ─── Sub-component: BagGrid ───────────────────────────────────────────────────

function BagGrid({ mode, impacts, hoveredZone, onZoneEnter, onZoneLeave, onZoneClick, activeMode, targetZone }) {
  const ROWS = 10, COLS = 6;
  const cells = Array.from({ length: ROWS * COLS }, (_, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    return { i, row, col };
  });

  const cx = (COLS - 1) / 2; // 2.5
  const cy = (ROWS - 1) / 2; // 4.5
  // Max possible distance from center to a corner cell-centre (used for normalisation)
  const MAX_DIST = Math.sqrt(cx * cx + cy * cy); // ≈ 5.148 grid units

  // Half-cell radius of the 2×2 bullseye block from the grid centre
  const BULLSEYE_DIST = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5); // ≈ 0.707 grid units

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
      gap: 3,
      padding: "6px",
      width: "100%",
      height: "100%",
    }}>
      {cells.map(({ i, row, col }) => {
        // Raw distance from grid centre in grid units
        const dx = col - cx;
        const dy = row - cy;
        const rawDist = Math.sqrt(dx * dx + dy * dy);

        // Cells whose centre falls within the 2×2 bullseye block score 100%
        // (the 4 centre cells: rows 4-5, cols 2-3 on a 10×6 grid)
        const isBullseye = rawDist <= BULLSEYE_DIST;

        // Normalise: bullseye → 0, outer corner → 1
        const dist = isBullseye ? 0 : Math.min(1, (rawDist - BULLSEYE_DIST) / (MAX_DIST - BULLSEYE_DIST));

        // accuracy mode ring color — bands keyed to the normalised dist
        let ringColor = null;
        if (mode === "Accuracy") {
          if (isBullseye)        ringColor = "rgba(0,255,120,0.50)";
          else if (dist < 0.33)  ringColor = "rgba(0,220,255,0.30)";
          else if (dist < 0.66)  ringColor = "rgba(255,160,0,0.22)";
          else                   ringColor = "rgba(255,60,60,0.16)";
        }

        // Target mode zone tint — highlight the cued zone region
        let zoneHighlight = null;
        if (mode === "Target" && targetZone) {
          const b = zoneBounds(targetZone);
          const inZone = row >= b.rowStart && row <= b.rowEnd && col >= b.colStart && col <= b.colEnd;
          if (inZone) zoneHighlight = "rgba(0,255,136,0.18)";
        }

        const isHot = impacts.some(imp => imp.cellIndex === i);
        const isHovered = hoveredZone === i;
        const accentColor = MODE_META[mode].color;

        return (
          <div
            key={i}
            className="ts-sim-cell"
            onMouseEnter={() => onZoneEnter(i)}
            onMouseLeave={onZoneLeave}
            onClick={() => onZoneClick(i, row, col)}
            style={{
              borderRadius: 4,
              cursor: "pointer",
              transition: "background 200ms, box-shadow 200ms, transform 120ms",
              background: isHot
                ? `${accentColor}cc`
                : ringColor
                ? ringColor
                : zoneHighlight
                ? zoneHighlight
                : isHovered
                ? `${accentColor}22`
                : "rgba(255,255,255,0.04)",
              boxShadow: isHot
                ? `0 0 10px 2px ${accentColor}88`
                : isHovered
                ? `0 0 6px 1px ${accentColor}44`
                : "none",
              transform: isHot ? "scale(1.12)" : isHovered ? "scale(1.05)" : "scale(1)",
              ...(isHovered && !isHot ? { borderColor: `${accentColor}55` } : {}),
              minHeight: 20,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Sub-component: ReactionOverlay ──────────────────────────────────────────

function ReactionOverlay({ phase, countdown, reactionMs }) {
  if (phase === "idle") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8, zIndex: 5,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase" }}>
        Click BAG to start
      </div>
    </div>
  );

  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.55)", borderRadius: 12,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
        Get ready...
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1s ease-in-out infinite",
      }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.3)" }} />
      </div>
    </div>
  );

  if (phase === "signal") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(255,200,0,0.18)", borderRadius: 12,
      pointerEvents: "none",
      animation: "tsFlashIn 0.15s ease-out",
    }}>
      <div style={{
        fontSize: 32, fontWeight: 900, color: "#ffcc00",
        textShadow: "0 0 24px #ffcc00, 0 0 48px rgba(255,200,0,0.6)",
        letterSpacing: 2, animation: "tsSignalPop 0.2s ease-out",
      }}>HIT!</div>
      <div style={{ fontSize: 11, color: "rgba(255,200,0,0.7)", letterSpacing: 3, textTransform: "uppercase", marginTop: 4 }}>
        Strike now
      </div>
    </div>
  );

  if (phase === "result") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.45)", borderRadius: 12,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,200,0,0.7)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
        Reaction Time
      </div>
      <div style={{
        fontSize: 36, fontWeight: 900,
        color: reactionMs < 300 ? "#00ff88" : reactionMs < 500 ? "#ffcc00" : "#ff6060",
        textShadow: `0 0 20px ${reactionMs < 300 ? "#00ff88" : reactionMs < 500 ? "#ffcc00" : "#ff6060"}`,
        animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {reactionMs}ms
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
        {reactionMs < 250 ? "Elite" : reactionMs < 350 ? "Sharp" : reactionMs < 500 ? "Good" : "Keep Training"}
      </div>
    </div>
  );

  return null;
}

// ─── Sub-component: VolumeOverlay ────────────────────────────────────────────

function VolumeOverlay({ phase, remainingMs, hits, bestHits }) {
  const VOL_COLOR = "#ff6a00";
  const pct = Math.min(1, remainingMs / 5000);
  const r = 24, circ = 2 * Math.PI * r;

  if (phase === "idle") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8, zIndex: 5,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase" }}>
        Click BAG to start
      </div>
    </div>
  );

  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.55)", borderRadius: 12, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
        Get ready...
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1s ease-in-out infinite",
      }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.3)" }} />
      </div>
    </div>
  );

  if (phase === "early") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(255,60,60,0.18)", borderRadius: 12, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6060" }}>Too Early!</div>
      <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", marginTop: 6, letterSpacing: 1 }}>Wait for the signal</div>
    </div>
  );

  if (phase === "signal") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(255,106,0,0.12)", borderRadius: 12, pointerEvents: "none",
      animation: "tsFlashInVol 0.15s ease-out",
    }}>
      {/* Countdown ring */}
      <div style={{ position: "relative", width: 64, height: 64, marginBottom: 10 }}>
        <svg width="64" height="64" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,106,0,0.15)" strokeWidth="4" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={VOL_COLOR} strokeWidth="4"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 100ms linear" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 900, color: VOL_COLOR,
        }}>
          {(remainingMs / 1000).toFixed(1)}s
        </div>
      </div>
      {/* Hit counter */}
      <div style={{
        fontSize: 36, fontWeight: 900, color: VOL_COLOR, lineHeight: 1,
        textShadow: `0 0 20px ${VOL_COLOR}, 0 0 40px rgba(255,106,0,0.5)`,
        animation: hits > 0 ? "tsResultPop 0.15s cubic-bezier(0.34,1.56,0.64,1)" : "none",
      }}>
        {hits}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,106,0,0.7)", letterSpacing: 2, textTransform: "uppercase", marginTop: 4 }}>
        strikes
      </div>
    </div>
  );

  if (phase === "result") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.50)", borderRadius: 12, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,106,0,0.8)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
        Window Complete
      </div>
      <div style={{
        fontSize: 48, fontWeight: 900, color: VOL_COLOR, lineHeight: 1,
        textShadow: `0 0 24px ${VOL_COLOR}`,
        animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {hits}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
        {bestHits != null && hits >= bestHits ? "🏆 New best!" : `Best: ${bestHits ?? hits}`}
      </div>
    </div>
  );

  return null;
}

// ─── Sub-component: TargetOverlay ─────────────────────────────────────────────

function TargetOverlay({ phase, zone, reactionMs, correct, attempts, correctHits }) {
  const TGT_COLOR = "#00ff88";
  const TGT_GLOW  = "rgba(0,255,136,0.55)";

  const zoneLabel = (z) =>
    z ? `${z.row.charAt(0).toUpperCase() + z.row.slice(1)} ${z.col.charAt(0).toUpperCase() + z.col.slice(1)}` : "";

  const accPct = attempts > 0 ? Math.round((correctHits / attempts) * 100) : null;

  if (phase === "idle") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8, zIndex: 5,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase" }}>
        Click BAG to start
      </div>
    </div>
  );

  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.55)", borderRadius: 12, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
        Get ready...
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1s ease-in-out infinite",
      }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.3)" }} />
      </div>
    </div>
  );

  if (phase === "early") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(255,60,60,0.18)", borderRadius: 12, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6060" }}>Too Early!</div>
      <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", marginTop: 6, letterSpacing: 1 }}>Wait for the zone cue</div>
    </div>
  );

  if (phase === "signal" && zone) return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 5,
      background: "rgba(0,0,0,0.68)", borderRadius: 12, pointerEvents: "none",
      animation: "tsFlashIn 0.15s ease-out",
    }}>
      <div style={{
        fontSize: 22, fontWeight: 900, color: TGT_COLOR,
        textShadow: `0 0 20px ${TGT_COLOR}, 0 0 40px ${TGT_GLOW}`,
        letterSpacing: 2, textTransform: "uppercase", marginBottom: 14,
        animation: "tsSignalPop 0.2s ease-out",
      }}>
        {zoneLabel(zone)}
      </div>
      {/* 3×3 zone grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gridTemplateRows: "repeat(3, 34px)", gap: 4 }}>
        {["top","middle","bottom"].map(r =>
          ["left","center","right"].map(c => {
            const isTarget = zone.row === r && zone.col === c;
            return (
              <div key={`${r}-${c}`} style={{
                borderRadius: 6,
                border: isTarget ? `2px solid ${TGT_COLOR}` : "1px solid rgba(255,255,255,0.15)",
                background: isTarget ? `${TGT_COLOR}28` : "rgba(255,255,255,0.03)",
                boxShadow: isTarget ? `0 0 12px 2px ${TGT_GLOW}` : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 700,
                color: isTarget ? TGT_COLOR : "rgba(255,255,255,0.20)",
                textTransform: "uppercase", letterSpacing: "0.04em",
              }}>
                {isTarget ? "●" : ""}
              </div>
            );
          })
        )}
      </div>
      <div style={{ fontSize: 10, color: `${TGT_COLOR}88`, letterSpacing: 2, textTransform: "uppercase", marginTop: 12 }}>
        Strike now
      </div>
      {accPct != null && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", marginTop: 8 }}>
          {correctHits}/{attempts} correct · {accPct}%
        </div>
      )}
    </div>
  );

  if (phase === "result") {
    const rtColor = correct
      ? (reactionMs < 350 ? "#00ff88" : reactionMs < 600 ? "#ffcc00" : "#ff9900")
      : "#ff6060";
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", zIndex: 5,
        background: "rgba(0,0,0,0.50)", borderRadius: 12, pointerEvents: "none",
      }}>
        <div style={{
          fontSize: 13, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6,
          color: correct ? TGT_COLOR : "#ff6060",
          animation: "tsSignalPop 0.2s ease-out",
        }}>
          {correct ? "✓ Correct Zone" : "✗ Wrong Zone"}
        </div>
        {correct && (
          <>
            <div style={{
              fontSize: 36, fontWeight: 900, color: rtColor, lineHeight: 1,
              textShadow: `0 0 20px ${rtColor}`,
              animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
            }}>
              {reactionMs}ms
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              {reactionMs < 300 ? "Elite" : reactionMs < 450 ? "Sharp" : reactionMs < 600 ? "Good" : "Keep Training"}
            </div>
          </>
        )}
        {accPct != null && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", marginTop: 10 }}>
            {correctHits}/{attempts} correct · {accPct}%
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HitSimulator() {
  const [mode, setMode] = useState("Power");
  const [impacts, setImpacts] = useState([]);
  const [ripples, setRipples] = useState([]);
  const [hoveredZone, setHoveredZone] = useState(null);
  const [sessionStats, setSessionStats] = useState({ hits: 0, avgIndex: 0, peakIndex: 0, accuracy: null });

  // Reaction mode state
  const [rxPhase, setRxPhase] = useState("idle"); // idle | waiting | signal | result
  const [rxTime, setRxTime] = useState(null);
  const rxSignalAt = useRef(null);
  const rxTimer = useRef(null);

  // Volume mode state
  const VOLUME_WINDOW_MS = 5000;
  const [volPhase, setVolPhase] = useState("idle"); // idle | waiting | early | signal | result
  const [volHits, setVolHits] = useState(0);
  const [volBest, setVolBest] = useState(null);
  const [volRemainingMs, setVolRemainingMs] = useState(0);
  const volHitsRef = useRef(0);
  const volWindowEndsAt = useRef(null);
  const volTimer = useRef(null);
  const volTickTimer = useRef(null);

  // Target mode state
  const [tgtPhase, setTgtPhase] = useState("idle"); // idle | waiting | early | signal | result
  const [tgtZone, setTgtZone] = useState(null);
  const [tgtReactMs, setTgtReactMs] = useState(null);
  const [tgtCorrect, setTgtCorrect] = useState(null);
  const [tgtAttempts, setTgtAttempts] = useState(0);
  const [tgtCorrectHits, setTgtCorrectHits] = useState(0);
  const [tgtBestMs, setTgtBestMs] = useState(null);
  const tgtZoneRef = useRef(null);
  const tgtSignalAt = useRef(null);
  const tgtTimer = useRef(null);
  const tgtPhaseRef = useRef("idle");

  const rippleIdRef = useRef(0);
  const lastHitAt = useRef(null); // wall-clock ms of previous hit, for IEI
  const ROWS = 10, COLS = 6;

  // ── Cleanup on mode switch
  useEffect(() => {
    setImpacts([]);
    setRipples([]);
    setSessionStats({ hits: 0, avgIndex: 0, peakIndex: 0, accuracy: null });
    // Reaction
    setRxPhase("idle");
    setRxTime(null);
    rxSignalAt.current = null;
    clearTimeout(rxTimer.current);
    // Volume
    clearTimeout(volTimer.current);
    clearInterval(volTickTimer.current);
    setVolPhase("idle");
    setVolHits(0);
    setVolBest(null);
    setVolRemainingMs(0);
    volHitsRef.current = 0;
    volWindowEndsAt.current = null;
    // Target
    clearTimeout(tgtTimer.current);
    setTgtPhase("idle");
    setTgtZone(null);
    setTgtReactMs(null);
    setTgtCorrect(null);
    setTgtAttempts(0);
    setTgtCorrectHits(0);
    setTgtBestMs(null);
    tgtZoneRef.current = null;
    tgtSignalAt.current = null;
    tgtPhaseRef.current = "idle";
    lastHitAt.current  = null;
  }, [mode]);

  // ── Impact ripple cleanup
  const removeRipple = useCallback((id) => {
    setRipples(r => r.filter(x => x.id !== id));
  }, []);

  // ── Core hit handler
  const handleHit = useCallback((cellIndex, row, col) => {
    const ROWS = 10, COLS = 6;
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    const dx = (col - cx) / cx, dy = (row - cy) / cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const xPct = ((col + 0.5) / COLS) * 100;
    const yPct = ((row + 0.5) / ROWS) * 100;

    // ── Reaction ──────────────────────────────────────────────────────────────
    if (mode === "Reaction") {
      if (rxPhase === "idle") {
        setRxPhase("waiting");
        const delay = 1500 + Math.random() * 2000;
        rxTimer.current = setTimeout(() => {
          setRxPhase("signal");
          rxSignalAt.current = performance.now();
        }, delay);
        return;
      }
      if (rxPhase === "waiting") {
        clearTimeout(rxTimer.current);
        setRxTime(999);
        setRxPhase("result");
        setTimeout(() => setRxPhase("idle"), 2200);
        return;
      }
      if (rxPhase === "signal") {
        const rt = Math.round(performance.now() - rxSignalAt.current);
        setRxTime(rt);
        setRxPhase("result");
        const rid = ++rippleIdRef.current;
        setRipples(r => [...r, { id: rid, x: xPct, y: yPct }]);
        setImpacts(prev => [{ cellIndex, ts: Date.now() }, ...prev].slice(0, 4));
        setTimeout(() => setRxPhase("idle"), 2200);
        setSessionStats(s => ({ ...s, hits: s.hits + 1 }));
        return;
      }
      return;
    }

    // ── Volume ────────────────────────────────────────────────────────────────
    if (mode === "Volume") {
      if (volPhase === "idle") {
        // First click starts the waiting phase
        setVolPhase("waiting");
        volHitsRef.current = 0;
        setVolHits(0);
        const delay = 1500 + Math.random() * 2000;
        volTimer.current = setTimeout(() => {
          const endsAt = performance.now() + VOLUME_WINDOW_MS;
          volWindowEndsAt.current = endsAt;
          setVolPhase("signal");
          setVolRemainingMs(VOLUME_WINDOW_MS);
          // Tick the countdown every 50ms
          clearInterval(volTickTimer.current);
          volTickTimer.current = setInterval(() => {
            const rem = Math.max(0, Math.round(volWindowEndsAt.current - performance.now()));
            setVolRemainingMs(rem);
          }, 50);
          // End the window after 5s
          volTimer.current = setTimeout(() => {
            clearInterval(volTickTimer.current);
            setVolPhase("result");
            setVolBest(prev => prev === null ? volHitsRef.current : Math.max(prev, volHitsRef.current));
            setTimeout(() => {
              // Auto-start next round after showing result
              setVolPhase("waiting");
              volHitsRef.current = 0;
              setVolHits(0);
              const d2 = 1500 + Math.random() * 2000;
              volTimer.current = setTimeout(() => {
                const e2 = performance.now() + VOLUME_WINDOW_MS;
                volWindowEndsAt.current = e2;
                setVolPhase("signal");
                setVolRemainingMs(VOLUME_WINDOW_MS);
                clearInterval(volTickTimer.current);
                volTickTimer.current = setInterval(() => {
                  const rem = Math.max(0, Math.round(volWindowEndsAt.current - performance.now()));
                  setVolRemainingMs(rem);
                }, 50);
                volTimer.current = setTimeout(() => {
                  clearInterval(volTickTimer.current);
                  setVolPhase("result");
                  setVolBest(prev => prev === null ? volHitsRef.current : Math.max(prev, volHitsRef.current));
                  setTimeout(() => setVolPhase("idle"), 2200);
                }, VOLUME_WINDOW_MS);
              }, d2);
            }, 2000);
          }, VOLUME_WINDOW_MS);
        }, delay);
        return;
      }
      if (volPhase === "waiting") {
        // Hit before signal — penalise
        clearTimeout(volTimer.current);
        setVolPhase("early");
        setTimeout(() => {
          setVolPhase("waiting");
          const delay = 1500 + Math.random() * 2000;
          volTimer.current = setTimeout(() => {
            const endsAt = performance.now() + VOLUME_WINDOW_MS;
            volWindowEndsAt.current = endsAt;
            setVolPhase("signal");
            setVolRemainingMs(VOLUME_WINDOW_MS);
            clearInterval(volTickTimer.current);
            volTickTimer.current = setInterval(() => {
              const rem = Math.max(0, Math.round(volWindowEndsAt.current - performance.now()));
              setVolRemainingMs(rem);
            }, 50);
            volTimer.current = setTimeout(() => {
              clearInterval(volTickTimer.current);
              setVolBest(prev => prev === null ? volHitsRef.current : Math.max(prev, volHitsRef.current));
              setVolPhase("result");
              setTimeout(() => setVolPhase("idle"), 2200);
            }, VOLUME_WINDOW_MS);
          }, delay);
        }, 1500);
        return;
      }
      if (volPhase === "signal") {
        if (performance.now() <= volWindowEndsAt.current) {
          volHitsRef.current += 1;
          setVolHits(volHitsRef.current);
          const now = Date.now();
          const iei = lastHitAt.current == null ? null : now - lastHitAt.current;
          lastHitAt.current = now;
          const force = +(18 + Math.random() * 22 - dist * 8).toFixed(1);
          const si = strengthIndex(force, iei);
          const rid = ++rippleIdRef.current;
          setRipples(r => [...r, { id: rid, x: xPct, y: yPct, color: MODE_META["Volume"].color }]);
          setImpacts(prev => [{ cellIndex, si, ts: now }, ...prev].slice(0, 6));
          setSessionStats(s => {
            const newHits = s.hits + 1;
            const newAvg  = Math.round((s.avgIndex * s.hits + si) / newHits);
            const newPeak = Math.max(s.peakIndex, si);
            return { ...s, hits: newHits, avgIndex: newAvg, peakIndex: newPeak };
          });
        }
        return;
      }
      return;
    }

    // ── Target ────────────────────────────────────────────────────────────────
    if (mode === "Target") {
      if (tgtPhase === "idle") {
        // First click — start waiting then cue a zone
        setTgtPhase("waiting");
        tgtPhaseRef.current = "waiting";
        const delay = 1500 + Math.random() * 2000;
        tgtTimer.current = setTimeout(() => {
          const zone = randomZone();
          tgtZoneRef.current = zone;
          tgtSignalAt.current = performance.now();
          setTgtZone(zone);
          setTgtPhase("signal");
          tgtPhaseRef.current = "signal";
        }, delay);
        return;
      }
      if (tgtPhase === "waiting") {
        // Too early
        clearTimeout(tgtTimer.current);
        setTgtPhase("early");
        tgtPhaseRef.current = "early";
        setTimeout(() => {
          const zone = randomZone();
          tgtZoneRef.current = zone;
          tgtSignalAt.current = performance.now();
          setTgtZone(zone);
          setTgtPhase("signal");
          tgtPhaseRef.current = "signal";
        }, 1500);
        return;
      }
      if (tgtPhase === "signal" && tgtZoneRef.current) {
        const rt = Math.round(performance.now() - tgtSignalAt.current);
        const struck = cellToZone(row, col);
        const correct = zonesMatch(struck, tgtZoneRef.current);
        setTgtReactMs(rt);
        setTgtCorrect(correct);
        setTgtAttempts(a => a + 1);
        if (correct) {
          setTgtCorrectHits(h => h + 1);
          setTgtBestMs(prev => prev === null ? rt : Math.min(prev, rt));
        }
        setTgtPhase("result");
        tgtPhaseRef.current = "result";
        const rid = ++rippleIdRef.current;
        const hitColor = correct ? "#00ff88" : "#ff6060";
        setRipples(r => [...r, { id: rid, x: xPct, y: yPct, color: hitColor }]);
        setImpacts(prev => [{ cellIndex, correct, rt, ts: Date.now() }, ...prev].slice(0, 4));
        setSessionStats(s => ({ ...s, hits: s.hits + 1 }));
        // Schedule next attempt
        setTimeout(() => {
          const zone = randomZone();
          tgtZoneRef.current = zone;
          tgtSignalAt.current = performance.now();
          setTgtZone(zone);
          setTgtPhase("signal");
          tgtPhaseRef.current = "signal";
        }, 2200);
        return;
      }
      return;
    }

    // ── Power / Accuracy ───────────────────────────────────────────────────
    const force = +(18 + Math.random() * 22 - dist * 8).toFixed(1);
    const speed = +(4.5 + Math.random() * 5 - dist * 1.5).toFixed(1);

    let accScore = null;
    if (mode === "Accuracy") {
      const MAX_DIST_H = Math.sqrt(cx * cx + cy * cy);
      const BULL_DIST  = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);
      const rawD       = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
      const normDist   = rawD <= BULL_DIST ? 0 : Math.min(1, (rawD - BULL_DIST) / (MAX_DIST_H - BULL_DIST));
      accScore = Math.round((1 - normDist) * 100);
    }

    const now = Date.now();
    const iei = lastHitAt.current == null ? null : now - lastHitAt.current;
    lastHitAt.current = now;
    const si = strengthIndex(force, iei);

    const rid = ++rippleIdRef.current;
    setRipples(r => [...r, { id: rid, x: xPct, y: yPct, color: MODE_META[mode].color }]);
    setImpacts(prev => [{ cellIndex, force, speed, accScore, si, ts: now }, ...prev].slice(0, 3));
    setSessionStats(s => {
      const newHits  = s.hits + 1;
      const newAvg   = Math.round((s.avgIndex * s.hits + si) / newHits);
      const newPeak  = Math.max(s.peakIndex, si);
      const newAcc   = mode === "Accuracy"
        ? +((( (s.accuracy || 0) * s.hits + accScore) / newHits)).toFixed(0)
        : null;
      return { hits: newHits, avgIndex: newAvg, peakIndex: newPeak, accuracy: newAcc };
    });
  }, [mode, rxPhase, volPhase, tgtPhase]);

  const meta = MODE_META[mode];
  const accentColor = meta.color;

  return (
    <>
      <style>{`
        @keyframes tsCorePulse {
          0%   { opacity: 1; transform: scale(1); }
          60%  { opacity: 0.7; transform: scale(1.5); }
          100% { opacity: 0; transform: scale(0.5); }
        }
        @keyframes tsRipple {
          0%   { opacity: 0.9; transform: translate(-50%,-50%) scale(0.5); }
          100% { opacity: 0;   transform: translate(-50%,-50%) scale(4); }
        }
        @keyframes tsPulseWait {
          0%,100% { opacity: 0.4; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes tsFlashIn {
          0%   { background: rgba(255,200,0,0.45); }
          100% { background: rgba(255,200,0,0.18); }
        }
        @keyframes tsFlashInVol {
          0%   { background: rgba(255,106,0,0.35); }
          100% { background: rgba(255,106,0,0.12); }
        }
        @keyframes tsSignalPop {
          0%   { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes tsResultPop {
          0%   { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes tsModeIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes tsImpactIn {
          0%   { opacity: 0; transform: translateX(-10px); }
          100% { opacity: 1; transform: translateX(0); }
        }

        .ts-sim-root {
          font-family: inherit;
          background: transparent;
          color: var(--text);
          padding: 0;
        }

        .ts-sim-modeTabs {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 14px;
          padding: 5px;
        }

        @media (max-width: 560px) {
          .ts-sim-modeTabs {
            gap: 4px;
            margin-bottom: 14px;
            border-radius: 12px;
            padding: 4px;
          }
        }

        .ts-sim-modeTab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 10px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.3px;
          transition: all 200ms ease;
          background: transparent;
          color: var(--muted);
        }

        .ts-sim-modeTabIcon {
          font-size: 18px;
          line-height: 1;
        }

        @media (max-width: 560px) {
          .ts-sim-modeTab {
            padding: 8px 6px;
            font-size: 11px;
            border-radius: 8px;
            letter-spacing: 0;
          }
        }

        .ts-sim-modeTab:hover {
          color: var(--text);
          background: var(--panel);
        }

        .ts-sim-modeTab.active {
          color: #fff;
          font-weight: 800;
        }

        .ts-sim-layout {
          display: grid;
          grid-template-columns: 1fr 220px;
          gap: 16px;
        }

        /* ── Tablet: tighten side panel ── */
        @media (max-width: 720px) {
          .ts-sim-layout {
            grid-template-columns: 1fr 180px;
            gap: 12px;
          }
        }

        /* ── Mobile: full vertical stack ── */
        @media (max-width: 560px) {
          .ts-sim-layout {
            grid-template-columns: 1fr;
            gap: 10px;
          }
        }

        .ts-sim-bagWrap {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          backdrop-filter: blur(12px);
          aspect-ratio: 0.65;
          cursor: crosshair;
          transition: border-color 300ms;
          user-select: none;
        }

        /* Tablet: slightly wider bag */
        @media (max-width: 720px) {
          .ts-sim-bagWrap {
            aspect-ratio: 0.75;
          }
        }

        /* Mobile: short, wide bag — fits in viewport without scrolling */
        @media (max-width: 560px) {
          .ts-sim-bagWrap {
            aspect-ratio: unset;
            height: 300px;
          }
        }

        .ts-sim-bagWrap:hover {
          border-color: rgba(180,0,255,0.28);
        }

        .ts-sim-bagLabel {
          position: absolute;
          top: 10px; left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          opacity: 0.35;
          pointer-events: none;
          z-index: 4;
          white-space: nowrap;
        }

        .ts-sim-accuracyGuide {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3;
        }

        .ts-sim-ring {
          position: absolute;
          border-radius: 50%;
          border-width: 1px;
          border-style: solid;
          transform: translate(-50%, -50%);
          left: 50%; top: 50%;
          pointer-events: none;
        }

        .ts-sim-sidePanel {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* Mobile: side panel becomes a compact horizontal strip */
        @media (max-width: 560px) {
          .ts-sim-sidePanel {
            flex-direction: row;
            flex-wrap: wrap;
            gap: 8px;
          }
        }

        .ts-sim-infoCard {
          border-radius: 14px;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          padding: 14px 16px;
          animation: tsModeIn 0.35s ease;
        }

        @media (max-width: 560px) {
          .ts-sim-infoCard {
            flex: 1;
            min-width: 0;
            padding: 10px 12px;
            border-radius: 12px;
          }
          .ts-sim-modeDesc { display: none; }
          .ts-sim-bullets   { display: none; }
        }

        .ts-sim-modeIcon {
          font-size: 20px;
          margin-bottom: 6px;
        }

        .ts-sim-modeName {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.2px;
          margin-bottom: 4px;
        }

        .ts-sim-modeDesc {
          font-size: 12px;
          color: var(--muted);
          line-height: 1.55;
          margin-bottom: 10px;
        }

        .ts-sim-bullets {
          list-style: none;
          padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 5px;
        }

        .ts-sim-bullets li {
          font-size: 11px;
          color: var(--muted);
          padding-left: 14px;
          position: relative;
        }

        .ts-sim-bullets li::before {
          content: "→";
          position: absolute; left: 0;
          font-size: 10px;
        }

        .ts-sim-statsCard {
          border-radius: 14px;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          padding: 14px 16px;
        }

        @media (max-width: 560px) {
          .ts-sim-statsCard {
            flex: 1;
            min-width: 0;
            padding: 10px 12px;
            border-radius: 12px;
          }
        }

        .ts-sim-statsTitle {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 10px;
        }

        .ts-sim-statsGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .ts-sim-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .ts-sim-statLabel {
          font-size: 10px;
          color: var(--muted);
          letter-spacing: 0.5px;
        }

        .ts-sim-statVal {
          font-size: 18px;
          font-weight: 800;
          line-height: 1;
        }

        @media (max-width: 560px) {
          .ts-sim-statVal { font-size: 15px; }
          .ts-sim-statsGrid { gap: 6px; }
          .ts-sim-statsTitle { margin-bottom: 6px; }
          .ts-sim-modeIcon  { font-size: 16px; margin-bottom: 4px; }
          .ts-sim-modeName  { font-size: 13px; }
        }

        .ts-sim-impactFeed {
          border-radius: 14px;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          padding: 14px 16px;
          min-height: 80px;
        }

        @media (max-width: 560px) {
          .ts-sim-impactFeed { display: none; }
          .ts-sim-hintText   { display: none; }
        }

        .ts-sim-feedTitle {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .ts-sim-feedItem {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 0;
          border-bottom: 1px solid var(--panel-border);
          animation: tsImpactIn 0.2s ease;
          font-size: 12px;
        }

        .ts-sim-feedItem:last-child { border-bottom: none; }

        .ts-sim-feedLabel { color: var(--muted); }
        .ts-sim-feedVal { font-weight: 700; color: var(--text); }

        .ts-sim-hintText {
          text-align: center;
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-top: 8px;
        }

        .ts-sim-cell {
          border: 1px solid var(--panel-border);
        }

        :root:not([data-theme="light"]) .ts-sim-cell {
          border-color: rgba(255, 255, 255, 0.14);
        }

        :root[data-theme="light"] .ts-sim-cell {
          border-color: rgba(0, 0, 0, 0.14);
        }
      `}</style>

      <div className="ts-sim-root">
        {/* Mode selector */}
        <div style={{ maxWidth: 760, margin: "0 auto 24px" }}>
          <div className="ts-sim-modeTabs">
            {MODES.map(m => (
              <button
                key={m}
                className={`ts-sim-modeTab ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
                style={mode === m ? {
                  background: `${MODE_META[m].color}22`,
                  color: MODE_META[m].color,
                  boxShadow: `0 0 0 1px ${MODE_META[m].color}55`,
                } : {}}
              >
                <span className="ts-sim-modeTabIcon">{MODE_META[m].icon}</span>
                <span className="ts-sim-modeTabLabel">{m}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ts-sim-layout">
          {/* Bag */}
          <div
            className="ts-sim-bagWrap"
            style={{ boxShadow: `0 0 40px -10px ${accentColor}33, inset 0 0 60px -20px ${accentColor}11` }}
          >
            <div className="ts-sim-bagLabel">Heavy Bag — 96 Zones</div>

            {/* Watermark logo, centered behind the hit grid */}
            <img
              src={tsLogoMark}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "85%",
                maxWidth: 360,
                opacity: 0.14,
                pointerEvents: "none",
                userSelect: "none",
                zIndex: 0,
              }}
            />

            {/* Accuracy rings */}
            {mode === "Accuracy" && (
              <div className="ts-sim-accuracyGuide">
                {[
                  { size: "22%", color: "rgba(0,255,120,0.55)", label: "×3" },
                  { size: "44%", color: "rgba(0,220,255,0.35)" },
                  { size: "68%", color: "rgba(255,160,0,0.25)" },
                  { size: "90%", color: "rgba(255,60,60,0.18)" },
                ].map((r, i) => (
                  <div
                    key={i}
                    className="ts-sim-ring"
                    style={{
                      width: r.size, paddingBottom: r.size,
                      borderColor: r.color,
                    }}
                  />
                ))}
                {/* Bullseye dot */}
                <div style={{
                  position: "absolute", width: 10, height: 10,
                  borderRadius: "50%", background: "rgba(0,255,120,0.9)",
                  boxShadow: "0 0 10px 4px rgba(0,255,120,0.5)",
                  pointerEvents: "none",
                }} />
              </div>
            )}

            {/* Reaction overlay */}
            {mode === "Reaction" && (
              <ReactionOverlay phase={rxPhase} reactionMs={rxTime} />
            )}

            {/* Volume overlay */}
            {mode === "Volume" && (
              <VolumeOverlay
                phase={volPhase}
                remainingMs={volRemainingMs}
                hits={volHits}
                bestHits={volBest}
              />
            )}

            {/* Target overlay */}
            {mode === "Target" && (
              <TargetOverlay
                phase={tgtPhase}
                zone={tgtZone}
                reactionMs={tgtReactMs}
                correct={tgtCorrect}
                attempts={tgtAttempts}
                correctHits={tgtCorrectHits}
              />
            )}

            {/* Hit grid */}
            <div style={{ position: "absolute", inset: 0 }}>
              <BagGrid
                mode={mode}
                impacts={impacts}
                hoveredZone={hoveredZone}
                onZoneEnter={setHoveredZone}
                onZoneLeave={() => setHoveredZone(null)}
                onZoneClick={handleHit}
                activeMode={mode}
                targetZone={mode === "Target" && tgtPhase === "signal" ? tgtZone : null}
              />
            </div>

            {/* Ripples */}
            {ripples.map(r => (
              <ImpactRipple
                key={r.id}
                id={r.id}
                x={r.x}
                y={r.y}
                color={r.color || accentColor}
                onDone={() => removeRipple(r.id)}
              />
            ))}

            {/* Glow edge */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: `radial-gradient(ellipse at 50% 100%, ${accentColor}18 0%, transparent 65%)`,
              transition: "background 500ms",
            }} />
          </div>

          {/* Side panel */}
          <div className="ts-sim-sidePanel">

            {/* Mode info */}
            <div className="ts-sim-infoCard" key={mode} style={{ borderColor: `${accentColor}33` }}>
              <div className="ts-sim-modeIcon">{meta.icon}</div>
              <div className="ts-sim-modeName" style={{ color: accentColor }}>{mode} Mode</div>
              <div className="ts-sim-modeDesc">{meta.desc}</div>
              <ul className="ts-sim-bullets">
                {meta.bullets.map(b => (
                  <li key={b} style={{ "--bullet-color": accentColor }}>{b}</li>
                ))}
              </ul>
            </div>

            {/* Session stats */}
            {mode === "Power" || mode === "Accuracy" ? (
              <div className="ts-sim-statsCard">
                <div className="ts-sim-statsTitle">Session</div>
                <div className="ts-sim-statsGrid">
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Strikes</span>
                    <span className="ts-sim-statVal" style={{ color: accentColor }}>{sessionStats.hits}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Avg Index</span>
                    <span className="ts-sim-statVal">{sessionStats.avgIndex || "—"}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Peak Index</span>
                    <span className="ts-sim-statVal">{sessionStats.peakIndex || "—"}</span>
                  </div>
                  {mode === "Accuracy" && (
                    <div className="ts-sim-stat">
                      <span className="ts-sim-statLabel">Accuracy</span>
                      <span className="ts-sim-statVal" style={{ color: accentColor }}>{sessionStats.accuracy != null ? `${sessionStats.accuracy}%` : "—"}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : mode === "Reaction" ? (
              <div className="ts-sim-statsCard">
                <div className="ts-sim-statsTitle">Session</div>
                <div className="ts-sim-statsGrid">
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Attempts</span>
                    <span className="ts-sim-statVal" style={{ color: accentColor }}>{sessionStats.hits}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Best RT</span>
                    <span className="ts-sim-statVal">{rxTime || "—"}<span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{rxTime ? "ms" : ""}</span></span>
                  </div>
                </div>
              </div>
            ) : mode === "Volume" ? (
              <div className="ts-sim-statsCard">
                <div className="ts-sim-statsTitle">Session</div>
                <div className="ts-sim-statsGrid">
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">This Window</span>
                    <span className="ts-sim-statVal" style={{ color: accentColor }}>{volHits}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Best Window</span>
                    <span className="ts-sim-statVal">{volBest ?? "—"}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Avg SI</span>
                    <span className="ts-sim-statVal">{sessionStats.avgIndex || "—"}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Peak SI</span>
                    <span className="ts-sim-statVal">{sessionStats.peakIndex || "—"}</span>
                  </div>
                </div>
              </div>
            ) : mode === "Target" ? (
              <div className="ts-sim-statsCard">
                <div className="ts-sim-statsTitle">Session</div>
                <div className="ts-sim-statsGrid">
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Accuracy</span>
                    <span className="ts-sim-statVal" style={{ color: accentColor }}>
                      {tgtAttempts > 0 ? `${Math.round((tgtCorrectHits / tgtAttempts) * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Correct</span>
                    <span className="ts-sim-statVal">{tgtAttempts > 0 ? `${tgtCorrectHits}/${tgtAttempts}` : "—"}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Best RT</span>
                    <span className="ts-sim-statVal">{tgtBestMs != null ? `${tgtBestMs}` : "—"}<span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{tgtBestMs != null ? "ms" : ""}</span></span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Attempts</span>
                    <span className="ts-sim-statVal">{tgtAttempts}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Live impact feed */}
            {mode !== "Reaction" && mode !== "Volume" && mode !== "Target" && impacts.length > 0 && (
              <div className="ts-sim-impactFeed">
                <div className="ts-sim-feedTitle">Impact Feed</div>
                {impacts.map((imp, idx) => (
                  <div key={imp.ts + idx} className="ts-sim-feedItem">
                    <span className="ts-sim-feedLabel">{mode === "Accuracy" ? "Score" : "Strength Index"}</span>
                    <span className="ts-sim-feedVal" style={{ color: accentColor }}>
                      {mode === "Accuracy" ? `${imp.accScore}%` : imp.si}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Volume impact feed */}
            {mode === "Volume" && impacts.length > 0 && (
              <div className="ts-sim-impactFeed">
                <div className="ts-sim-feedTitle">Strike Feed</div>
                {impacts.map((imp, idx) => (
                  <div key={imp.ts + idx} className="ts-sim-feedItem">
                    <span className="ts-sim-feedLabel">SI</span>
                    <span className="ts-sim-feedVal" style={{ color: accentColor }}>{imp.si}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Target impact feed */}
            {mode === "Target" && impacts.length > 0 && (
              <div className="ts-sim-impactFeed">
                <div className="ts-sim-feedTitle">Attempt Feed</div>
                {impacts.map((imp, idx) => (
                  <div key={imp.ts + idx} className="ts-sim-feedItem">
                    <span className="ts-sim-feedLabel">{imp.correct ? "✓ Hit" : "✗ Miss"}</span>
                    <span className="ts-sim-feedVal" style={{ color: imp.correct ? "#00ff88" : "#ff6060" }}>
                      {imp.correct ? `${imp.rt}ms` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Hint */}
            <div className="ts-sim-hintText">
              {mode === "Reaction"
                ? rxPhase === "idle" ? "Click the bag to begin" : ""
                : mode === "Volume"
                ? volPhase === "idle" ? "Click the bag to begin" : ""
                : mode === "Target"
                ? tgtPhase === "idle" ? "Click the bag to begin" : ""
                : "Click any zone on the bag"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}