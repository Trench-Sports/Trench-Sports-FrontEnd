// src/components/sessionSettings.tsx
//
// Trench Sports — Session Settings Modal
//
// Usage:
//   import SessionSettingsModal from "./sessionSettings";
//
//   <SessionSettingsModal
//     open={showSettings}
//     onClose={() => setShowSettings(false)}
//   />
//
// Behaviour:
//   • Reads / writes via the useSessionSettings hook (localStorage-backed).
//   • Settings exposed in this round:
//       Session Timer  — 30 / 45 / 60 s  (maps to SESSION_MAX_MS; warning
//                                          fires 5 s before the cap and so
//                                          rescales automatically).
//       Default Metric — V or SI         (initial feedMetric for new
//                                          sessions; the per-session toggle
//                                          in the stats panel still works).
//       Auto-save      — toggle          (when on, saveSession() is called
//                                          automatically after stopSession;
//                                          off preserves the manual Save /
//                                          Discard flow for warm-up reps).
//   • Future phases fold VOLUME_WINDOW_MS and the mV thresholds in mvToColor
//     / mvToGlow into the same SessionSettings object.

import React, { useState } from "react";
import Modal from "./modal";
import {
  useSessionSettings,
  warnMsFor,
  type SessionTimerMs,
  type DefaultMetric,
} from "../lib/sessionSettings";

// ─── Shared field styles (mirrors createAthlete / editAthlete) ───────────────

const F = {
  group: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--muted, rgba(255,255,255,0.65))",
    letterSpacing: "0.02em",
  },
  helper: {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--muted, rgba(255,255,255,0.55))",
    lineHeight: 1.5,
    marginTop: "2px",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.07)",
    margin: "4px 0",
  },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--muted, rgba(255,255,255,0.45))",
    marginBottom: "2px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
};

// ─── Option lists ────────────────────────────────────────────────────────────

const TIMER_OPTIONS: { value: SessionTimerMs; label: string }[] = [
  { value: 30_000, label: "30s" },
  { value: 45_000, label: "45s" },
  { value: 60_000, label: "60s" },
];

const METRIC_OPTIONS: { value: DefaultMetric; label: string; hint: string }[] = [
  { value: "v",  label: "V",  hint: "Volume — raw peak voltage per impact." },
  { value: "si", label: "SI", hint: "Strength Index — rate-based composite metric." },
];

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * @param props
 * @param props.open    — controlled open state
 * @param props.onClose — called when the modal should close
 */
export default function SessionSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [settings, update] = useSessionSettings();

  // ── Footer ──────────────────────────────────────────────────────────────
  const footer = (
    <button
      type="button"
      className="ts-btn ts-btnPrimary"
      onClick={onClose}
    >
      Done
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Session Settings"
      size="sm"
      footer={footer}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

        {/* ── Timing ───────────────────────────────────────────────────── */}
        <div style={F.sectionLabel}>Timing</div>
        <div style={F.group}>
          <div style={F.row}>
            <label style={F.label}>Session Timer</label>
            <SegmentedControl<SessionTimerMs>
              options={TIMER_OPTIONS}
              value={settings.timerMs}
              onChange={v => update({ timerMs: v })}
              ariaLabel="Session timer duration"
            />
          </div>
          <div style={F.helper}>
            Sessions auto-stop after this duration. The warning cue fires{" "}
            <strong>5 s before</strong> the cap (currently at{" "}
            {(warnMsFor(settings.timerMs) / 1000).toFixed(0)} s).
          </div>
        </div>

        <div style={F.divider} />

        {/* ── Display ──────────────────────────────────────────────────── */}
        <div style={F.sectionLabel}>Display</div>
        <div style={F.group}>
          <div style={F.row}>
            <label style={F.label}>Default Metric</label>
            <SegmentedControl<DefaultMetric>
              options={METRIC_OPTIONS}
              value={settings.defaultMetric}
              onChange={v => update({ defaultMetric: v })}
              ariaLabel="Default metric for new sessions"
            />
          </div>
          <div style={F.helper}>
            Which stat shows first each session.
            {settings.defaultMetric === "v"
              ? " Currently set to Volume (raw peak voltage per impact)."
              : " Currently set to Strength Index (rate-based composite)."}
          </div>
        </div>

        <div style={F.divider} />

        {/* ── Saving ───────────────────────────────────────────────────── */}
        <div style={F.sectionLabel}>Saving</div>
        <div style={F.group}>
          <div style={F.row}>
            <label style={F.label}>Auto-save Sessions</label>
            <Toggle
              checked={settings.autoSave}
              onChange={v => update({ autoSave: v })}
              ariaLabel="Auto-save sessions"
            />
          </div>
          <div style={F.helper}>
            {settings.autoSave
              ? "Sessions are saved to Supabase automatically as soon as they end."
              : "Manual save only — useful for warm-up reps you don't want in the record. The Save / Discard buttons appear after each session ends."}
          </div>
        </div>

      </div>
    </Modal>
  );
}

// ─── SegmentedControl ────────────────────────────────────────────────────────

function SegmentedControl<T extends string | number>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        background: "var(--btn-bg, rgba(255,255,255,0.04))",
        border: "1px solid var(--btn-border, rgba(255,255,255,0.10))",
        borderRadius: "10px",
        padding: 3,
        gap: 2,
        flexShrink: 0,
      }}
    >
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            style={{
              minWidth: 44,
              padding: "6px 12px",
              borderRadius: "8px",
              border: active
                ? "1px solid rgba(180,0,255,0.55)"
                : "1px solid transparent",
              background: active
                ? "rgba(180,0,255,0.18)"
                : "transparent",
              color: active
                ? "var(--accent, #b400ff)"
                : "var(--text, rgba(255,255,255,0.78))",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        flexShrink: 0,
        width: 44, height: 24,
        borderRadius: 12,
        border: "1px solid " + (checked
          ? "rgba(180,0,255,0.55)"
          : "var(--btn-border, rgba(255,255,255,0.12))"),
        background: checked
          ? "rgba(180,0,255,0.30)"
          : "var(--btn-bg, rgba(255,255,255,0.06))",
        cursor: "pointer",
        padding: 0,
        transition: "background 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
        boxShadow: hover
          ? "0 0 0 3px rgba(180,0,255,0.10)"
          : "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2, left: checked ? 22 : 2,
          width: 18, height: 18, borderRadius: "50%",
          background: checked
            ? "var(--accent, #b400ff)"
            : "rgba(255,255,255,0.85)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
          transition: "left 160ms cubic-bezier(0.22,1,0.36,1), background 160ms ease",
        }}
      />
    </button>
  );
}
