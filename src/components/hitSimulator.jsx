// src/components/hitSimulator.jsx
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types & Constants ────────────────────────────────────────────────────────

const MODES = ["Standard", "Accuracy", "Reaction"];

const MODE_META = {
  Standard: {
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
};

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

function BagGrid({ mode, impacts, hoveredZone, onZoneEnter, onZoneLeave, onZoneClick, activeMode }) {
  const ROWS = 10, COLS = 6;
  const cells = Array.from({ length: ROWS * COLS }, (_, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    return { i, row, col };
  });

  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;

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
        // distance from center (normalized 0-1)
        const dx = (col - cx) / cx;
        const dy = (row - cy) / cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // accuracy mode ring color
        let ringColor = null;
        if (mode === "Accuracy") {
          if (dist < 0.25) ringColor = "rgba(0,255,120,0.45)";
          else if (dist < 0.55) ringColor = "rgba(0,220,255,0.28)";
          else if (dist < 0.85) ringColor = "rgba(255,160,0,0.20)";
          else ringColor = "rgba(255,60,60,0.15)";
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HitSimulator() {
  const [mode, setMode] = useState("Standard");
  const [impacts, setImpacts] = useState([]);
  const [ripples, setRipples] = useState([]);
  const [hoveredZone, setHoveredZone] = useState(null);
  const [sessionStats, setSessionStats] = useState({ hits: 0, avgForce: 0, maxForce: 0, accuracy: null });

  // Reaction mode state
  const [rxPhase, setRxPhase] = useState("idle"); // idle | waiting | signal | result
  const [rxTime, setRxTime] = useState(null);
  const rxSignalAt = useRef(null);
  const rxTimer = useRef(null);

  const rippleIdRef = useRef(0);
  const ROWS = 10, COLS = 6;

  // ── Cleanup on mode switch
  useEffect(() => {
    setImpacts([]);
    setRipples([]);
    setSessionStats({ hits: 0, avgForce: 0, maxForce: 0, accuracy: null });
    setRxPhase("idle");
    setRxTime(null);
    rxSignalAt.current = null;
    clearTimeout(rxTimer.current);
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
    const dist = Math.sqrt(dx * dx + dy * dy); // 0 = center, ~1 = edge

    if (mode === "Reaction") {
      if (rxPhase === "idle") {
        // Start the sequence
        setRxPhase("waiting");
        const delay = 1500 + Math.random() * 2000;
        rxTimer.current = setTimeout(() => {
          setRxPhase("signal");
          rxSignalAt.current = performance.now();
        }, delay);
        return;
      }
      if (rxPhase === "waiting") {
        // Jumped the gun — penalize
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
        // add ripple at click point
        const xPct = ((col + 0.5) / COLS) * 100;
        const yPct = ((row + 0.5) / ROWS) * 100;
        const rid = ++rippleIdRef.current;
        setRipples(r => [...r, { id: rid, x: xPct, y: yPct }]);
        setImpacts(prev => {
          const next = [{ cellIndex, ts: Date.now() }, ...prev].slice(0, 4);
          return next;
        });
        setTimeout(() => setRxPhase("idle"), 2200);
        setSessionStats(s => ({ ...s, hits: s.hits + 1 }));
        return;
      }
      return;
    }

    // Standard / Accuracy modes
    const force = +(18 + Math.random() * 22 - dist * 8).toFixed(1);
    const speed = +(4.5 + Math.random() * 5 - dist * 1.5).toFixed(1);
    const accScore = mode === "Accuracy" ? Math.round((1 - Math.min(dist, 1)) * 100) : null;

    const xPct = ((col + 0.5) / COLS) * 100;
    const yPct = ((row + 0.5) / ROWS) * 100;
    const rid = ++rippleIdRef.current;
    setRipples(r => [...r, { id: rid, x: xPct, y: yPct, color: MODE_META[mode].color }]);
    setImpacts(prev => {
      const next = [{ cellIndex, force, speed, accScore, ts: Date.now() }, ...prev].slice(0, 3);
      return next;
    });
    setSessionStats(s => {
      const newHits = s.hits + 1;
      const newAvg = +((s.avgForce * s.hits + force) / newHits).toFixed(1);
      const newMax = Math.max(s.maxForce, force);
      const newAcc = mode === "Accuracy"
        ? +((( (s.accuracy || 0) * s.hits + accScore) / newHits)).toFixed(0)
        : null;
      return { hits: newHits, avgForce: newAvg, maxForce: newMax, accuracy: newAcc };
    });
  }, [mode, rxPhase]);

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
                {MODE_META[m].icon} {m}
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
            {mode !== "Reaction" && (
              <div className="ts-sim-statsCard">
                <div className="ts-sim-statsTitle">Session</div>
                <div className="ts-sim-statsGrid">
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Strikes</span>
                    <span className="ts-sim-statVal" style={{ color: accentColor }}>{sessionStats.hits}</span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Avg Force</span>
                    <span className="ts-sim-statVal">{sessionStats.avgForce || "—"}<span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{sessionStats.avgForce ? " lb" : ""}</span></span>
                  </div>
                  <div className="ts-sim-stat">
                    <span className="ts-sim-statLabel">Peak</span>
                    <span className="ts-sim-statVal">{sessionStats.maxForce || "—"}<span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{sessionStats.maxForce ? " lb" : ""}</span></span>
                  </div>
                  {mode === "Accuracy" && (
                    <div className="ts-sim-stat">
                      <span className="ts-sim-statLabel">Accuracy</span>
                      <span className="ts-sim-statVal" style={{ color: accentColor }}>{sessionStats.accuracy != null ? `${sessionStats.accuracy}%` : "—"}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reaction stats */}
            {mode === "Reaction" && (
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
            )}

            {/* Live impact feed */}
            {mode !== "Reaction" && impacts.length > 0 && (
              <div className="ts-sim-impactFeed">
                <div className="ts-sim-feedTitle">Impact Feed</div>
                {impacts.map((imp, idx) => (
                  <div key={imp.ts + idx} className="ts-sim-feedItem">
                    <span className="ts-sim-feedLabel">{mode === "Accuracy" ? `Score` : `Force`}</span>
                    <span className="ts-sim-feedVal" style={{ color: accentColor }}>
                      {mode === "Accuracy" ? `${imp.accScore}%` : `${imp.force} lb`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Hint */}
            <div className="ts-sim-hintText">
              {mode === "Reaction"
                ? rxPhase === "idle" ? "Click the bag to begin" : ""
                : "Click any zone on the bag"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}