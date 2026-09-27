// src/components/batteryBadge.tsx
//
// Battery badge for a connected bag, plus the low-battery banner. Shared by the
// desktop session page, the mobile session page and mobile home. Protocol and
// thresholds live in src/bluetooth/battery.ts.

import type React from "react";
import { batteryTone, BATT_LOW_PCT, type BattAlert } from "../bluetooth/battery";

// Glyph (body + proportional fill + terminal nub) and percentage. Renders
// nothing when the bag has not reported a level — hidden, never zeroed.
export default function BatteryBadge({ pct, isDark, style }: {
  pct: number | null | undefined;
  isDark: boolean;
  style?: React.CSSProperties;  // layout overrides, e.g. to size it as a BagInfoPills cell
}) {
  if (pct == null) return null;
  const c = batteryTone(pct);
  return (
    <span
      title={`Bag battery: ${pct}%`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 800, letterSpacing: "0.04em",
        color: isDark ? `rgb(${c.rgb})` : c.ink,
        background: isDark ? `rgba(${c.rgb},0.12)` : `rgba(${c.rgb},0.18)`,
        border: isDark ? `1px solid rgba(${c.rgb},0.30)` : `1px solid rgba(${c.rgb},0.55)`,
        borderRadius: 4, padding: "1px 5px",
        ...style,
      }}
    >
      <span style={{
        position: "relative", width: 16, height: 8,
        border: "1px solid currentColor", borderRadius: 2,
        display: "inline-block", boxSizing: "border-box",
      }}>
        <span style={{
          position: "absolute", top: 1, left: 1, bottom: 1,
          width: `calc(${pct}% - 2px)`, minWidth: 1,
          background: "currentColor", borderRadius: 1,
        }} />
        <span style={{
          position: "absolute", right: -3, top: 2, bottom: 2,
          width: 2, background: "currentColor", borderRadius: 1,
        }} />
      </span>
      {pct}%
    </span>
  );
}

// One row per bag at or below BATT_LOW_PCT. Styled like the OTA banner, but
// shown during a session too — mid-session is exactly when a dying bag matters.
export function LowBatteryBanner({ alerts, onDismiss }: {
  alerts: BattAlert[];
  onDismiss: (a: BattAlert) => void;
}) {
  if (!alerts.length) return null;
  return (
    <>
      {alerts.map(a => {
        const critical = a.level === "critical";
        const rgb = critical ? "255,68,68" : "255,200,0";
        return (
          <div key={a.key} role="alert" style={{
            marginBottom: 14, padding: "11px 13px", borderRadius: 10,
            background: `rgba(${rgb},0.07)`,
            border: `1px solid rgba(${rgb},0.30)`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: `rgb(${rgb})`, letterSpacing: "0.03em" }}>
                  {critical ? "Battery critical" : "Low battery"} · {a.label} {a.pct}%
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
                  {critical
                    ? "Charge now — this bag may shut off mid-session"
                    : `Below ${BATT_LOW_PCT}% — charge after this session`}
                </div>
              </div>
              <button
                onClick={() => onDismiss(a)}
                title="Dismiss"
                style={{
                  flexShrink: 0, background: "none", border: "none",
                  color: "var(--muted)", cursor: "pointer",
                  fontSize: 13, padding: "0 4px", lineHeight: 1,
                }}
              >×</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
