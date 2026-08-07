// src/components/useCaseVisuals.tsx
// Coded, animated mockups for the use-case "What you get" rows — same approach
// as platformVisuals.tsx (nothing to keep in sync with the real UI, no image
// pipeline). Each pauses its animation off-screen via useVisible. Resolved by
// key through the VISUALS registry so the content file stays JSX-free.
//
// College uses coachDashboard, placementHeatmap, phoneAthleteProfile. The other
// four keys (pro / sports-science / facilities) get filled in as those pages
// ship; the registry is a Partial, so an unbuilt key renders nothing.
import React, { useEffect, useMemo, useState } from "react";
import { useVisible } from "../hooks/useVisible";
import type { VisualKey } from "../content/useCases";

const GRID_ROWS = 8;
const GRID_COLS = 12;

// ── coachDashboard ────────────────────────────────────────────────────────────
// Roster table with a live-ticking per-athlete force column and a highlighted
// row that cycles down the depth chart.
const ROSTER = [
  { name: "M. Ellis", pos: "OT", base: 612 },
  { name: "J. Coburn", pos: "DT", base: 641 },
  { name: "D. Reed", pos: "DE", base: 589 },
  { name: "K. Osei", pos: "C", base: 596 },
  { name: "T. Vance", pos: "G", base: 574 },
  { name: "R. Nunez", pos: "LB", base: 538 },
];
const ROSTER_MAX = 680;

export function CoachDashboard() {
  const { ref, visible } = useVisible();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, [visible]);

  const active = tick % ROSTER.length;
  return (
    <div className="ts-uc-mock ts-uc-dash" ref={ref}>
      <div className="ts-uc-dashHead">
        <span className="ts-uc-dashTitle">Roster · Force</span>
        <span className="ts-uc-dashSel">Session 14 ▾</span>
      </div>
      <div className="ts-uc-dashCols">
        <span>Athlete</span><span>Pos</span><span className="ts-uc-dashColF">Peak Force</span>
      </div>
      {ROSTER.map((a, i) => {
        // Deterministic-ish jitter so numbers move without a random dependency.
        const jitter = visible ? Math.round(Math.sin(tick * 1.3 + i) * 9 + (i === active ? 6 : 0)) : 0;
        const val = a.base + jitter;
        const pct = Math.min(100, (val / ROSTER_MAX) * 100);
        return (
          <div key={a.name} className={`ts-uc-dashRow ${i === active ? "is-active" : ""}`}>
            <span className="ts-uc-dashName">{a.name}</span>
            <span className="ts-uc-dashPos">{a.pos}</span>
            <span className="ts-uc-dashForce">
              <span className="ts-uc-dashBarTrack"><span className="ts-uc-dashBarFill" style={{ width: `${pct}%` }} /></span>
              <span className="ts-uc-dashVal">{val}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── placementHeatmap ──────────────────────────────────────────────────────────
// 96-cell grid that resolves into a two-hand placement heatmap and re-stamps
// each "rep". Intensity is a gaussian falloff from two hand centers; the resolve
// animation is CSS with a per-cell delay by distance.
const HANDS = [
  { r: 3.2, c: 3.4 },
  { r: 3.4, c: 8.2 },
];
function heatAt(r: number, c: number) {
  let peak = 0;
  for (const h of HANDS) {
    const d2 = (r - h.r) ** 2 + (c - h.c) ** 2;
    peak = Math.max(peak, Math.exp(-d2 / 3.2));
  }
  return peak;
}

export function PlacementHeatmap() {
  const { ref, visible } = useVisible();
  const [rep, setRep] = useState(112);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setRep((n) => n + 1), 1400);
    return () => clearInterval(id);
  }, [visible]);

  const cells = useMemo(() => {
    const out: { i: number; heat: number; delay: number }[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const heat = heatAt(r, c);
        const dist = Math.hypot(r - 3.3, c - 5.8);
        out.push({ i: r * GRID_COLS + c, heat, delay: dist * 0.05 });
      }
    }
    return out;
  }, []);

  return (
    <div className="ts-uc-mock ts-uc-heat" ref={ref}>
      <div className="ts-uc-heatHead">
        <span className="ts-uc-heatTitle">Hand Placement</span>
        <span className="ts-uc-heatRep">Rep #{rep}</span>
      </div>
      <div className={`ts-uc-heatGrid ${visible ? "is-live" : ""}`}>
        {cells.map((c) => (
          <span
            key={c.i}
            className="ts-uc-heatCell"
            style={{ "--uc-heat": c.heat.toFixed(3), animationDelay: `${c.delay}s` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="ts-uc-heatLegend">
        <span className="ts-uc-heatSwatch" /> Low
        <span className="ts-uc-heatSwatch ts-uc-heatSwatch--hi" /> High
        <span className="ts-uc-heatConsistency">Placement consistency 94%</span>
      </div>
    </div>
  );
}

// ── phoneAthleteProfile ───────────────────────────────────────────────────────
// Athlete card, force-trend sparkline (draws in when visible), session history.
export function PhoneAthleteProfile() {
  const { ref, visible } = useVisible();
  return (
    <div className="ts-uc-mock ts-uc-profile" ref={ref}>
      <div className="ts-uc-profileTop">
        <div className="ts-uc-profileAvatar">DR</div>
        <div>
          <div className="ts-uc-profileName">D. Reed</div>
          <div className="ts-uc-profileMeta">Defensive End · #91</div>
        </div>
      </div>

      <div className="ts-uc-profileStats">
        <div className="ts-uc-profileStat">
          <span className="ts-uc-profileStatVal">641</span>
          <span className="ts-uc-profileStatLbl">Peak force</span>
        </div>
        <div className="ts-uc-profileStat">
          <span className="ts-uc-profileStatVal">+14%</span>
          <span className="ts-uc-profileStatLbl">vs. spring</span>
        </div>
      </div>

      <div className="ts-uc-profileCard">
        <div className="ts-uc-profileCardHead">Force trend</div>
        <svg className="ts-uc-spark" viewBox="0 0 120 40" preserveAspectRatio="none">
          <polyline
            className={`ts-uc-sparkLine ${visible ? "is-drawn" : ""}`}
            points="0,32 20,28 40,30 60,22 80,18 100,12 120,8"
            fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="ts-uc-profileHistory">
        {[
          { s: "Session 14", v: "641" },
          { s: "Session 13", v: "628" },
          { s: "Session 12", v: "607" },
        ].map((h) => (
          <div key={h.s} className="ts-uc-profileRow">
            <span>{h.s}</span><span className="ts-uc-profileRowVal">{h.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const VISUALS: Partial<Record<VisualKey, React.ComponentType>> = {
  coachDashboard: CoachDashboard,
  placementHeatmap: PlacementHeatmap,
  phoneAthleteProfile: PhoneAthleteProfile,
};
