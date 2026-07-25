// src/components/exportSessionsModal.tsx
//
// Trench Sports — Export Session Summaries → CSV
//
// A configuration modal that lets a coach/admin export session_summaries as a
// downloadable CSV. The user picks:
//   • Time window   — presets (30/90d, all time) or a custom From/To range
//   • Athletes      — all, or a specific subset
//   • Session types — all modes, or a subset (power/accuracy/reaction/volume/target)
//   • Metrics       — which flattened columns land in the CSV
//
// The heavy `heatmap` blob is never selected; everything else is pulled from the
// session_summaries columns or the nested quality / peak_force_stats JSONB.

import React, { useMemo, useState } from "react";
import Modal from "./modal";
import { supabase } from "../supabaseClient";
import { IconCheck, IconX } from "./icons";

/* ─── Types ──────────────────────────────────────────────── */
export type ExportAthlete = {
  id: string;
  first_name: string;
  last_name: string;
  sport?: string | null;
  position?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  programId: string | null;
  userRole: string | null;
  coreTeamId: string | null;
  athletes: ExportAthlete[];
};

const MODES = ["power", "accuracy", "reaction", "volume", "target"] as const;
type Mode = typeof MODES[number];

const MODE_LABEL: Record<Mode, string> = {
  power: "Power",
  accuracy: "Accuracy",
  reaction: "Reaction",
  volume: "Volume",
  target: "Target",
};

type RangePreset = "30" | "90" | "all" | "custom";

/* ─── Metric catalog ─────────────────────────────────────────
   Each metric flattens one CSV column. `get` receives a raw
   session_summaries row (with `athletes` join) and returns a
   scalar suitable for a cell. Grouped for the picker UI.        */
type Row = Record<string, any>;
type Metric = { key: string; label: string; group: string; get: (r: Row) => string | number | null };

const num = (v: any, d = 1): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

const METRICS: Metric[] = [
  // Identity
  { key: "athlete", label: "Athlete", group: "Identity", get: (r) => r.athletes ? `${r.athletes.first_name} ${r.athletes.last_name}`.trim() : "Unknown" },
  { key: "date", label: "Date", group: "Identity", get: (r) => (r.date_of_record ? new Date(r.date_of_record).toISOString().slice(0, 10) : "") },
  { key: "mode", label: "Session Type", group: "Identity", get: (r) => (r.mode ? MODE_LABEL[r.mode as Mode] ?? r.mode : "") },
  { key: "session_id", label: "Session ID", group: "Identity", get: (r) => r.session_id ?? "" },
  // Session
  { key: "duration_s", label: "Duration (s)", group: "Session", get: (r) => num(r.session_duration_ms != null ? r.session_duration_ms / 1000 : null) },
  { key: "num_events", label: "Total Events", group: "Session", get: (r) => r.num_events ?? null },
  { key: "cadence_hz", label: "Cadence Avg (Hz)", group: "Session", get: (r) => num(r.cadence_hz_avg, 2) },
  { key: "longest_pause_ms", label: "Longest Pause (ms)", group: "Session", get: (r) => r.longest_pause_ms ?? null },
  // Power
  { key: "si_max", label: "Strength Index (max)", group: "Power", get: (r) => num(r.quality?.strength_index?.max, 0) },
  { key: "si_mean", label: "Strength Index (mean)", group: "Power", get: (r) => num(r.quality?.strength_index?.mean, 0) },
  { key: "peak_mv", label: "Peak Force (mV)", group: "Power", get: (r) => num(r.peak_force_stats?.peak_mv, 0) },
  { key: "avg_mv", label: "Avg Force (mV)", group: "Power", get: (r) => num(r.peak_force_stats?.avg_mv, 0) },
  // Accuracy
  { key: "accuracy_pct", label: "Accuracy (%)", group: "Accuracy", get: (r) => num(r.quality?.accuracy_pct) },
  { key: "avg_offset", label: "Avg Offset (cells)", group: "Accuracy", get: (r) => num(r.quality?.avg_offset_cells, 2) },
  // Reaction / Target
  { key: "avg_reaction_ms", label: "Avg Reaction (ms)", group: "Reaction & Target", get: (r) => num(r.quality?.avg_reaction_ms, 0) },
  { key: "best_reaction_ms", label: "Best Reaction (ms)", group: "Reaction & Target", get: (r) => num(r.quality?.best_reaction_ms, 0) },
  { key: "target_accuracy_pct", label: "Target Accuracy (%)", group: "Reaction & Target", get: (r) => num(r.quality?.target_accuracy_pct) },
  { key: "avg_reaction_correct_ms", label: "Avg Reaction — Correct (ms)", group: "Reaction & Target", get: (r) => num(r.quality?.avg_reaction_ms_correct, 0) },
  // Volume
  { key: "avg_window_hits", label: "Avg Window Hits", group: "Volume", get: (r) => num(r.quality?.avg_window_hits) },
  { key: "best_window_hits", label: "Best Window Hits", group: "Volume", get: (r) => num(r.quality?.best_window_hits, 0) },
];

