// src/components/bagInfoPills.tsx
//
// Connected-bag summary for the Bag Connection card: a 2×2 grid of equal-size
// pills (device id · firmware / hardware + rate · battery). Shared by the
// desktop session page, the mobile session page and mobile home.

import type React from "react";
import BatteryBadge from "./batteryBadge";
import { modelBadge } from "../bluetooth/models";

type Props = {
  id: string;
  fw: string;
  hw: string | undefined | null;
  samplingHz?: number;
  batteryPct: number | null | undefined;
  isDark: boolean;
};

// Every cell shares this box so the four pills line up as a uniform grid.
const cell: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
  height: 24, padding: "0 10px", boxSizing: "border-box",
  borderRadius: 6, whiteSpace: "nowrap",
  fontSize: 10, fontWeight: 800, letterSpacing: "0.04em",
};

// Tinted pill: neon rgb on dark; darker ink + stronger fill/border on light,
// where the neon washes out on white.
function tint(rgb: string, ink: string, isDark: boolean): React.CSSProperties {
  return {
    color:      isDark ? `rgb(${rgb})` : ink,
    background: isDark ? `rgba(${rgb},0.12)` : `rgba(${rgb},0.18)`,
    border:     isDark ? `1px solid rgba(${rgb},0.30)` : `1px solid rgba(${rgb},0.55)`,
  };
}

export default function BagInfoPills({ id, fw, hw, samplingHz, batteryPct, isDark }: Props) {
  // Per-model accent + display rate. IV/V (native C) show their live reported
  // scan rate from the hello "hz" field rather than the nominal 400.
  const badge = modelBadge(hw, samplingHz);
  return (
    <div style={{
      marginLeft: "auto",
      // Inside an auto-width grid, 1fr columns resolve to the widest cell, so
      // every pill ends up the same width.
      display: "inline-grid", gridTemplateColumns: "1fr 1fr", gap: 6,
    }}>
      <span style={{ ...cell, ...tint("180,0,255", "#8a00c2", isDark), fontSize: 11 }}>{id}</span>
      <span style={{
        ...cell, fontWeight: 600, color: "var(--muted)",
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
        border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,0,0,0.14)",
      }}>
        v{fw}
      </span>
      <span style={{ ...cell, ...tint(badge.rgb, badge.ink, isDark) }}>{badge.label}</span>
      <BatteryBadge pct={batteryPct} isDark={isDark} style={cell} />
    </div>
  );
}
