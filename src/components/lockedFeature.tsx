// src/components/lockedFeature.tsx
//
// The locked-state UX for subscription-gated features.
// Implements docs/Trench_Sports_Three_Tier_Plan.docx §8.5.
//
// The rule the doc sets, and the reason these components exist rather than a
// bare `{can("x") && <Panel/>}`: locked features are VISIBLE but disabled, not
// absent. A Tier I coach should be able to see that a fatigue tracker exists —
// invisible features cannot be upsold. So a locked panel renders its real
// chrome, fills the body with clearly-labelled sample data, states in one line
// what the feature would tell them about their OWN athletes, and carries a
// single upgrade affordance naming the tier required.
//
// The sample data is decoration. It is hard-coded here and never touches
// Supabase, because the real rows for a locked feature are withheld by
// supabase/entitlements.sql before they reach the browser — that is the point.
// Everything in this file is presentation; nothing here is a security control.

import React from "react";
import { useNavigate } from "react-router-dom";
import {
  type BoolFeature,
  type Tier,
  TIER_LABEL,
  TIER_NAME,
  FEATURE_PITCH,
} from "../lib/entitlements";

// ── Lock chip ────────────────────────────────────────────────────────────────
// The small "Tier II" badge. Used on card headers and on locked mode orbs.
export function LockBadge({
  tier,
  compact = false,
  style,
}: {
  tier: Tier;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      title={`Requires ${TIER_LABEL[tier]} — ${TIER_NAME[tier]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: compact ? 9 : 10,
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: compact ? "1px 5px" : "2px 7px",
        borderRadius: 5,
        whiteSpace: "nowrap",
        background: "rgba(180,0,255,0.12)",
        border: "1px solid rgba(180,0,255,0.32)",
        color: "var(--accent, #b400ff)",
        ...style,
      }}
    >
      <svg width={compact ? 8 : 9} height={compact ? 9 : 10} viewBox="0 0 10 12" fill="none" aria-hidden="true">
        <path
          d="M2 5V3.5a3 3 0 016 0V5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <rect x="0.9" y="5" width="8.2" height="6.2" rx="1.6" fill="currentColor" opacity="0.85" />
      </svg>
      {compact ? TIER_LABEL[tier] : `Requires ${TIER_LABEL[tier]}`}
    </span>
  );
}

// ── Sample-data ribbon ───────────────────────────────────────────────────────
// Sits directly over the preview content. Deliberately unmissable: a coach
// mistaking sample numbers for their own roster is the one failure mode this
// pattern can cause, and it would cost far more trust than it wins.
function SampleRibbon() {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 3,
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 5,
        background: "rgba(255,170,0,0.14)",
        border: "1px solid rgba(255,170,0,0.42)",
        color: "#c98600",
        pointerEvents: "none",
      }}
    >
      Sample data
    </div>
  );
}

// ── Locked panel ─────────────────────────────────────────────────────────────
/**
 * Wraps a preview of a gated feature.
 *
 * `children` should be a representative rendering of the feature using the
 * sample rows exported below — NOT the real component fed with real data. The
 * real component would render empty anyway, since the database withholds the
 * rows, and an empty panel reads as "broken" rather than "locked".
 */
export function LockedPanel({
  feature,
  requiredTier,
  title,
  children,
  isDark = true,
  minHeight = 160,
}: {
  feature: BoolFeature;
  requiredTier: Tier;
  title: string;
  children?: React.ReactNode;
  isDark?: boolean;
  minHeight?: number;
}) {
  const navigate = useNavigate();
  const ink = isDark ? "255,255,255" : "20,20,40";

  return (
    <div className="ts-card" style={{ position: "relative", overflow: "hidden" }}>
      <div className="ts-cardTop">
        <div className="ts-cardTitle" style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {title}
          <LockBadge tier={requiredTier} />
        </div>
      </div>

      {/* Preview body — muted and inert so it reads as illustration, not state.
          aria-hidden keeps the fake numbers out of the accessibility tree; the
          upgrade copy below carries the meaning a screen reader needs. */}
      <div style={{ position: "relative", minHeight }}>
        <SampleRibbon />
        <div
          aria-hidden="true"
          style={{
            opacity: 0.34,
            filter: "saturate(0.55)",
            pointerEvents: "none",
            userSelect: "none",
            maskImage: "linear-gradient(to bottom, #000 0%, #000 46%, transparent 96%)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 46%, transparent 96%)",
          }}
        >
          {children}
        </div>

        {/* Upgrade affordance — one per locked surface, naming the tier. */}
        <div
          style={{
            position: "absolute",
            inset: "auto 0 0 0",
            padding: "16px 18px 14px",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            background: isDark
              ? "linear-gradient(to top, rgba(10,8,20,0.97) 58%, rgba(10,8,20,0))"
              : "linear-gradient(to top, rgba(255,255,255,0.97) 58%, rgba(255,255,255,0))",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
              {TIER_LABEL[requiredTier]} · {TIER_NAME[requiredTier]}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.66 }}>
              {FEATURE_PITCH[feature]}
            </div>
          </div>
          <button
            type="button"
            className="ts-btn ts-btnSecondary"
            onClick={() => navigate(`/contact?upgrade=${requiredTier}`)}
            style={{ fontSize: 12, padding: "8px 15px", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            Upgrade to {TIER_LABEL[requiredTier]} →
          </button>
        </div>
      </div>

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          border: `1px solid rgba(${ink},0.06)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Lapsed-program banner ────────────────────────────────────────────────────
/**
 * Shown program-wide when the effective tier is "none" — a lapsed trial or a
 * suspended account. Says plainly that captured data is retained, because the
 * first question a lapsed customer has is whether their sessions are gone.
 */
export function LapsedBanner({ isTrial, isDark = true }: { isTrial: boolean; isDark?: boolean }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderRadius: 14,
        border: "1px solid rgba(255,120,60,0.32)",
        background: isDark ? "rgba(255,120,60,0.09)" : "rgba(255,120,60,0.06)",
        padding: "18px 22px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 5 }}>
          {isTrial ? "Your trial has ended" : "This program is inactive"}
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.75 }}>
          Analysis is paused until a plan is active. Every session you have already
          recorded is kept — activating a plan restores your full history rather
          than starting you over.
        </div>
      </div>
      <button
        type="button"
        className="ts-btn ts-actionPrimary"
        onClick={() => navigate("/contact?upgrade=II")}
        style={{ fontSize: 12.5, padding: "10px 18px", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        Choose a plan →
      </button>
    </div>
  );
}

// ── Trial countdown ──────────────────────────────────────────────────────────
/** Thin strip shown while a trial is live at the Tier III ceiling. */
export function TrialBanner({ daysLeft, isDark = true }: { daysLeft: number | null; isDark?: boolean }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderRadius: 12,
        border: "1px solid rgba(180,0,255,0.28)",
        background: isDark ? "rgba(180,0,255,0.08)" : "rgba(180,0,255,0.05)",
        padding: "11px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
        <strong style={{ fontWeight: 800 }}>
          Trial · full Tier III access
          {daysLeft != null && ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
        </strong>
        <span style={{ opacity: 0.62 }}>
          {" "}— fatigue tracking, coaching cues and unlimited history are unlocked while your trial runs.
        </span>
      </div>
      <button
        type="button"
        className="ts-btn ts-btnGhost"
        onClick={() => navigate("/contact?upgrade=III")}
        style={{ fontSize: 12, padding: "7px 14px", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        Talk to us
      </button>
    </div>
  );
}

// ── Retained-data notice ─────────────────────────────────────────────────────
/**
 * Reports the real training data a program already owns but cannot currently
 * see, because it sits in a locked mode or beyond the tier's history window.
 *
 * This is the counterpart to the sample-data previews above, and the stronger
 * of the two: sample rows show what a feature looks like, this shows what the
 * coach's OWN athletes have already produced. It also answers the first
 * question a downgraded or lapsed customer asks — nothing was deleted.
 *
 * Renders nothing when there is nothing locked, so a Tier III program and a
 * brand-new program both see no clutter.
 */
export function RetainedDataNotice({
  lockedModes,
  lockedModeSessions,
  lockedByHistory,
  historyDays,
  isDark = true,
}: {
  lockedModes: { mode: string; sessions: number; strikes: number }[];
  lockedModeSessions: number;
  lockedByHistory: number;
  historyDays: number | null;
  isDark?: boolean;
}) {
  const navigate = useNavigate();
  if (lockedModeSessions <= 0 && lockedByHistory <= 0) return null;

  const ink = isDark ? "255,255,255" : "20,20,40";
  const strikes = lockedModes.reduce((s, m) => s + (m.strikes ?? 0), 0);

  const parts: string[] = [];
  if (lockedModeSessions > 0) {
    const modeList = lockedModes
      .filter((m) => m.sessions > 0)
      .map((m) => `${m.sessions} ${m.mode.charAt(0).toUpperCase() + m.mode.slice(1)}`)
      .join(", ");
    parts.push(
      `${lockedModeSessions} session${lockedModeSessions === 1 ? "" : "s"} in locked modes (${modeList})`
    );
  }
  if (lockedByHistory > 0 && historyDays != null) {
    parts.push(
      `${lockedByHistory} session${lockedByHistory === 1 ? "" : "s"} older than ${historyDays} days`
    );
  }

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderRadius: 12,
        border: `1px solid rgba(${ink},0.12)`,
        background: `rgba(${ink},${isDark ? "0.035" : "0.025"})`,
        padding: "13px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 260, fontSize: 12.5, lineHeight: 1.6 }}>
        <strong style={{ fontWeight: 800 }}>Your data is all still here.</strong>{" "}
        <span style={{ opacity: 0.72 }}>
          We record everything the adapters measure on every plan — {parts.join(" and ")}
          {strikes > 0 && ` (${strikes.toLocaleString()} strikes)`} are saved but not shown
          on your current plan. Upgrading reveals them straight away; you would not be
          starting over.
        </span>
      </div>
      <button
        type="button"
        className="ts-btn ts-btnGhost"
        onClick={() => navigate("/contact?upgrade=III")}
        style={{ fontSize: 12, padding: "7px 14px", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        See what unlocks →
      </button>
    </div>
  );
}

// ── Sample rows for preview states ───────────────────────────────────────────
// Plausible but obviously generic names. Real-looking enough to communicate the
// shape of the feature, generic enough that nobody mistakes them for a roster.

export const SAMPLE_LEADER_ROWS = [
  { name: "A. Rivera", primary: "812", secondary: "744", tertiary: "9" },
  { name: "M. Okafor", primary: "786", secondary: "731", tertiary: "12" },
  { name: "D. Lindqvist", primary: "755", secondary: "702", tertiary: "7" },
  { name: "J. Barrett", primary: "731", secondary: "688", tertiary: "11" },
  { name: "S. Nakamura", primary: "704", secondary: "665", tertiary: "8" },
];

export const SAMPLE_IMPROVED_ROWS = [
  { name: "S. Nakamura", delta: "+96", metric: "Strength Index" },
  { name: "J. Barrett", delta: "+71", metric: "Strength Index" },
  { name: "M. Okafor", delta: "−38 ms", metric: "Reaction" },
];

export const SAMPLE_TEAM_ROWS = [
  { name: "Varsity", avg: "768", athletes: "24" },
  { name: "JV", avg: "702", athletes: "31" },
  { name: "Freshman", avg: "641", athletes: "28" },
];

export const SAMPLE_FATIGUE_ROWS = [
  { name: "M. Okafor", slope: "−4.2 SI / window", trend: "▼ Fatiguing" },
  { name: "D. Lindqvist", slope: "−2.6 SI / window", trend: "▼ Fatiguing" },
  { name: "A. Rivera", slope: "+0.4 SI / window", trend: "→ Stable" },
];

export const SAMPLE_INSIGHT_CARDS = [
  {
    tag: "Fatigue",
    priority: "high" as const,
    headline: "Two athletes losing power across windows",
    metric: "SI slope −4.2 / window",
    cue: "Shorten windows to 4 s and add 30 s rest between — prioritise quality output per window over raw hit count.",
  },
  {
    tag: "Accuracy",
    priority: "medium" as const,
    headline: "Placement drifting low and inside",
    metric: "Avg offset 6.1 cm",
    cue: "Add combination drills that force a target-zone switch mid-combo to recalibrate under load.",
  },
];

// Generic table used by several locked previews so each call site does not
// hand-roll its own sample markup.
export function SampleTable({
  columns,
  rows,
  isDark = true,
}: {
  columns: string[];
  rows: (string | number)[][];
  isDark?: boolean;
}) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  return (
    <div style={{ padding: "4px 2px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `1.6fr repeat(${columns.length - 1}, 1fr)`,
          gap: 8,
          padding: "6px 10px",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          opacity: 0.5,
        }}
      >
        {columns.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: `1.6fr repeat(${columns.length - 1}, 1fr)`,
            gap: 8,
            padding: "9px 10px",
            fontSize: 12.5,
            borderTop: `1px solid rgba(${ink},0.06)`,
          }}
        >
          {r.map((cell, j) => (
            <div key={j} style={{ fontWeight: j === 0 ? 700 : 500 }}>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