// Columns selected on by default — a sensible cross-mode overview.
const DEFAULT_ON = new Set([
  "athlete", "date", "mode", "duration_s", "num_events",
  "si_max", "si_mean", "accuracy_pct", "avg_reaction_ms", "avg_window_hits",
]);

const METRIC_GROUPS = Array.from(new Set(METRICS.map((m) => m.group)));

/* ─── CSV helpers ────────────────────────────────────────── */
function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: Row[], cols: Metric[]): string {
  const header = cols.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

function downloadCsv(csv: string, filename: string) {
  // Prepend a UTF-8 BOM so Excel renders accents correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─── Small styled primitives (theme-aware via CSS vars) ─── */
const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${active ? "rgba(180,0,255,0.55)" : "var(--panel-border, rgba(255,255,255,0.12))"}`,
  background: active ? "rgba(180,0,255,0.14)" : "transparent",
  color: active ? "var(--text)" : "var(--muted)",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  opacity: 0.5,
  marginBottom: 8,
  display: "block",
};

/* ─── Component ──────────────────────────────────────────── */
export default function ExportSessionsModal({
  open, onClose, programId, userRole, coreTeamId, athletes,
}: Props) {
  const [preset, setPreset] = useState<RangePreset>("30");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [allAthletes, setAllAthletes] = useState(true);
  const [selectedAthletes, setSelectedAthletes] = useState<Set<string>>(new Set());

  const [selectedModes, setSelectedModes] = useState<Set<Mode>>(new Set(MODES));

  const [cols, setCols] = useState<Set<string>>(new Set(DEFAULT_ON));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultMsg, setResultMsg] = useState("");

  const sortedAthletes = useMemo(
    () => [...athletes].sort((a, b) => `${a.last_name}`.localeCompare(`${b.last_name}`)),
    [athletes]
  );

  const selectedCols = useMemo(() => METRICS.filter((m) => cols.has(m.key)), [cols]);

  function toggle<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  }

  function reset() {
    setBusy(false); setError(""); setResultMsg("");
  }

  async function handleExport() {
    if (!programId || !supabase) { setError("Not connected to a program."); return; }
    if (selectedCols.length === 0) { setError("Select at least one metric column."); return; }
    if (selectedModes.size === 0) { setError("Select at least one session type."); return; }
    if (!allAthletes && selectedAthletes.size === 0) { setError("Select at least one athlete, or choose All."); return; }

    setBusy(true); setError(""); setResultMsg("");
    try {
      let q = supabase
        .from("session_summaries")
        .select(
          "session_id, athlete_id, mode, num_events, session_duration_ms, cadence_hz_avg, longest_pause_ms, peak_force_stats, quality, date_of_record, athletes(first_name, last_name)"
        )
        .eq("program_id", programId)
        .order("date_of_record", { ascending: false });

      // Coach scoping — mirror the leaderboard behavior.
      if (userRole === "coach" && coreTeamId) q = q.eq("core_team_id", coreTeamId);

      // Session types
      if (selectedModes.size < MODES.length) q = q.in("mode", Array.from(selectedModes));

      // Athletes
      if (!allAthletes) q = q.in("athlete_id", Array.from(selectedAthletes));

      // Time window
      if (preset === "30" || preset === "90") {
        const d = new Date();
        d.setDate(d.getDate() - Number(preset));
        q = q.gte("date_of_record", d.toISOString());
      } else if (preset === "custom") {
        if (fromDate) q = q.gte("date_of_record", new Date(fromDate).toISOString());
        if (toDate) {
          // inclusive end-of-day
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          q = q.lte("date_of_record", end.toISOString());
        }
      }

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;

      const rows = (data ?? []) as Row[];
      if (rows.length === 0) {
        setError("No sessions match those filters. Try widening the time window or athlete selection.");
        setBusy(false);
        return;
      }

      const csv = buildCsv(rows, selectedCols);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(csv, `trench-session-summaries-${stamp}.csv`);
      setResultMsg(`Exported ${rows.length} session${rows.length === 1 ? "" : "s"} · ${selectedCols.length} columns.`);
    } catch (err: any) {
      setError(err?.message ?? "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() { reset(); onClose(); }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Export Session Summaries"
      size="lg"
      footer={
        <>
          <button type="button" className="ts-btn ts-btnGhost" onClick={handleClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="ts-btn ts-btnPrimary" onClick={handleExport} disabled={busy}>
            {busy ? "Exporting…" : "Export CSV"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22, fontSize: 14 }}>

        {/* Time window */}
        <div>
          <label style={sectionLabel}>Time Window</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"], ["custom", "Custom range"]] as [RangePreset, string][]).map(([val, lbl]) => (
              <button key={val} type="button" style={chip(preset === val)} onClick={() => setPreset(val)}>
                {lbl}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <DateField label="From" value={fromDate} max={toDate || undefined} onChange={setFromDate} />
              <DateField label="To" value={toDate} min={fromDate || undefined} onChange={setToDate} />
            </div>
          )}
        </div>

        {/* Session types */}
        <div>
          <label style={sectionLabel}>Session Types</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={chip(selectedModes.size === MODES.length)} onClick={() => setSelectedModes(new Set(MODES))}>
              All
            </button>
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                style={chip(selectedModes.has(m) && selectedModes.size < MODES.length)}
                onClick={() => setSelectedModes((s) => {
                  const next = toggle(s, m);
                  return next.size === 0 ? new Set(MODES) : next;
                })}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Athletes */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ ...sectionLabel, marginBottom: 0 }}>Athletes</label>
            {!allAthletes && sortedAthletes.length > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={{ ...chip(false), padding: "3px 9px", fontSize: 11 }} onClick={() => setSelectedAthletes(new Set(sortedAthletes.map((a) => a.id)))}>
                  Select all
                </button>
                <button type="button" style={{ ...chip(false), padding: "3px 9px", fontSize: 11 }} onClick={() => setSelectedAthletes(new Set())}>
                  Clear
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: allAthletes ? 0 : 10 }}>
            <button type="button" style={chip(allAthletes)} onClick={() => setAllAthletes(true)}>
              All athletes
            </button>
            <button type="button" style={chip(!allAthletes)} onClick={() => setAllAthletes(false)}>
              Choose specific…
            </button>
            {!allAthletes && (
              <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, opacity: 0.5 }}>
                {selectedAthletes.size} selected
              </span>
            )}
          </div>
          {!allAthletes && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 240,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {sortedAthletes.length === 0 && <span style={{ opacity: 0.5, fontSize: 12 }}>No athletes loaded.</span>}
              {sortedAthletes.map((a) => (
                <AthleteRow
                  key={a.id}
                  athlete={a}
                  selected={selectedAthletes.has(a.id)}
                  onToggle={() => setSelectedAthletes((s) => toggle(s, a.id))}
                />
              ))}
            </div>
          )}
        </div>

        {/* Metrics */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ ...sectionLabel, marginBottom: 0 }}>Metrics ({selectedCols.length})</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={{ ...chip(false), padding: "3px 9px", fontSize: 11 }} onClick={() => setCols(new Set(METRICS.map((m) => m.key)))}>
                Select all
              </button>
              <button type="button" style={{ ...chip(false), padding: "3px 9px", fontSize: 11 }} onClick={() => setCols(new Set(DEFAULT_ON))}>
                Reset
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {METRIC_GROUPS.map((group) => (
              <div key={group}>
                <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.42, marginBottom: 6 }}>{group}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {METRICS.filter((m) => m.group === group).map((m) => (
                    <button key={m.key} type="button" style={chip(cols.has(m.key))} onClick={() => setCols((s) => toggle(s, m.key))}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        {error && (
          <div style={{ fontSize: 13, color: "#ff6b6b", background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)", borderRadius: 10, padding: "10px 12px" }}>
            {error}
          </div>
        )}
        {resultMsg && !error && (
          <div style={{ fontSize: 13, color: "var(--accent)", background: "rgba(180,0,255,0.08)", border: "1px solid rgba(180,0,255,0.28)", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 7 }}>
            <IconCheck size={15} /> {resultMsg}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Date field — mirrors the "Date of Birth" field in editProfile ─────────── */
function DateField({
  label, value, onChange, min, max,
}: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "var(--muted, rgba(255,255,255,0.65))", letterSpacing: "0.02em" }}>
        {label}
      </label>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 13px",
          borderRadius: 12,
          border: `1px solid ${focused ? "var(--accent, #b400ff)" : "var(--btn-border, rgba(255,255,255,0.14))"}`,
          background: "var(--btn-bg, rgba(255,255,255,0.04))",
          color: "var(--text, rgba(255,255,255,0.92))",
          fontSize: 15,
          outline: "none",
          boxShadow: focused ? "0 0 0 3px rgba(180,0,255,0.14)" : "none",
          transition: "border-color 160ms ease, box-shadow 160ms ease",
        }}
      />
    </div>
  );
}

/* ─── Initials avatar — copied from manageTeam ──────────────────────────────── */
function Initials({ first, last, size = 34 }: { first?: string; last?: string; size?: number }) {
  const text = [first, last].filter(Boolean).map((w) => w![0]?.toUpperCase()).join("");
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10))",
        border: "1px solid rgba(180,0,255,0.30)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.34,
        fontWeight: 700,
        color: "rgba(200,120,255,0.95)",
        letterSpacing: "0.02em",
      }}
    >
      {text || "?"}
    </div>
  );
}

/* ─── Athlete row — check/x toggle styled after manageTeam's RosterRow ───────── */
function AthleteRow({
  athlete, selected, onToggle,
}: { athlete: ExportAthlete; selected: boolean; onToggle: () => void }) {
  const [hovered, setHovered] = useState(false);
  const sub = [athlete.sport, athlete.position].filter(Boolean).join(" · ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        borderRadius: 11,
        cursor: "pointer",
        border: `1px solid ${selected ? "rgba(180,0,255,0.30)" : "rgba(255,255,255,0.06)"}`,
        background: selected
          ? "rgba(180,0,255,0.07)"
          : hovered ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.015)",
        transition: "background 130ms ease, border-color 130ms ease",
      }}
    >
      <Initials first={athlete.first_name} last={athlete.last_name} size={34} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {`${athlete.first_name} ${athlete.last_name}`.trim()}
        </div>
        {sub && <div style={{ fontSize: 11, opacity: 0.5, marginTop: 1 }}>{sub}</div>}
      </div>

      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 8,
          border: selected ? "1px solid rgba(60,210,120,0.28)" : "1px solid rgba(255,80,80,0.25)",
          background: selected ? "rgba(60,210,120,0.08)" : "rgba(255,80,80,0.08)",
          color: selected ? "rgba(80,220,140,0.95)" : "rgba(255,120,120,0.90)",
          transform: hovered ? "scale(1.08)" : "scale(1)",
          transition: "background 140ms ease, border-color 140ms ease, transform 140ms ease",
        }}
      >
        {selected ? <IconCheck size={16} /> : <IconX size={16} />}
      </span>
    </div>
  );
}
