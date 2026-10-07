// src/components/dashboard/SessionHeatmapCard.tsx
//
// Selected-session card on the coach dashboards: contact heatmap with live/history
// views and event replay, session and per-event stats, and the Strike Compass.
// Shared by the desktop and mobile dashboard pages.
import { Skel } from "./Skel";
import StrikeCompass from "../strikeCompass";
import { IconCompass } from "../icons";
import { LockBadge } from "../lockedFeature";
import type { CoachDashboard } from "../../hooks/useCoachDashboard";

export function SessionHeatmapCard({ dash }: { dash: CoachDashboard }) {
  const {
    activeEvent,
    activeEventIdx,
    ent,
    heatmapCells,
    heatmapLoading,
    heatmapRipples,
    heatmapViewMode,
    isDark,
    isReplaying,
    maxReplayHits,
    modeAccent,
    modeGlow,
    pauseReplay,
    pressureToColor,
    pressureToGlow,
    replayEvents,
    replayHeatmap,
    replaySpeed,
    replayTimeMs,
    resetReplay,
    resumeReplay,
    scheduleFrom,
    seekTo,
    selectedSessionId,
    sessionSummary,
    setHeatmapViewMode,
    setReplaySpeed,
    startReplay,
    summaryStats,
  } = dash;

  return (
    <div className="ts-card ts-heatmapCard">
      <div className="ts-cardTop">
        <div className="ts-cardTitle">Impact Heatmap</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {sessionSummary && (
            <div className="ts-summaryModePill" data-mode={(sessionSummary.mode ?? "power").toLowerCase()}>
              {(sessionSummary.mode ?? "power").charAt(0).toUpperCase() + (sessionSummary.mode ?? "power").slice(1)}
            </div>
          )}
          {/* Heatmap view mode toggle — show only for power mode (not accuracy) (not accuracy) */}
          {selectedSessionId && replayEvents.length > 0 && (() => {
            const mode = (sessionSummary?.mode ?? "power").toLowerCase();
            // Only show toggle for standard and power modes; accuracy always uses history mode
            const showToggle = mode !== "accuracy";
            if (!showToggle) return null;
            const toggleInk = isDark ? "255,255,255" : "20,20,40";
            return (
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                background: `rgba(${toggleInk},0.04)`,
                border: `1px solid rgba(${toggleInk},0.10)`,
                borderRadius: 7,
                padding: "2px 4px",
                gap: 1,
              }}>
                {(["live", "history"] as const).map((viewMode) => (
                  <button
                    key={viewMode}
                    type="button"
                    onClick={() => setHeatmapViewMode(viewMode)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 5,
                      border: heatmapViewMode === viewMode ? `1px solid ${modeAccent}` : "1px solid transparent",
                      background: heatmapViewMode === viewMode ? `${modeAccent}15` : "transparent",
                      color: heatmapViewMode === viewMode ? modeAccent : `rgba(${toggleInk},0.50)`,
                      font: "inherit",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                      textTransform: "capitalize",
                    }}
                  >
                    {viewMode === "live" ? "Live" : "History"}
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="ts-cardMeta">
            {heatmapLoading
              ? "Loading…"
              : selectedSessionId
              ? replayEvents.length > 0
                ? `${activeEventIdx + 1} / ${replayEvents.length} events`
                : `${heatmapCells.length} zones`
              : "12 × 8 Grid"}
          </div>
        </div>
      </div>

      {/* Replay controls + timeline scrubber */}
      {selectedSessionId && !heatmapLoading && replayEvents.length > 0 && (() => {
        const totalMs  = sessionSummary?.session_duration_ms
                       ?? replayEvents[replayEvents.length - 1]?.tMs
                       ?? 1;
        const pct      = Math.min(1, replayTimeMs / totalMs);
        const fmtMs    = (ms: number) => {
          const s = Math.floor(ms / 1000);
          const m = Math.floor(s / 60);
          return m > 0 ? `${m}:${String(s % 60).padStart(2,"0")}` : `${s}s`;
        };
        const notStarted = activeEventIdx === -1 && !isReplaying;

        return (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>

            {/* Row 1: transport buttons + speed */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {notStarted ? (
                <button className="ts-replayBtn ts-replayBtnPrimary" onClick={startReplay}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 1.5l8 4.5-8 4.5V1.5Z" fill="currentColor"/>
                  </svg>
                  Play
                </button>
              ) : isReplaying ? (
                <button className="ts-replayBtn" onClick={pauseReplay}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="1.5" y="1.5" width="3" height="9" rx="1" fill="currentColor"/>
                    <rect x="7.5" y="1.5" width="3" height="9" rx="1" fill="currentColor"/>
                  </svg>
                  Pause
                </button>
              ) : (
                <button className="ts-replayBtn ts-replayBtnPrimary" onClick={resumeReplay}
                  disabled={activeEventIdx >= replayEvents.length - 1}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 1.5l8 4.5-8 4.5V1.5Z" fill="currentColor"/>
                  </svg>
                  Resume
                </button>
              )}

              <button className="ts-replayBtn" onClick={resetReplay}
                disabled={notStarted}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1.5 6a4.5 4.5 0 1 1 1.1 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <path d="M1.5 9.5V6h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Reset
              </button>

              <div className="ts-replaySpeed">
                <span className="ts-replaySpeedLabel">Speed</span>
                {([0.5, 1, 2] as const).map(s => (
                  <button
                    key={s}
                    className={`ts-replaySpeedBtn${replaySpeed === s ? " isActive" : ""}`}
                    onClick={() => {
                      setReplaySpeed(s);
                      // If mid-replay, reschedule remaining events at new speed
                      if (isReplaying) {
                        const nextIdx = activeEventIdx + 1;
                        if (nextIdx < replayEvents.length) {
                          scheduleFrom(nextIdx, replayEvents[nextIdx].tMs, s);
                        }
                      }
                    }}
                  >
                    {s === 0.5 ? "0.5×" : s === 1 ? "1×" : "2×"}
                  </button>
                ))}
              </div>

              {/* Time counter */}
              <div style={{ marginLeft: "auto", fontSize: 11, fontVariantNumeric: "tabular-nums",
                opacity: 0.55, display: "flex", gap: 3, alignItems: "center" }}>
                <span style={{ opacity: 0.9 }}>{fmtMs(replayTimeMs)}</span>
                <span style={{ opacity: 0.4 }}>/</span>
                <span>{fmtMs(totalMs)}</span>
              </div>
            </div>

            {/* Row 2: timeline scrubber */}
            <div className="ts-replayTimeline"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                seekTo(Math.round(ratio * totalMs));
              }}
            >
              {/* Track fill */}
              <div className="ts-replayTrackFill" style={{
                width: `${pct * 100}%`,
                background: `linear-gradient(90deg, ${modeAccent}99, ${modeAccent})`,
              }} />

              {/* Event dots */}
              {replayEvents.map((ev, idx) => {
                const dotPct = (ev.tMs / totalMs) * 100;
                const isFired  = idx <= activeEventIdx;
                const isActive = idx === activeEventIdx;
                // Size dot by SI: bigger = stronger hit
                const siNorm   = ev.si != null ? ev.si / 1000 : 0.4;
                const dotSize  = 5 + Math.round(siNorm * 5); // 5–10px
                return (
                  <div
                    key={ev.eventId}
                    className="ts-replayDot"
                    title={`Event ${idx + 1} · ${fmtMs(ev.tMs)}${ev.si != null ? ` · SI ${ev.si}` : ""}${ev.cellCount ? ` · ${ev.cellCount} cells` : ""}`}
                    onClick={(e) => { e.stopPropagation(); seekTo(ev.tMs); }}
                    style={{
                      left:      `${dotPct}%`,
                      width:     dotSize,
                      height:    dotSize,
                      marginTop: -(dotSize / 2),
                      // Fired (on/behind playhead): solid mode color
                      // Unfired (ahead of playhead): mode color at ~25% opacity
                      background: isFired ? modeAccent : `${modeAccent}40`,
                      boxShadow:  isActive ? `0 0 0 3px ${modeAccent}44` : "none",
                      transform:  isActive ? "translate(-50%,-50%) scale(1.5)" : "translate(-50%,-50%) scale(1)",
                      zIndex:     isActive ? 3 : 1,
                    }}
                  />
                );
              })}

              {/* Playhead */}
              <div className="ts-replayHead" style={{ left: `${pct * 100}%` }} />
            </div>

            {/* Row 3: active event info strip */}
            {activeEvent && (
              <div style={{ display: "flex", gap: 12, fontSize: 11,
                color: modeAccent, fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
                <span>Event {activeEventIdx + 1} of {replayEvents.length}</span>
                {activeEvent.si   != null && <span>SI {activeEvent.si}</span>}
                {activeEvent.cellCount > 0  && <span>{activeEvent.cellCount} cells</span>}
              </div>
            )}

          </div>
        );
      })()}

      {/* Body: empty state OR two-column bag + stats */}
      {!selectedSessionId ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "20px 16px", marginTop: 8,
          borderRadius: 12,
          border: "1px dashed rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.015)",
        }}>
          <svg width="16" height="16" viewBox="0 0 30 30" fill="none" style={{ opacity: 0.30, flexShrink: 0 }}>
            <rect x="2" y="2" width="7" height="7" rx="2" fill="currentColor"/>
            <rect x="11.5" y="2" width="7" height="7" rx="2" fill="currentColor" opacity="0.5"/>
            <rect x="21" y="2" width="7" height="7" rx="2" fill="currentColor"/>
            <rect x="2" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.4"/>
            <rect x="11.5" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.9"/>
            <rect x="21" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.3"/>
            <rect x="2" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.6"/>
            <rect x="11.5" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.2"/>
            <rect x="21" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.7"/>
          </svg>
          <span style={{ fontSize: 13, opacity: 0.45, fontWeight: 500 }}>Select a session to view its heatmap</span>
        </div>
      ) : (
        <div className="ts-heatmapBody">

          {/* ── Left: bag ── */}
          <div className="ts-heatmapBagCol">
            <div
              className="ts-dash-bagWrap"
              style={{
                boxShadow: !heatmapLoading
                  ? `0 0 40px -10px ${modeGlow.replace("0.55","0.30")}, inset 0 0 60px -20px ${modeGlow.replace("0.55","0.10")}`
                  : "none",
                borderColor: !heatmapLoading
                  ? modeAccent + "55"
                  : "var(--panel-border, rgba(255,255,255,0.10))",
              }}
            >
              {/* Bag label */}
              <div style={{
                position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                opacity: 0.28, pointerEvents: "none", zIndex: 4, whiteSpace: "nowrap",
                color: "currentColor",
              }}>
                Heavy Bag — 12 × 8 Grid
              </div>

              {/* Target mode zone overlay — highlights cued zone on active event */}
              {(() => {
                const m = (sessionSummary?.mode ?? "power").toLowerCase();
                if (m !== "target" || !activeEvent?.targetZone) return null;
                const z = activeEvent.targetZone;
                // Map zone to grid row/col ranges (1-indexed, matching ESP32)
                const rowRange = z.row === "top" ? [9,12] : z.row === "middle" ? [5,8] : [1,4];
                // Column direction is mirrored: C8 renders leftmost, C1 rightmost
                const colRange = z.col === "left" ? [7,8] : z.col === "center" ? [3,6] : [1,2];
                const correct  = activeEvent.zoneCorrect;
                const zColor   = correct === true  ? "#00ff88"
                               : correct === false ? "#ff6060"
                               : "#00ff88";
                // Compute overlay position relative to the 12-row × 8-col grid
                // Grid padding: 28px top, 6px bottom/sides
                const padTop = 28; const padBot = 6; const padSide = 6;
                const rowFrac = (ri: number) => (12 - ri + 0.5) / 12;  // visual top fraction for row ri
                const colFrac = (ci: number) => (8 - ci + 0.5) / 8;    // visual left fraction (mirrored: C8=left)
                const top1 = rowFrac(rowRange[1]);   // top edge = highest row (largest r = higher on grid)
                const top2 = rowFrac(rowRange[0] - 1);
                const left1 = colFrac(colRange[1]);   // left edge = highest col number (renders leftmost)
                const left2 = colFrac(colRange[0] - 1);
                return (
                  <div style={{
                    position: "absolute",
                    top:    `calc(${padTop}px + (100% - ${padTop + padBot}px) * ${top1})`,
                    left:   `calc(${padSide}px + (100% - ${padSide * 2}px) * ${left1})`,
                    width:  `calc((100% - ${padSide * 2}px) * ${left2 - left1})`,
                    height: `calc((100% - ${padTop + padBot}px) * ${top2 - top1})`,
                    border: `2px solid ${zColor}`,
                    background: `${zColor}18`,
                    borderRadius: 6,
                    pointerEvents: "none",
                    zIndex: 6,
                    transition: "border-color 200ms, background 200ms",
                    boxShadow: `0 0 12px 2px ${zColor}44`,
                  }} />
                );
              })()}

              {/* Loading overlay */}
              {heatmapLoading && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(7,7,10,0.65)", backdropFilter: "blur(4px)",
                  borderRadius: 16, zIndex: 5, pointerEvents: "none",
                }}>
                  <div style={{ fontSize: 13, opacity: 0.55 }}>Loading heatmap…</div>
                </div>
              )}

              {/* Hit grid — 12 rows × 8 cols */}
              <div style={{ position: "absolute", inset: 0 }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gridTemplateRows: "repeat(12, 1fr)",
                  gap: 3,
                  padding: "28px 6px 6px",
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                }}>
                  {Array.from({ length: 12 }, (_, ri) =>
                    Array.from({ length: 8 }, (_, ci) => {
                      const r = 12 - ri;
                      const c = 8 - ci;   // mirrors session.tsx: C8 left, C1 right
                      const key = `${r}-${c}`;
                      let intensity = 0;
                      let kpa = 0;

                      // In history view, always show cumulative replay heatmap
                      if (heatmapViewMode === "history" && replayEvents.length > 0) {
                        const hits = replayHeatmap.get(key) ?? 0;
                        intensity = hits / maxReplayHits;
                        kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                      } else if (replayEvents.length > 0) {
                        // Live mode: only show cells from the most recent event (not cumulative)
                        // This lets users see if they're hitting the same spot or different spots
                        const isInActiveEvent = activeEvent?.cells.some(
                          cell => cell.r === r && cell.c === c
                        ) ?? false;
                        if (isInActiveEvent) {
                          intensity = 1.0; // Most recent hit is full intensity
                          kpa = 90;
                        }
                      } else {
                        // No replay: use static heatmap cells
                        const cell = heatmapCells.find((hc) => hc.r === r && hc.c === c);
                        intensity = cell?.intensity ?? 0;
                        kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                      }

                      const isAlive = intensity > 0;
                      const color = isAlive ? pressureToColor(kpa) : null;
                      const glow  = isAlive ? pressureToGlow(kpa) : null;
                      // isJustHit: any cell in the active event matches this grid cell
                      const isJustHit = activeEvent?.cells.some(
                        cell => cell.r === r && cell.c === c
                      ) ?? false;

                      return (
                        <div
                          key={key}
                          className="ts-sim-cell ts-dash-cell"
                          title={`R${String(r).padStart(2,"0")} C${String(c).padStart(2,"0")}${isAlive ? ` · ${Math.round(intensity * 100)}%` : ""}`}
                          style={{
                            borderRadius: 4,
                            background: isAlive
                              ? `${color}${Math.round((0.20 + intensity * 0.55) * 255).toString(16).padStart(2,"0")}`
                              : "rgba(255,255,255,0.03)",
                            boxShadow: isAlive ? `0 0 10px 2px ${glow}` : "none",
                            border: isAlive
                              ? `1px solid ${color}${Math.round(intensity * 0.6 * 255).toString(16).padStart(2,"0")}`
                              : undefined,
                            transform: isJustHit ? "scale(1.12)" : isAlive && intensity > 0.7 ? "scale(1.06)" : "scale(1)",
                            transition: "background 80ms, box-shadow 80ms, transform 80ms, border-color 80ms",
                            position: "relative",
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {/* Impact ripples */}
              {heatmapRipples.map(ripple => {
                // Grid renders rows top→bottom as R12→R1 with padding: "28px 6px 6px".
                // ri = visual row index (0 = top = R12), so ri = 12 - ripple.r
                const gridPadTop    = 28; // matches padding "28px 6px 6px"
                const gridPadBottom = 6;
                const gridPadSide   = 6;
                const ri = 12 - ripple.r; // 0-based from top
                const leftVal = `calc(${gridPadSide}px + (100% - ${gridPadSide * 2}px) * ${(8 - ripple.c + 0.5) / 8})`;
                const topVal  = `calc(${gridPadTop}px + (100% - ${gridPadTop + gridPadBottom}px) * ${(ri + 0.5) / 12})`;
                return (
                  <div key={ripple.id} style={{
                    position: "absolute", left: leftVal, top: topVal,
                    transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 10,
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: ripple.color, boxShadow: `0 0 16px 6px ${ripple.color}`,
                      animation: "tsCorePulse 0.9s ease-out forwards",
                    }} />
                    <div style={{
                      position: "absolute", left: "50%", top: "50%",
                      width: 14, height: 14, borderRadius: "50%",
                      border: `2px solid ${ripple.color}`,
                      animation: "tsRipple 0.9s ease-out forwards",
                    }} />
                  </div>
                );
              })}

              {/* Volume mode window badge */}
              {(() => {
                const m = (sessionSummary?.mode ?? "power").toLowerCase();
                if (m !== "volume" || !activeEvent || activeEvent.volWindowIdx === null) return null;
                return (
                  <div style={{
                    position: "absolute", top: 8, right: 8,
                    display: "flex", gap: 4, zIndex: 7, pointerEvents: "none",
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                      padding: "2px 7px", borderRadius: 999,
                      background: "rgba(255,106,0,0.18)",
                      border: "1px solid rgba(255,106,0,0.45)",
                      color: "#ff6a00",
                    }}>
                      W{(activeEvent.volWindowIdx ?? 0) + 1}
                    </div>
                    {activeEvent.volHitSeq != null && (
                      <div style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                        padding: "2px 7px", borderRadius: 999,
                        background: "rgba(255,106,0,0.10)",
                        border: "1px solid rgba(255,106,0,0.28)",
                        color: "rgba(255,140,60,0.9)",
                      }}>
                        #{activeEvent.volHitSeq}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Bottom glow */}
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                background: `radial-gradient(ellipse at 50% 100%, ${modeGlow.replace("0.55","0.18")} 0%, transparent 65%)`,
                transition: "opacity 500ms", opacity: !heatmapLoading ? 1 : 0.25,
                borderRadius: 16,
              }} />
            </div>
          </div>

          {/* ── Right: session stats ── */}
          <div className="ts-heatmapStatsCol">
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase", opacity: 0.40, marginBottom: 10,
            }}>
              Session Stats
            </div>

            {heatmapLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                    <Skel w={`${45 + (i % 3) * 12}%`} h={11} />
                    <Skel w="22%" h={13} />
                  </div>
                ))}
              </div>
            ) : summaryStats.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.40, padding: "8px 0" }}>No data available</div>
            ) : (
              <div className="ts-summaryList">
                {summaryStats.map((stat) => (
                  <div
                    key={stat.label}
                    className={`ts-summaryRow${stat.accent ? " isAccent" : ""}`}
                    style={stat.accent ? {
                      background: modeAccent + "12",
                      borderColor: modeAccent + "30",
                    } : undefined}
                  >
                    <span className="ts-summaryRowLabel">{stat.label}</span>
                    <span
                      className="ts-summaryRowValue"
                      style={stat.accent ? { color: modeAccent } : undefined}
                    >{stat.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Event Stats — matches Session Stats row style, live-updates on replay ── */}
            {replayEvents.length > 0 && (() => {
              const mode     = (sessionSummary?.mode ?? "power").toLowerCase();
              const ev       = activeEvent;
              const hasEvent = ev !== null;

              // Value helpers
              const evSI      = ev?.si         != null ? String(ev.si)                        : "—";
              const evImpulse = ev?.impulse    != null ? String(ev.impulse)                   : "—";
              const evCells   = ev             != null ? String(ev.cellCount || ev.cells.length) : "—";
              const evAngle   = ev?.angleDeg   != null ? `${ev.angleDeg}°`                    : "—";
              const evDur     = ev?.durationMs != null ? `${ev.durationMs} ms`                : "—";
              const evRise    = ev?.riseMs     != null ? `${ev.riseMs} ms`                    : "—";

              // Accuracy: pull from quality if available
              const accPct    = sessionSummary?.quality?.accuracy_pct ?? sessionSummary?.quality?.score;
              const evAccuracy = accPct != null ? `${Number(accPct).toFixed(1)}%` : "—";

              // Reaction time: use the dedicated column, not duration as a proxy
              const evReactionTime = ev?.reactionTimeMs != null ? `${ev.reactionTimeMs} ms` : "—";

              type StatRow = { label: string; value: string; accent?: boolean };
              let eventStatRows: StatRow[];

              if (mode === "accuracy") {
                eventStatRows = [
                  { label: "Accuracy",        value: evAccuracy,  accent: true },
                  { label: "Cells Hit",        value: evCells },
                  { label: "Strength Index",   value: evSI },
                  { label: "Duration",         value: evDur },
                  { label: "Angle",            value: evAngle },
                ];
              } else if (mode === "reaction") {
                eventStatRows = [
                  { label: "Reaction Time",    value: evReactionTime,  accent: true },
                  { label: "Duration",         value: evDur },
                  { label: "Rise Time",        value: evRise },
                  { label: "Angle",            value: evAngle },
                ];
              } else if (mode === "target") {
                const zoneLabel = (z: { row: string; col: string } | null) =>
                  z ? `${z.row.charAt(0).toUpperCase() + z.row.slice(1)} ${z.col.charAt(0).toUpperCase() + z.col.slice(1)}` : "—";
                const evTargetZone  = ev?.targetZone  ? zoneLabel(ev.targetZone)  : "—";
                const evZoneHit     = ev?.zoneHit     ? zoneLabel(ev.zoneHit)     : "—";
                const evZoneCorrect = ev?.zoneCorrect != null
                  ? ev.zoneCorrect ? "✓ Correct" : "✗ Wrong"
                  : "—";
                const correctColor  = ev?.zoneCorrect === true  ? "#00ff88"
                                    : ev?.zoneCorrect === false ? "#ff6060"
                                    : undefined;
                eventStatRows = [
                  { label: "Zone Cued",       value: evTargetZone,   accent: true },
                  { label: "Zone Hit",        value: evZoneHit },
                  { label: "Result",          value: evZoneCorrect },
                  { label: "Reaction Time",   value: evReactionTime },
                  { label: "Strength Index",  value: evSI },
                  { label: "Cells Hit",       value: evCells },
                ];
                // Inject correctColor override — we'll handle it in the render below
                (eventStatRows[2] as any).__color = correctColor;
              } else if (mode === "volume") {
                const evWindow  = ev?.volWindowIdx != null ? `Window ${ev.volWindowIdx + 1}` : "—";
                const evHitSeq  = ev?.volHitSeq    != null ? `${ev.volHitSeq}`                : "—";

                // SI vs window average — shows whether this hit is above or below
                // the window mean, giving per-hit fatigue context during replay
                const winData   = sessionSummary?.quality?.windows as any[] | undefined;
                const winEntry  = winData?.find((w: any) => w.window_idx === ev?.volWindowIdx);
                const winAvgSi  = winEntry?.avg_si as number | undefined;
                const siNum     = ev?.si != null ? Number(ev.si) : null;
                const siVsAvg   = siNum != null && winAvgSi != null
                  ? (() => {
                      const diff = Math.round(siNum - winAvgSi);
                      return diff > 0 ? `+${diff} vs avg` : diff < 0 ? `${diff} vs avg` : "= avg";
                    })()
                  : "—";

                eventStatRows = [
                  { label: "Strength Index",  value: evSI,      accent: true },
                  { label: "vs Window Avg",   value: siVsAvg },
                  { label: "Window",          value: evWindow },
                  { label: "Hit #",           value: evHitSeq },
                  { label: "Cells Hit",       value: evCells },
                  { label: "Duration",        value: evDur },
                ];
              } else {
                // power / default
                eventStatRows = [
                  { label: "Strength Index",   value: evSI,        accent: true },
                  { label: "Impulse Index",    value: evImpulse },
                  { label: "Cells Hit",        value: evCells },
                  { label: "Angle",            value: evAngle },
                ];
              }

              return (
                <div style={{ marginTop: 14 }}>
                  {/* Header — same style as "Session Stats" label above */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                      textTransform: "uppercase", opacity: 0.40,
                    }}>
                      Event Stats
                    </div>
                    {/* Live pulse dot */}
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: hasEvent ? modeAccent : "rgba(255,255,255,0.18)",
                      boxShadow: hasEvent ? `0 0 5px 2px ${modeAccent}55` : "none",
                      transition: "background 200ms, box-shadow 200ms",
                    }} />
                  </div>

                  {/* Rows — identical markup to ts-summaryRow */}
                  <div className="ts-summaryList">
                    {eventStatRows.map((row) => {
                      const customColor = (row as any).__color;
                      return (
                        <div
                          key={row.label}
                          className={`ts-summaryRow${row.accent ? " isAccent" : ""}`}
                          style={row.accent ? {
                            background: modeAccent + "12",
                            borderColor: modeAccent + "30",
                          } : undefined}
                        >
                          <span className="ts-summaryRowLabel">{row.label}</span>
                          <span
                            className="ts-summaryRowValue"
                            style={{
                              color: customColor ?? (row.accent ? modeAccent : undefined),
                              opacity: hasEvent ? 1 : 0.30,
                              transition: "opacity 200ms ease",
                            }}
                          >
                            {row.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Strike View 3D — hidden on phone/tablet (≤1024px) ──
                Tier II. Below it the compass has nothing to draw:
                angle_deg and angles_deg are masked out of the row, so
                every arrow would land at zero. The locked state says
                that plainly instead of rendering a broken compass. */}
            <div className="ts-strikeCompassWrap">
              {sessionSummary && (
                ent.can("strikeCompass") ? (
                  <StrikeCompass
                    activeEvent={activeEvent ?? null}
                    activeAngle={activeEvent?.angleDeg ?? null}
                    anglesDeg={sessionSummary.angles_deg}
                    isReplaying={isReplaying}
                    modeAccent={modeAccent}
                    modeGlow={modeGlow}
                    isDark={isDark}
                  />
                ) : (
                  <div
                    style={{
                      height: "100%",
                      minHeight: 220,
                      borderRadius: 12,
                      border: `1px dashed rgba(${isDark ? "255,255,255" : "20,20,40"},0.16)`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      textAlign: "center",
                      padding: "20px 24px",
                    }}
                  >
                    <div style={{ display: "flex", opacity: 0.5 }}><IconCompass size={28} /></div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Strike Compass</div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.55, opacity: 0.6, maxWidth: 240 }}>
                      Reconstructs the incoming angle of every strike in 3D —
                      something you cannot see from the sideline.
                    </div>
                    <LockBadge tier={ent.requiredTier("strikeCompass")} />
                  </div>
                )
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
