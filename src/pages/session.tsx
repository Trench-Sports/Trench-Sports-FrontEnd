// src/pages/session.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useSignalAudio } from "../hooks/signalAudio";
import type { ZoneTarget, ZoneRow, ZoneCol } from "../hooks/signalAudio";
import {
  connectToAdapter,
  disconnect as adapterDisconnect,
  startNotifications as adapterStartNotifications,
  writeUtf8,
  getBleConfig,
  isNativeApp,
  getBluetoothDiagnostics,
  type AdapterConnection,
} from "../bluetooth/adapter";
import {
  scanForDevices,
  stopScan,
  connectToDeviceNative,
  classifyDevice,
  getBleNamePrefixes,
  isUserCancel,
  type ScannedDevice,
} from "../bluetooth/adapter_native";

// ─── BLE / NUS constants (mirror of ble_connect.py) ──────────────────────────
// These are the fallback values used when .env vars are absent.
const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX_CHAR      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";  // ESP32 → app (notify)
const NUS_RX_CHAR      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";  // app → ESP32 (write)

// Resolved at runtime — prefers .env, falls back to constants above
function getCharUuids() {
  const cfg = getBleConfig();
  return {
    TX: cfg.CHAR_UUID_TX ?? NUS_TX_CHAR,
    RX: cfg.CHAR_UUID_RX ?? NUS_RX_CHAR,
  };
}

const NUM_ROWS       = 12;
const NUM_COLS       = 8;
const FADE_TTL_MS    = 400;
// Mirrors ESP32 SCAN_PERIOD_MS — used as a duration floor for single-frame events
// where t_start == t_end (contact resolved and released within one scan cycle).
const SCAN_PERIOD_MS = 37;
const VOLUME_WINDOW_MS = 5000;  // 5-second recording window for volume mode
const CHUNK_RE    = /^C(\d{2})\/(\d{2}):/;

// ─── Mode config (mirrors hitSimulator) ──────────────────────────────────────
const MODES = ["power", "accuracy", "reaction", "volume", "target"] as const;
type SessionMode = typeof MODES[number];

const MODE_META: Record<SessionMode, { icon: string; label: string; color: string; glow: string; desc: string }> = {
  power: {
    icon: "💥", label: "Power",
    color: "#b400ff", glow: "rgba(180,0,255,0.55)",
    desc: "Strike any zone. Every impact is captured — force and placement logged in real time.",
  },
  accuracy: {
    icon: "🎯", label: "Accuracy",
    color: "#00dcff", glow: "rgba(0,220,255,0.55)",
    desc: "Precision mode. Each strike is scored by how close you land to the bullseye.",
  },
  reaction: {
    icon: "⚡️", label: "Reaction",
    color: "#ffcc00", glow: "rgba(255,200,0,0.55)",
    desc: "Wait for the HIT! signal, then strike as fast as you can. Reaction time measured to impact.",
  },
  volume: {
    icon: "🥊", label: "Volume",
    color: "#ff6a00", glow: "rgba(255,106,0,0.55)",
    desc: "Wait for the HIT! signal, then throw as many strikes as possible in 5 seconds. Score = total hits.",
  },
  target: {
    icon: "🏹", label: "Target",
    color: "#00ff88", glow: "rgba(0,255,136,0.55)",
    desc: "Listen for the zone cue, then strike that section of the bag. Reaction time and accuracy both scored.",
  },
};

// ─── Target mode — zone mapping ───────────────────────────────────────────────
// Grid is 12 rows × 8 cols (1-indexed from ESP32).
// Rows:    top = 9–12, middle = 5–8, bottom = 1–4
// Columns: left = 1–2, center = 3–6, right = 7–8
const ALL_ZONES: ZoneTarget[] = [
  { row: "top",    col: "left"   }, { row: "top",    col: "center" }, { row: "top",    col: "right"  },
  { row: "middle", col: "left"   }, { row: "middle", col: "center" }, { row: "middle", col: "right"  },
  { row: "bottom", col: "left"   }, { row: "bottom", col: "center" }, { row: "bottom", col: "right"  },
];

function randomZone(): ZoneTarget {
  return ALL_ZONES[Math.floor(Math.random() * ALL_ZONES.length)];
}

function hitZone(row: number, col: number): ZoneTarget {
  const zRow: ZoneRow = row >= 9 ? "top" : row >= 5 ? "middle" : "bottom";
  const zCol: ZoneCol = col <= 2 ? "right" : col <= 6 ? "center" : "left";
  return { row: zRow, col: zCol };
}

function zonesMatch(a: ZoneTarget, b: ZoneTarget): boolean {
  return a.row === b.row && a.col === b.col;
}

// ─── TargetOverlay ────────────────────────────────────────────────────────────
function TargetOverlay({
  phase,
  zone,
  reactionMs,
  zoneHit,
  correct,
  tgtAttempts,
  tgtHits,
}: {
  phase: string;
  zone: ZoneTarget | null;
  reactionMs: number | null;
  zoneHit: ZoneTarget | null;
  correct: boolean | null;
  tgtAttempts: number;
  tgtHits: number;
}) {
  const ZONE_COLOR = "#00ff88";
  const ZONE_GLOW  = "rgba(0,255,136,0.55)";

  const zoneLabel = (z: ZoneTarget) =>
    `${z.row.charAt(0).toUpperCase() + z.row.slice(1)} ${z.col.charAt(0).toUpperCase() + z.col.slice(1)}`;

  // Waiting — pulsing ready indicator
  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.62)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>
        Get ready…
      </div>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1.1s ease-in-out infinite",
      }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
      </div>
    </div>
  );

  // Signal — show the 3×3 grid with target zone highlighted + zone label
  if (phase === "signal" && zone) return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.70)", borderRadius: 16, pointerEvents: "none",
      animation: "tsFlashIn 0.15s ease-out",
    }}>
      {/* Zone label */}
      <div style={{
        fontSize: 22, fontWeight: 900, color: ZONE_COLOR,
        textShadow: `0 0 20px ${ZONE_COLOR}, 0 0 40px ${ZONE_GLOW}`,
        letterSpacing: 2, textTransform: "uppercase", marginBottom: 14,
        animation: "tsSignalPop 0.2s ease-out",
      }}>
        {zoneLabel(zone)}
      </div>

      {/* 3×3 grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 52px)", gridTemplateRows: "repeat(3, 36px)", gap: 4 }}>
        {(["top", "middle", "bottom"] as ZoneRow[]).map(r =>
          (["left", "center", "right"] as ZoneCol[]).map(c => {
            const isTarget = zone.row === r && zone.col === c;
            return (
              <div key={`${r}-${c}`} style={{
                borderRadius: 6,
                border: isTarget ? `2px solid ${ZONE_COLOR}` : "1px solid rgba(255,255,255,0.15)",
                background: isTarget ? `${ZONE_COLOR}30` : "rgba(255,255,255,0.04)",
                boxShadow: isTarget ? `0 0 14px 2px ${ZONE_GLOW}` : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 700, color: isTarget ? ZONE_COLOR : "rgba(255,255,255,0.25)",
                letterSpacing: "0.04em", textTransform: "uppercase",
                transition: "all 150ms",
              }}>
                {isTarget ? "●" : ""}
              </div>
            );
          })
        )}
      </div>
      <div style={{ fontSize: 10, color: "rgba(0,255,136,0.55)", letterSpacing: 2, textTransform: "uppercase", marginTop: 12 }}>
        Strike now
      </div>
    </div>
  );

  // Result — show RT + whether zone was correct
  if (phase === "result" && reactionMs !== null) {
    const rtColor = reactionMs < 300 ? "#00ff88" : reactionMs < 500 ? "#ffcc00" : "#ff6060";
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", zIndex: 8,
        background: "rgba(0,0,0,0.60)", borderRadius: 16, pointerEvents: "none",
      }}>
        {/* Correct / Wrong badge */}
        <div style={{
          fontSize: 13, fontWeight: 800,
          color: correct ? "#00ff88" : "#ff6060",
          background: correct ? "rgba(0,255,136,0.12)" : "rgba(255,60,60,0.12)",
          border: `1px solid ${correct ? "rgba(0,255,136,0.35)" : "rgba(255,60,60,0.35)"}`,
          borderRadius: 8, padding: "4px 12px", marginBottom: 10, letterSpacing: 1,
          animation: "tsResultPop 0.25s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          {correct ? "✓ Correct Zone" : `✗ Wrong — Hit ${zoneHit ? zoneLabel(zoneHit) : "?"}`}
        </div>

        {/* Reaction time */}
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
          Reaction Time
        </div>
        <div style={{
          fontSize: 38, fontWeight: 900, color: rtColor,
          textShadow: `0 0 18px ${rtColor}`,
          animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {reactionMs}ms
        </div>

        {/* Running accuracy */}
        {tgtAttempts > 0 && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 8 }}>
            {tgtHits}/{tgtAttempts} zones correct
          </div>
        )}
      </div>
    );
  }

  // Early — hit before signal
  if (phase === "early") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(255,60,60,0.18)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6060" }}>Too Early!</div>
      <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", marginTop: 6, letterSpacing: 1 }}>Wait for the signal</div>
    </div>
  );

  return null;
}

// ─── ReactionOverlay ──────────────────────────────────────────────────────────
function ReactionOverlay({ phase, reactionMs }: { phase: string; reactionMs: number | null }) {
  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.62)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>
        Get ready…
      </div>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1.1s ease-in-out infinite",
      }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
      </div>
    </div>
  );

  if (phase === "signal") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(255,200,0,0.18)", borderRadius: 16, pointerEvents: "none",
      animation: "tsFlashIn 0.15s ease-out",
    }}>
      <div style={{
        fontSize: 38, fontWeight: 900, color: "#ffcc00",
        textShadow: "0 0 24px #ffcc00, 0 0 48px rgba(255,200,0,0.6)",
        letterSpacing: 2, animation: "tsSignalPop 0.2s ease-out",
      }}>HIT!</div>
      <div style={{ fontSize: 11, color: "rgba(255,200,0,0.7)", letterSpacing: 3, textTransform: "uppercase", marginTop: 6 }}>
        Strike now
      </div>
    </div>
  );

  if (phase === "result" && reactionMs !== null) return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.50)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,200,0,0.7)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
        Reaction Time
      </div>
      <div style={{
        fontSize: 42, fontWeight: 900,
        color: reactionMs < 300 ? "#00ff88" : reactionMs < 500 ? "#ffcc00" : "#ff6060",
        textShadow: `0 0 20px ${reactionMs < 300 ? "#00ff88" : reactionMs < 500 ? "#ffcc00" : "#ff6060"}`,
        animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {reactionMs}ms
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
        {reactionMs < 250 ? "Elite ⚡" : reactionMs < 350 ? "Sharp 🔥" : reactionMs < 500 ? "Good 👍" : "Keep Training 💪"}
      </div>
    </div>
  );

  if (phase === "early") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(255,60,60,0.18)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6060" }}>Too Early!</div>
      <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", marginTop: 6, letterSpacing: 1 }}>Wait for the signal</div>
    </div>
  );

  return null;
}

function VolumeOverlay({
  phase,
  hits,
  remainingMs,
}: {
  phase: string;
  hits: number;
  remainingMs: number;
}) {
  if (phase === "waiting") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.62)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>
        Get ready…
      </div>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "tsPulseWait 1.1s ease-in-out infinite",
      }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
      </div>
    </div>
  );

  if (phase === "signal") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(255,106,0,0.18)", borderRadius: 16, pointerEvents: "none",
      animation: "tsFlashIn 0.15s ease-out",
    }}>
      <div style={{
        fontSize: 48, fontWeight: 900, color: "#ff6a00",
        textShadow: "0 0 24px #ff6a00, 0 0 48px rgba(255,106,0,0.6)",
        letterSpacing: 2, animation: "tsSignalPop 0.2s ease-out",
        marginBottom: 20,
      }}>HIT!</div>
      <div style={{ marginTop: 0, fontSize: 42, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
        {hits}
      </div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
        {((VOLUME_WINDOW_MS - remainingMs) / 1000).toFixed(1)}s / 5.0s
      </div>
    </div>
  );

  if (phase === "result") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(0,0,0,0.50)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,160,90,0.85)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
        Volume Score
      </div>
      <div style={{
        fontSize: 48, fontWeight: 900, color: "#ff6a00",
        textShadow: "0 0 20px #ff6a00",
        animation: "tsResultPop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {hits}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 6 }}>
        Total hits in 5 seconds
      </div>
    </div>
  );

  if (phase === "early") return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 8,
      background: "rgba(255,60,60,0.18)", borderRadius: 16, pointerEvents: "none",
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6060" }}>Too Early!</div>
      <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", marginTop: 6, letterSpacing: 1 }}>Wait for the signal</div>
    </div>
  );

  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type BleStatus = "idle" | "scanning" | "connected" | "disconnected" | "unsupported";
type SaveState = "idle" | "saving" | "saved" | "error";

// Identity packet sent by ESP32 immediately after BLE connect
type DeviceInfo = { id: string; fw: string; rows: number; cols: number } | null;

type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  sport: string | null;
  core_team_id: string;
};

// Enriched hit tuple from ESP32 firmware (scan_frame_tracked)
// [row, col, mv_int, t_first_ms, t_peak_ms, v_peak_mv, is_new]
//   mv_int     — current voltage reading × 1000 (integer millivolts, this frame)
//   t_first_ms — ESP32 uptime when this cell first crossed the threshold
//   t_peak_ms  — ESP32 uptime when the highest voltage was recorded for this cell
//   v_peak_mv  — highest mv seen since the cell became active
//   is_new     — 1 on the very first frame for this cell, 0 thereafter
type RichHit = [number, number, number, number, number, number, number];

// One raw BLE frame — maps to one row in `events`
type BleFrame = {
  event_id:         string;                      // e.g. "ses_…_e00042"
  t_device_ms:      number;                      // ESP32 device uptime ms (`t` field — current frame)
  epoch_ms:         number;                      // wall-clock ms when received
  hits:             RichHit[];                   // [row, col, mv, t_first_ms, t_peak_ms, v_peak_mv, is_new]
  raw:              object;                      // original parsed JSON from ESP32
  reaction_time_ms: number | null;               // signal-to-impact ms (reaction + target modes)
  // ── Target mode ──────────────────────────────────────────────────────────────
  target_zone:      ZoneTarget | null;           // zone that was cued for this attempt
  zone_correct:     boolean | null;              // whether the athlete hit the correct zone
  // ── Volume mode ──────────────────────────────────────────────────────────────
  vol_window_idx:   number | null;               // which window (0-indexed) this hit belongs to
  vol_hit_seq:      number | null;               // ordinal position of this hit within its window (1, 2, 3…)
};

type CellState = { mv: number; ts: number };
type GridState  = Map<string, CellState>;    // key = "r,c"

// ─── Chunk reassembler (mirrors ChunkAssembler in ble_connect.py) ────────────
class ChunkAssembler {
  private total: number | null = null;
  private parts: Record<number, string> = {};
  private lastTs = Date.now();

  push(text: string): string | null {
    const m = CHUNK_RE.exec(text);
    if (!m) { this.reset(); return text; }
    const idx     = parseInt(m[1], 10);
    const total   = parseInt(m[2], 10);
    const payload = text.slice(m[0].length);
    if (this.total !== total) { this.total = total; this.parts = {}; }
    this.parts[idx] = payload;
    this.lastTs = Date.now();
    if (Object.keys(this.parts).length === total) {
      const out = Array.from({ length: total }, (_, i) => this.parts[i + 1] ?? "").join("");
      this.reset();
      return out;
    }
    return null;
  }

  maybeTimeout(ms = 2000) {
    if (this.total !== null && Date.now() - this.lastTs > ms) this.reset();
  }

  private reset() { this.total = null; this.parts = {}; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cellKey(r: number, c: number) { return `${r},${c}`; }

function mvToColor(mv: number): string {
  const v = mv / 1000;
  if (v >= 0.5) return "#b400ff";
  if (v >= 0.2) return "#ffcc00";
  return "rgba(255,255,255,0.55)";
}

function mvToGlow(mv: number): string {
  const v = mv / 1000;
  if (v >= 0.5) return "rgba(180,0,255,0.70)";
  if (v >= 0.2) return "rgba(255,200,0,0.60)";
  return "rgba(255,255,255,0.35)";
}

function formatTime(ms: number) {
  const s  = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function genSessionId() {
  return `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// Returns true if `latest` is strictly newer than `current` (semver major.minor.patch)
function fwIsOutdated(current: string, latest: string): boolean {
  const parse = (v: string) => v.split(".").map(n => parseInt(n, 10) || 0);
  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

function hexAlpha(fraction: number) {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 255)
    .toString(16).padStart(2, "0");
}

// ─── Supabase upload ──────────────────────────────────────────────────────────
/**
 * Writes a completed session to Supabase in four sequential steps:
 *   1. sessions          — one row
 *   2. events            — one row per BLE frame, enriched with iei, angle, strength_index
 *   3. event_cells       — one row per cell hit per frame (chunked)
 *   4. session_summaries — one fully computed summary row
 *
 * Per-event computed fields (no calibration needed):
 *   • iei_prev_ms   — wall-clock gap since previous event
 *   • angle_deg     — direction of hit centroid from grid center (0° = right, CCW+)
 *   • quality.strength_index (0–1000):
 *       speed component  (40%) — normalised IEI: fast cadence scores higher
 *       voltage component (60%) — normalised peak mv: harder hits score higher
 *       formula: (speedNorm × 0.4 + voltNorm × 0.6) × 1000  [voltNorm = mv / 3300]
 */

// ── helpers (module-level, no closure deps) ──────────────────────────────────
function statSummary(vals: number[]): { mean: number; min: number; max: number; std: number } | null {
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { mean: +mean.toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3), std: +std.toFixed(3) };
}

function eventAngleDeg(hits: RichHit[]): number | null {
  if (!hits.length) return null;
  // Centroid of all hit cells in this frame (weighted by mv)
  const totalMv = hits.reduce((s, [,, mv]) => s + mv, 0);
  const centerR = (NUM_ROWS + 1) / 2;   // 6.5
  const centerC = (NUM_COLS + 1) / 2;   // 4.5
  const cR = hits.reduce((s, [r,, mv]) => s + r * mv, 0) / totalMv;
  const cC = hits.reduce((s, [, c, mv]) => s + c * mv, 0) / totalMv;
  const angleDeg = Math.atan2(cR - centerR, cC - centerC) * (180 / Math.PI);
  return +angleDeg.toFixed(1);
}

function strengthIndex(iei: number | null, peakMv: number): number {
  // Speed: IEI ≤ 100ms = maximum (rapid bursts), IEI ≥ 2000ms = zero (resting pace)
  const MIN_IEI = 100;
  const MAX_IEI = 2000;
  const speedNorm = iei == null
    ? 0.5  // first event of session — neutral speed
    : Math.max(0, Math.min(1, 1 - (iei - MIN_IEI) / (MAX_IEI - MIN_IEI)));

  // Voltage: 3300 mv = 3.3V = full sensor range → full score
  const voltNorm = Math.max(0, Math.min(1, peakMv / 3300));

  return Math.round((speedNorm * 0.4 + voltNorm * 0.6) * 1000);
}

function impulseIndex(si: number, cellCount: number): number {
  // Impulse = area effect × strength.
  // A large spread of cells with a high SI scores highest;
  // a pinpoint hit (even with high SI) scores lower.
  //   areaNorm  = cells contacted / total grid cells (0–1)
  //   siNorm    = strength index / 1000            (0–1)
  //   result    = areaNorm × siNorm × 1000         (0–1000)
  const areaNorm = Math.min(1, cellCount / (NUM_ROWS * NUM_COLS));
  const siNorm   = si / 1000;
  return Math.round(areaNorm * siNorm * 1000);
}

function accuracyScore(hits: RichHit[]): number | null {
  // Only meaningful in accuracy mode — returns null for other modes.
  // Score 0–100: the mv-weighted centroid distance from the grid centre,
  // normalised so the 4 centre cells = 100 and the outer corners = 0.
  // Mirrors the hitSimulator.jsx bullseye logic exactly.
  if (!hits.length) return null;
  const cx = (NUM_COLS - 1) / 2;  // 3.5 for 8-col grid
  const cy = (NUM_ROWS - 1) / 2;  // 5.5 for 12-row grid
  const MAX_DIST    = Math.sqrt(cx * cx + cy * cy);
  const BULL_DIST   = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5); // radius of 2×2 bullseye ≈ 0.707

  // mv-weighted centroid
  const totalMv = hits.reduce((s, [,, mv]) => s + mv, 0);
  const cR = hits.reduce((s, [r,, mv]) => s + r * mv, 0) / totalMv;
  const cC = hits.reduce((s, [, c, mv]) => s + c * mv, 0) / totalMv;
  const rawDist = Math.sqrt((cC - cx) ** 2 + (cR - cy) ** 2);

  const normDist = rawDist <= BULL_DIST
    ? 0
    : Math.min(1, (rawDist - BULL_DIST) / (MAX_DIST - BULL_DIST));
  return Math.round((1 - normDist) * 100);
}

async function uploadSession(opts: {
  sessionId:    string;
  programId:    string;
  athleteId:    string;
  coreTeamId:   string | null;
  createdBy:    string;
  frames:       BleFrame[];
  startedAtMs:  number;
  endedAtMs:    number;
  mode?:        string;
  deviceModel?: string;
  samplingHz?:  number;
  // reaction mode live stats
  rxBestMs?:    number | null;
  rxAvgMs?:     number | null;
  rxAttempts?:  number;
  // accuracy mode live stats
  accHitsCount?: number;
  accScoreSum?:  number;
  // target mode live stats
  tgtAttempts?:     number;
  tgtCorrectHits?:  number;
  tgtCorrectSumMs?: number;
  tgtBestMs?:       number | null;
  // physical device
  deviceId?:    string;
}) {
  if (!supabase) throw new Error("Supabase client not initialised");

  const {
    sessionId, programId, athleteId, coreTeamId,
    createdBy, frames, startedAtMs, endedAtMs, mode = "power",
    deviceModel = "TSII", samplingHz = 25,
    rxBestMs = null, rxAvgMs = null, rxAttempts = 0,
    accHitsCount = 0, accScoreSum = 0,
    tgtAttempts = 0, tgtCorrectHits = 0, tgtCorrectSumMs = 0, tgtBestMs = null,
    deviceId,
  } = opts;

  const CHUNK = 500;

  // ── 1. sessions ────────────────────────────────────────────────────────────
  const { error: sessErr } = await supabase.from("sessions").insert({
    id:            sessionId,
    program_id:    programId,
    athlete_id:    athleteId,
    ...(coreTeamId ? { core_team_id: coreTeamId } : {}),
    created_by:    createdBy,
    started_at_ms: startedAtMs,
    ended_at_ms:   endedAtMs,
    grid_rows:     NUM_ROWS,
    grid_cols:     NUM_COLS,
    device_model:  deviceModel,
    sampling_hz:   samplingHz,
    mode,
    raw:           frames.map(f => f.raw),
    ...(deviceId ? { device_id: deviceId } : {}),
  });
  if (sessErr) throw new Error(`sessions: ${sessErr.message}`);
  if (frames.length === 0) return;

  // ── 2. events — enriched ──────────────────────────────────────────────────
  // Pre-compute per-event derived values in one pass
  type EventDerived = {
    iei:       number | null;   // ms since previous event (wall-clock)
    angle:     number | null;   // degrees from grid center
    si:        number;          // strength index 0–1000
    ii:        number;          // impulse index 0–1000
    accuracy:  number | null;   // accuracy score 0–100 (accuracy mode only)
    cellCount: number;          // total cells contacted this event
    peakMv:    number;
  };

  const derived: EventDerived[] = frames.map((f, i) => {
    const iei       = i === 0 ? null : f.epoch_ms - frames[i - 1].epoch_ms;
    // Use v_peak_mv (index 5) — the highest voltage this cell recorded while active.
    // This is always >= the current-frame mv, which may be on the decay slope.
    const peakMv    = f.hits.reduce((m, h) => Math.max(m, h[5]), 0);
    const cellCount = f.hits.length;
    const si        = strengthIndex(iei, peakMv);
    return {
      iei,
      angle:    eventAngleDeg(f.hits),
      si,
      ii:       impulseIndex(si, cellCount),
      accuracy: mode === "accuracy" ? accuracyScore(f.hits) : null,
      cellCount,
      peakMv,
    };
  });

  const eventRows = frames.map((f, i) => {
    const richHits = f.hits;

    // t_start = earliest onset across all cells in this event
    // (cells in the same frame can have different t_first values if they
    //  became active on different prior scans)
    const tStart = richHits.length
      ? Math.min(...richHits.map(h => h[3]))
      : f.t_device_ms;

    // t_end = the current frame timestamp — clamped to be >= tStart to guard
    // against the 1ms clock skew that can make t_device_ms arrive 1ms before
    // a cell's t_first (fixed in firmware but defensive here too).
    const tEnd = Math.max(f.t_device_ms, tStart);

    // duration = full contact window from first cell onset to last active scan.
    // Single-frame events (all cells new, t_start == t_end) get a floor of
    // SCAN_PERIOD_MS — the contact lasted at most one scan cycle.
    const rawDuration = tEnd - tStart;
    const duration    = rawDuration > 0 ? rawDuration : SCAN_PERIOD_MS;

    // Rise time: from the event onset to when the loudest cell peaked.
    // We use v_peak_mv (index 5) to find the dominant cell, then read
    // its t_peak_ms (index 4).
    const peakHit = richHits.reduce(
      (best, h) => h[5] > best[5] ? h : best,
      richHits[0]
    );
    const riseTime  = Math.max(0, peakHit[4] - tStart);   // t_peak − t_start

    // Decay time: lower-bound from peak to last active frame.
    // The true end-of-decay is one frame after the cell vanishes below threshold
    // (~37 ms underestimate at 27 Hz) — close enough for biomechanical analysis.
    const decayTime = Math.max(0, tEnd - peakHit[4]);     // t_end − t_peak

    return {
      event_id:        f.event_id,
      session_id:      sessionId,
      t_start_ms:      tStart,
      t_end_ms:        tEnd,
      duration_ms:     duration,
      rise_time_ms:    riseTime,
      decay_time_ms:   decayTime,
      iei_prev_ms:     derived[i].iei,
      angle_deg:       derived[i].angle,
      strength_index:  { value: derived[i].si },
      impulse_index:   derived[i].ii,
      // accuracy{} — stored in existing jsonb column, used by two modes:
      //   accuracy → { score }                               centroid 0–100
      //   target   → { target_zone, zone_hit, zone_correct } zone attempt record
      //   others   → null
      accuracy: mode === "accuracy" && derived[i].accuracy != null
        ? { score: derived[i].accuracy }
        : mode === "target" && f.target_zone != null
        ? {
            target_zone:  f.target_zone,
            zone_hit: (() => {
              const totalMv = f.hits.reduce((s, [,, mv]) => s + mv, 0);
              if (!totalMv) return null;
              const wRow = f.hits.reduce((s, [r,, mv]) => s + r * mv, 0) / totalMv;
              const wCol = f.hits.reduce((s, [, c, mv]) => s + c * mv, 0) / totalMv;
              return {
                row: wRow >= 9 ? "top" : wRow >= 5 ? "middle" : "bottom",
                col: wCol <= 2 ? "left" : wCol <= 6 ? "center" : "right",
              };
            })(),
            zone_correct: f.zone_correct,
          }
        : null,
      // temporal{} — existing jsonb column, extended for volume mode:
      //   cell_count      → always present
      //   vol_window_idx  → volume only: which 5-second window (0-indexed)
      //   vol_hit_seq     → volume only: ordinal hit number within that window
      temporal: {
        cell_count: derived[i].cellCount,
        ...(mode === "volume" && f.vol_window_idx !== null
          ? { vol_window_idx: f.vol_window_idx, vol_hit_seq: f.vol_hit_seq }
          : {}),
      },
      quality:          null,
      reaction_time_ms: f.reaction_time_ms ?? null,
      raw:              f.raw,
    };
  });

  for (let i = 0; i < eventRows.length; i += CHUNK) {
    const { error } = await supabase.from("events").insert(eventRows.slice(i, i + CHUNK));
    if (error) throw new Error(`events (chunk ${i}): ${error.message}`);
  }

  // ── 3. event_cells ─────────────────────────────────────────────────────────
  const cellRows: object[] = [];
  for (const f of frames) {
    for (const [r, c, mv, tFirst, tPeak, vPeak] of f.hits) {
      cellRows.push({
        event_id:   f.event_id,
        r, c,
        samples:    1,
        v_min:      mv / 1000,         // voltage at this specific frame (may be on decay)
        v_peak:     vPeak / 1000,      // highest voltage this cell recorded while active
        t_first_ms: tFirst,                              // cell onset (ESP32 uptime ms)
        t_peak_ms:  Math.max(tPeak,  tFirst),            // peak  — clamped >= onset
        t_last_ms:  Math.max(f.t_device_ms, tFirst),     // last  — clamped >= onset (guards against 1ms clock skew)
      });
    }
  }
  for (let i = 0; i < cellRows.length; i += CHUNK) {
    const { error } = await supabase.from("event_cells").insert(cellRows.slice(i, i + CHUNK));
    if (error) throw new Error(`event_cells (chunk ${i}): ${error.message}`);
  }

  // ── 4. session_summaries ───────────────────────────────────────────────────
  const durationS = (endedAtMs - startedAtMs) / 1000;
  const cadenceHz = durationS > 0 ? frames.length / durationS : 0;

  // IEI — wall-clock gaps between consecutive events
  const ieiVals = derived.slice(1).map(d => d.iei as number);  // first is null

  // Angles across all events
  const angleVals = derived.map(d => d.angle).filter((a): a is number => a !== null);

  // Strength index across all events
  const siVals = derived.map(d => d.si);

  // Per-event timing distributions — collected from eventRows which already have
  // rise/decay/duration computed. Used to populate session_summaries aggregate columns.
  const durationVals = eventRows.map(e => e.duration_ms).filter(v => v > 0);
  const riseVals     = eventRows.map(e => e.rise_time_ms).filter((v): v is number => v !== null && v > 0);
  const decayVals    = eventRows.map(e => e.decay_time_ms).filter((v): v is number => v !== null && v > 0);

  // Heatmap: cumulative v_peak per cell (h[5]) — uses true peak voltage, not a
  // potentially decaying current-frame reading.
  const heatmap: Record<string, number> = {};
  for (const f of frames) {
    for (const h of f.hits) {
      const k = `${h[0]},${h[1]}`;
      heatmap[k] = (heatmap[k] ?? 0) + h[5];  // h[5] = v_peak_mv
    }
  }

  // Most-contacted cell (by cumulative mv)
  let topCell: string | null = null;
  let topVal  = -Infinity;
  for (const [k, v] of Object.entries(heatmap)) {
    if (v > topVal) { topVal = v; topCell = k; }
  }
  const [topR, topC] = topCell ? topCell.split(",").map(Number) : [null, null];

  // Center of mass — v_peak-weighted centroid across all cell hits
  // Uses h[5] (v_peak_mv) so weighting is consistent with heatmap and strength scoring.
  const allHits = frames.flatMap(f => f.hits);
  let comR = 0, comC = 0, comW = 0;
  for (const h of allHits) { comR += h[0] * h[5]; comC += h[1] * h[5]; comW += h[5]; }
  const centerOfMass = comW > 0
    ? { r: +(comR / comW).toFixed(2), c: +(comC / comW).toFixed(2) }
    : null;

  // Peak mv across all cells — use v_peak_mv (h[5]) so stats reflect true peak force,
  // not a current-frame reading that may be on the decay slope.
  const allMv  = allHits.map(h => h[5]);
  const peakMv = allMv.length ? Math.max(...allMv) : 0;
  const avgMv  = allMv.length ? allMv.reduce((a, b) => a + b, 0) / allMv.length : 0;

  // Accuracy stats (computed from live refs passed in)
  const accuracyQuality = mode === "accuracy" && accHitsCount > 0
    ? {
        accuracy_pct:    +(accScoreSum / accHitsCount).toFixed(1),
        avg_offset_cells: +(accHitsCount > 0
          ? ((100 - accScoreSum / accHitsCount) / 100) * Math.min(NUM_ROWS, NUM_COLS) / 2
          : 0
        ).toFixed(2),
      }
    : null;

  // Reaction stats (from live refs passed in + per-event values on frames)
  const rxVals = frames
    .map(f => f.reaction_time_ms)
    .filter((v): v is number => v !== null);
  const reactionQuality = mode === "reaction"
    ? {
        best_reaction_ms:  rxBestMs,
        avg_reaction_ms:   rxAvgMs,
        attempts:          rxAttempts,
        reaction_time_ms:  rxVals.length ? statSummary(rxVals) : null,
      }
    : null;

  // Target stats — reaction time split by correct vs all attempts
  const tgtRxAll     = frames.filter(f => f.reaction_time_ms !== null && f.target_zone !== null)
                             .map(f => f.reaction_time_ms as number);
  const tgtRxCorrect = frames.filter(f => f.reaction_time_ms !== null && f.zone_correct === true)
                             .map(f => f.reaction_time_ms as number);
  const targetQuality = mode === "target"
    ? {
        attempts:              tgtAttempts,
        correct_hits:          tgtCorrectHits,
        target_accuracy_pct:   tgtAttempts > 0
                                 ? +(tgtCorrectHits / tgtAttempts * 100).toFixed(1)
                                 : null,
        best_reaction_ms:      tgtBestMs,
        // Correct-only avg is more meaningful — penalises missing the zone, not hesitating
        avg_reaction_ms_correct: tgtCorrectHits > 0
                                   ? +(tgtCorrectSumMs / tgtCorrectHits).toFixed(0)
                                   : null,
        reaction_time_ms_all:     tgtRxAll.length     ? statSummary(tgtRxAll)     : null,
        reaction_time_ms_correct: tgtRxCorrect.length ? statSummary(tgtRxCorrect) : null,
      }
    : null;

  // Volume stats — per-window breakdown with SI slope for fatigue detection
  const volumeQuality = (() => {
    if (mode !== "volume") return null;
    // Group frames by window index (only frames that were inside an open window)
    const windowMap = new Map<number, BleFrame[]>();
    for (const f of frames) {
      if (f.vol_window_idx === null) continue;
      const bucket = windowMap.get(f.vol_window_idx) ?? [];
      bucket.push(f);
      windowMap.set(f.vol_window_idx, bucket);
    }
    if (!windowMap.size) return null;

    const windows = Array.from(windowMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, wFrames]) => {
        // Sort by sequence so slope is meaningful
        const sorted = [...wFrames].sort((a, b) => (a.vol_hit_seq ?? 0) - (b.vol_hit_seq ?? 0));
        const siPerHit = sorted.map(f => {
          const peakMv = f.hits.reduce((m, h) => Math.max(m, h[5]), 0);
          return strengthIndex(null, peakMv);   // IEI-free SI — pure force component
        });
        // IEI between consecutive hits in this window (epoch_ms diff)
        const ieiWithin = sorted.slice(1).map((f, i) => f.epoch_ms - sorted[i].epoch_ms);
        // Linear SI slope: (last SI − first SI) / hit count → negative = fatigue
        const siSlope = siPerHit.length >= 2
          ? +((siPerHit[siPerHit.length - 1] - siPerHit[0]) / (siPerHit.length - 1)).toFixed(1)
          : null;
        return {
          window_idx:   idx,
          hits:         sorted.length,
          avg_si:       siPerHit.length ? +(siPerHit.reduce((a, b) => a + b, 0) / siPerHit.length).toFixed(1) : null,
          si_values:    siPerHit,
          si_slope:     siSlope,
          avg_iei_ms:   ieiWithin.length ? +(ieiWithin.reduce((a, b) => a + b, 0) / ieiWithin.length).toFixed(0) : null,
          iei_ms_values: ieiWithin,
        };
      });

    // Global SI fatigue slope across all windows — avg_si of first window vs last
    const windowAvgSis = windows.map(w => w.avg_si).filter((v): v is number => v !== null);
    const globalSiSlope = windowAvgSis.length >= 2
      ? +((windowAvgSis[windowAvgSis.length - 1] - windowAvgSis[0]) / (windowAvgSis.length - 1)).toFixed(1)
      : null;

    return {
      windows,
      best_window_hits:  Math.max(...windows.map(w => w.hits)),
      avg_window_hits:   +(windows.reduce((s, w) => s + w.hits, 0) / windows.length).toFixed(1),
      si_fatigue_slope:  globalSiSlope,   // negative = SI decreasing across windows (fatigue)
      total_windows:     windows.length,
    };
  })();

  const { error: sumErr } = await supabase.from("session_summaries").insert({
    session_id:          sessionId,
    program_id:          programId,
    ...(coreTeamId ? { core_team_id: coreTeamId } : {}),
    athlete_id:          athleteId,
    mode,
    num_events:          frames.length,
    session_duration_ms: endedAtMs - startedAtMs,
    cadence_hz_avg:      +cadenceHz.toFixed(3),
    cadence_hz_median:   +cadenceHz.toFixed(3),
    longest_pause_ms:    ieiVals.length ? Math.max(...ieiVals) : 0,

    // IEI — full stats object (mean replaces old avg key)
    iei_ms: ieiVals.length
      ? { ...statSummary(ieiVals), values: ieiVals }
      : null,

    // Angle stats across all events
    angles_deg: angleVals.length ? statSummary(angleVals) : null,

    // Voltage-only force proxy (force in N requires calibration, deferred)
    peak_force_stats: {
      peak_mv: peakMv,
      avg_mv:  +avgMv.toFixed(2),
      peak_v:  +(peakMv / 1000).toFixed(3),
      avg_v:   +(avgMv  / 1000).toFixed(3),
      note:    "N conversion requires sensor calibration",
    },

    // quality — all keys flat so dashboard reads them directly:
    //   strength_index  → always present
    //   accuracy_pct, avg_offset_cells  → accuracy mode only
    //   best_reaction_ms, avg_reaction_ms, attempts  → reaction mode only
    //   target_accuracy_pct, avg_reaction_ms_correct, etc → target mode only
    //   windows[], si_fatigue_slope, etc → volume mode only
    quality: {
      strength_index: statSummary(siVals),
      ...(accuracyQuality  ?? {}),
      ...(reactionQuality  ?? {}),
      ...(targetQuality    ?? {}),
      ...(volumeQuality    ?? {}),
    },

    heatmap,
    most_contacted_cell_rc: topR !== null ? { r: topR, c: topC } : null,
    center_of_mass_mm:       centerOfMass,   // in grid units until mm/cell calibrated
    date_of_record:          new Date().toISOString(),

    // Timing distributions across all events
    duration_ms_stats: durationVals.length ? statSummary(durationVals) : null,
    impulse_stats: {
      rise_time_ms:  riseVals.length  ? statSummary(riseVals)  : null,
      decay_time_ms: decayVals.length ? statSummary(decayVals) : null,
    },
  });
  if (sumErr) throw new Error(`session_summaries: ${sumErr.message}`);
}

// ─── ImpactRipple (identical to hitSimulator) ────────────────────────────────
function ImpactRipple({
  x, y, color, id, onDone,
}: { x: number | string; y: number | string; color: string; id: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: "absolute",
      left: typeof x === "number" ? `${x}%` : x,
      top:  typeof y === "number" ? `${y}%` : y,
      transform: "translate(-50%,-50%)",
      pointerEvents: "none", zIndex: 10,
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: color,
        boxShadow: `0 0 16px 6px ${color}`,
        animation: "tsCorePulse 0.9s ease-out forwards",
      }} />
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        width: 12, height: 12, borderRadius: "50%",
        border: `2px solid ${color}`,
        animation: "tsRipple 0.9s ease-out forwards",
      }} />
    </div>
  );
}

// ─── BlePickerSheet ───────────────────────────────────────────────────────────
// In-app BLE device picker for native builds.
// Replaces the OS requestDevice() picker so ALL nearby BLE devices are shown
// regardless of OS name-cache state, and the user can see RSSI signal strength.
function BlePickerSheet({
  devices,
  scanning,
  onSelect,
  onCancel,
  serviceUuid,
}: {
  devices: ScannedDevice[];
  scanning: boolean;
  onSelect: (d: ScannedDevice) => void;
  onCancel: () => void;
  serviceUuid: string;
}) {
  // Prefix-aware helpers — use env vars so they stay in sync with .env
  const { primary: _pfxPrimary, legacy: _pfxLegacy } = getBleNamePrefixes();

  /** New / first-time device — advertises with VITE_BLE_NAME_PREFIX (default "TS") */
  function isTsDevice(d: ScannedDevice) {
    return d.name.startsWith(_pfxPrimary) && d.name !== d.deviceId;
  }
  /** Returning / previously paired — advertises with VITE_BLE_NAME_PREFIX_LEGACY (default "MPY") */
  function isMpyDevice(d: ScannedDevice) {
    return d.name.startsWith(_pfxLegacy) && d.name !== d.deviceId;
  }
  /** Either known bag prefix */
  function isKnownBag(d: ScannedDevice) {
    return isTsDevice(d) || isMpyDevice(d);
  }

  function rssiLabel(rssi: number | null) {
    if (rssi === null) return { bars: 1, color: "rgba(255,255,255,0.25)", label: "—" };
    if (rssi >= -55) return { bars: 4, color: "#00ff88", label: "Excellent" };
    if (rssi >= -67) return { bars: 3, color: "#00dcff", label: "Good" };
    if (rssi >= -80) return { bars: 2, color: "#ffcc00", label: "Fair" };
    return { bars: 1, color: "#ff6060", label: "Weak" };
  }

  // Sort: known bags first (MPY returning before TS new), then by RSSI descending
  const sorted = [...devices].sort((a, b) => {
    // Priority: MPY (returning) = 0, TS (new) = 1, other = 2
    const rank = (d: ScannedDevice) => isMpyDevice(d) ? 0 : isTsDevice(d) ? 1 : 2;
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return (b.rssi ?? -999) - (a.rssi ?? -999);
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      background: "rgba(0,0,0,0.60)", backdropFilter: "blur(6px)",
    }} onClick={onCancel}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--panel)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: "20px 20px 0 0",
          padding: "0 0 32px",
          maxHeight: "72vh", display: "flex", flexDirection: "column",
          animation: "tsSheetUp 0.22s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Nearby Devices</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {scanning
                ? "Scanning for Trench bags…"
                : `${devices.length} device${devices.length !== 1 ? "s" : ""} found`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {scanning && (
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "#ffcc00",
                boxShadow: "0 0 6px 3px rgba(255,200,0,0.45)",
                animation: "tsBlink 1s ease-in-out infinite",
                flexShrink: 0,
              }} />
            )}
            <button
              onClick={onCancel}
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "var(--text)", borderRadius: 8,
                padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Device list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "10px 12px 0" }}>
          {sorted.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "32px 0", gap: 10,
            }}>
              <div style={{ fontSize: 28, opacity: 0.25 }}>📡</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                {scanning ? "Looking for Trench bags…" : "No devices found. Make sure the bag is powered on and nearby."}
              </div>
            </div>
          ) : sorted.map(d => {
            const sig    = rssiLabel(d.rssi);
            const isTs   = isTsDevice(d);
            const isMpy  = isMpyDevice(d);
            const isBag  = isTs || isMpy;
            // MPY (returning) gets a green tint; TS (new) keeps the purple tint
            const bagBorder  = isMpy ? "1px solid rgba(0,255,136,0.35)"  : isBag ? "1px solid rgba(180,0,255,0.35)"  : "1px solid rgba(255,255,255,0.07)";
            const bagBg      = isMpy ? "rgba(0,255,136,0.06)"            : isBag ? "rgba(180,0,255,0.08)"            : "rgba(255,255,255,0.02)";
            const iconBg     = isMpy ? "linear-gradient(135deg, rgba(0,255,136,0.28), rgba(0,255,136,0.10))" : isBag ? "linear-gradient(135deg, rgba(180,0,255,0.30), rgba(180,0,255,0.12))" : "rgba(255,255,255,0.05)";
            const iconBorder = isMpy ? "1px solid rgba(0,255,136,0.38)"  : isBag ? "1px solid rgba(180,0,255,0.40)"  : "1px solid rgba(255,255,255,0.08)";
            const nameColor  = isMpy ? "rgba(100,255,180,1)"             : isBag ? "rgba(220,150,255,1)"             : "var(--text)";
            return (
              <button
                key={d.deviceId}
                onClick={() => onSelect(d)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%", padding: "11px 12px", marginBottom: 6,
                  borderRadius: 12, cursor: "pointer", textAlign: "left",
                  border: bagBorder, background: bagBg,
                  transition: "background 120ms",
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 17, background: iconBg, border: iconBorder,
                }}>
                  {isBag ? "🥊" : "📶"}
                </div>

                {/* Name + ID */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: nameColor,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {d.name}
                    {/* PAIRED badge — MPY returning device */}
                    {isMpy && (
                      <span style={{
                        marginLeft: 6, fontSize: 9, fontWeight: 800,
                        color: "#00ff88", letterSpacing: "0.08em",
                        background: "rgba(0,255,136,0.12)",
                        border: "1px solid rgba(0,255,136,0.30)",
                        borderRadius: 4, padding: "1px 5px",
                        verticalAlign: "middle",
                      }}>PAIRED</span>
                    )}
                    {/* NEW badge — TS first-time device */}
                    {isTs && (
                      <span style={{
                        marginLeft: 6, fontSize: 9, fontWeight: 800,
                        color: "#b400ff", letterSpacing: "0.08em",
                        background: "rgba(180,0,255,0.15)",
                        border: "1px solid rgba(180,0,255,0.30)",
                        borderRadius: 4, padding: "1px 5px",
                        verticalAlign: "middle",
                      }}>NEW</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontFamily: "monospace" }}>
                    {d.deviceId}
                  </div>
                </div>

                {/* RSSI bars */}
                <div style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "flex-end", gap: 2, flexShrink: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14 }}>
                    {[1, 2, 3, 4].map(b => (
                      <div key={b} style={{
                        width: 4, borderRadius: 1,
                        height: `${b * 25}%`,
                        background: b <= sig.bars ? sig.color : "rgba(255,255,255,0.12)",
                        transition: "background 300ms",
                      }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: sig.color, fontWeight: 600 }}>
                    {d.rssi !== null ? `${d.rssi} dBm` : "—"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function Session() {
  const navigate = useNavigate();
  const { unlock: unlockAudio, playSignal, playZoneCue, closeAudio } = useSignalAudio();

  // ── Auth / profile ──────────────────────────────────────────────────────────
  const [userId,    setUserId]    = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: userData } = await supabase!.auth.getUser();
      const user = userData?.user;
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase!
        .from("profiles")
        .select("program_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setProgramId(data.program_id ?? null);
    })();
  }, []);

  // ── Athletes ─────────────────────────────────────────────────────────────────
  const [athletes,        setAthletes]        = useState<Athlete[]>([]);
  const [athleteFilter,   setAthleteFilter]   = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [athletesLoading, setAthletesLoading] = useState(false);

  useEffect(() => {
    if (!programId || !supabase) return;
    setAthletesLoading(true);
    (async () => {
      const { data } = await supabase!
        .from("athletes")
        .select("id, first_name, last_name, position, sport, core_team_id")
        .eq("program_id", programId)
        .order("last_name");
      setAthletes((data as Athlete[]) ?? []);
      setAthletesLoading(false);
    })();
  }, [programId]);

  const filteredAthletes = athletes.filter(a => {
    const q = athleteFilter.toLowerCase();
    return (
      a.first_name.toLowerCase().includes(q) ||
      a.last_name.toLowerCase().includes(q)  ||
      (a.position ?? "").toLowerCase().includes(q)
    );
  });

  // ── BLE ──────────────────────────────────────────────────────────────────────
  const [bleStatus,    setBleStatus]    = useState<BleStatus>("idle");
  const [bleSupported, setBleSupported] = useState(true);
  const [deviceInfo,   setDeviceInfo]   = useState<DeviceInfo>(null);

  // ── OTA ───────────────────────────────────────────────────────────────────────
  type OtaState = "idle" | "available" | "updating" | "done" | "error";
  const [otaState,    setOtaState]    = useState<OtaState>("idle");
  const [otaProgress, setOtaProgress] = useState(0);        // 0–100
  const [otaError,    setOtaError]    = useState<string | null>(null);
  const [latestFw,    setLatestFw]    = useState<string | null>(null);

  const connRef      = useRef<AdapterConnection | null>(null);  // active adapter connection
  const assemblerRef = useRef(new ChunkAssembler());

  useEffect(() => {
    if (!isNativeApp()) {
      const diag = getBluetoothDiagnostics();
      if (!diag.hasRequestDevice) {
        setBleSupported(false);
        setBleStatus("unsupported");
      }
    }
  }, []);

  // ── Firmware version check — fires each time a device connects ───────────────
  // Fetches /firmware/manifest.json and compares against the hello packet version.
  // Silent on network failure — OTA is optional, never blocks the session flow.
  useEffect(() => {
    if (!deviceInfo) {
      setOtaState("idle");
      setOtaProgress(0);
      setOtaError(null);
      return;
    }
    fetch("/firmware/manifest.json")
      .then(r => r.json())
      .then((m: { version: string }) => {
        setLatestFw(m.version);
        if (fwIsOutdated(deviceInfo.fw, m.version)) {
          setOtaState("available");
        } else {
          setOtaState("idle");
        }
      })
      .catch(err => {
        console.warn("[OTA] manifest fetch failed:", err);
      });
  }, [deviceInfo]);

  // ── Session state ────────────────────────────────────────────────────────────
  const [sessionMode,   setSessionMode]   = useState<SessionMode>("power");
  const [sessionActive, setSessionActive] = useState(false);
  const [saveState,     setSaveState]     = useState<SaveState>("idle");
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [elapsedMs,     setElapsedMs]     = useState(0);
  const startTimeRef  = useRef<number | null>(null);
  const sessionIdRef  = useRef("");

  // ── Reaction mode state ───────────────────────────────────────────────────────
  const [rxPhase,   setRxPhase]   = useState<"idle"|"waiting"|"signal"|"result"|"early">("idle");
  const [rxTime,    setRxTime]    = useState<number | null>(null);
  const [rxBestMs,  setRxBestMs]  = useState<number | null>(null);
  const [rxAttempts, setRxAttempts] = useState(0);
  const [rxAvgMs,   setRxAvgMs]   = useState<number | null>(null);
  const rxSignalAt  = useRef<number | null>(null);
  const rxTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rxSumMs     = useRef(0);

    // ── Volume mode state ───────────────────────────────────────────────────────
  const [volPhase, setVolPhase] = useState<"idle"|"waiting"|"signal"|"result"|"early">("idle");
  const [volHits, setVolHits] = useState(0);
  const [volBest, setVolBest] = useState<number | null>(null);
  const [volAttempts, setVolAttempts] = useState(0);
  const [volAvg, setVolAvg] = useState<number | null>(null);
  const [volRemainingMs, setVolRemainingMs] = useState(0);

  const volSignalAt = useRef<number | null>(null);
  const volWindowEndsAt = useRef<number | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volTickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const volSumRef = useRef(0);
  const volAttemptsRef = useRef(0);
  const volHitsRef = useRef(0);
  const volWindowIdxRef = useRef(0);          // increments each time a new window opens
  const volWindowHitSeqRef = useRef(0);       // resets to 0 at the start of each window

  // ── Accuracy mode state ───────────────────────────────────────────────────────
  const [avgAccuracy, setAvgAccuracy] = useState<number | null>(null);
  const accHitsRef = useRef(0);
  const accSumRef  = useRef(0);

  // ── Target mode state ─────────────────────────────────────────────────────────
  // Phase mirrors reaction mode: idle → waiting → signal → result | early
  const [tgtPhase,    setTgtPhase]    = useState<"idle"|"waiting"|"signal"|"result"|"early">("idle");
  const [tgtZone,     setTgtZone]     = useState<ZoneTarget | null>(null);   // current target zone
  const [tgtZoneHit,  setTgtZoneHit]  = useState<ZoneTarget | null>(null);   // zone the user actually hit
  const [tgtCorrect,  setTgtCorrect]  = useState<boolean | null>(null);      // was the hit in the right zone?
  const [tgtReactMs,  setTgtReactMs]  = useState<number | null>(null);       // reaction time ms
  const [tgtAttempts, setTgtAttempts] = useState(0);                         // total attempts
  const [tgtHits,     setTgtHits]     = useState(0);                         // correct zone hits
  const [tgtBestMs,   setTgtBestMs]   = useState<number | null>(null);
  const [tgtAvgMs,    setTgtAvgMs]    = useState<number | null>(null);
  const tgtPhaseRef    = useRef<string>("idle");
  const tgtZoneRef     = useRef<ZoneTarget | null>(null);
  const tgtSignalAt    = useRef<number | null>(null);
  const tgtTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tgtSumMs       = useRef(0);
  const tgtCorrectSumMs = useRef(0);    // reaction time sum for correct-zone hits only
  const tgtAttemptsRef = useRef(0);

  // ── Grid / data ──────────────────────────────────────────────────────────────
  const [grid,    setGrid]    = useState<GridState>(new Map());
  const [now,     setNow]     = useState(Date.now());
  const [peakMv,  setPeakMv]  = useState(0);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number | string; y: number | string; color: string }>>([]);
  const rippleIdRef = useRef(0);

  type FeedItem = { row: number; col: number; mv: number; key: string };
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedCounter = useRef(0);

  // Raw frames accumulated during session — written to Supabase on save
  const framesRef  = useRef<BleFrame[]>([]);
  const frameIndex = useRef(0);

  // captureRef tracks sessionActive without closure staleness
  const captureRef = useRef(false);

      // Stable refs so handleNotify (memoised with []) can read current values
  const sessionModeRef  = useRef<SessionMode>("power");
  const rxPhaseRef      = useRef<string>("idle");
  const rxAttemptsRef   = useRef(0);
  const volPhaseRef     = useRef<string>("idle");
  // Carries the per-event reaction time from the signal block into the frame push
  const pendingRxMsRef  = useRef<number | null>(null);
  // Carries target zone data from the signal block into the frame push
  const pendingTgtZoneRef    = useRef<ZoneTarget | null>(null);
  const pendingTgtCorrectRef = useRef<boolean | null>(null);
  // Carries volume window/seq from the volume block into the frame push
  const pendingVolWindowIdxRef = useRef<number | null>(null);
  const pendingVolHitSeqRef    = useRef<number | null>(null);

  // Keep refs in sync with state
  useEffect(() => { sessionModeRef.current = sessionMode; }, [sessionMode]);
  useEffect(() => { rxPhaseRef.current = rxPhase; }, [rxPhase]);
  useEffect(() => { rxAttemptsRef.current = rxAttempts; }, [rxAttempts]);
  useEffect(() => { volPhaseRef.current = volPhase; }, [volPhase]);
  useEffect(() => { volAttemptsRef.current = volAttempts; }, [volAttempts]);
  useEffect(() => { tgtPhaseRef.current = tgtPhase; }, [tgtPhase]);
  useEffect(() => { tgtAttemptsRef.current = tgtAttempts; }, [tgtAttempts]);

  // ── Target mode sequence ──────────────────────────────────────────────────────
  const scheduleNextTarget = useCallback(() => {
    if (!captureRef.current) return;
    const delay = 1500 + Math.random() * 2500;
    setTgtPhase("waiting");
    tgtPhaseRef.current = "waiting";
    tgtZoneRef.current  = null;

    tgtTimer.current = setTimeout(() => {
      if (!captureRef.current) return;
      const zone = randomZone();
      tgtZoneRef.current  = zone;
      tgtSignalAt.current = performance.now();
      setTgtZone(zone);
      setTgtPhase("signal");
      tgtPhaseRef.current = "signal";
      // Fire the alert tone then speak the zone label
      playZoneCue(zone);
    }, delay);
  }, []);

  // ── Reaction mode sequence ────────────────────────────────────────────────────
  const scheduleNextReaction = useCallback(() => {
    if (!captureRef.current) return;
    const delay = 1500 + Math.random() * 2500;
    setRxPhase("waiting");
    rxPhaseRef.current = "waiting";
    rxTimer.current = setTimeout(() => {
      if (!captureRef.current) return;
      setRxPhase("signal");
      rxPhaseRef.current = "signal";
      rxSignalAt.current = performance.now();
      playSignal("reaction");
    }, delay);
  }, []);

    const finishVolumeWindow = useCallback((finalHits: number) => {
    setVolPhase("result");
    volPhaseRef.current = "result";
    setVolHits(finalHits);
    setVolAttempts(a => a + 1);
    volSumRef.current += finalHits;
    setVolBest(prev => prev === null ? finalHits : Math.max(prev, finalHits));
    setVolAvg(Math.round((volSumRef.current) / (volAttemptsRef.current + 1)));
    setVolRemainingMs(0);

    if (volTickTimer.current) {
      clearInterval(volTickTimer.current);
      volTickTimer.current = null;
    }

    // In volume mode, auto-end the session after showing result
    const endTimer = setTimeout(() => {
      if (captureRef.current) {
        setSessionActive(false);
        captureRef.current = false;
      }
    }, 2200);
    
    return () => clearTimeout(endTimer);
  }, []);

    const scheduleNextVolume = useCallback(() => {
    if (!captureRef.current) return;
    
    // Clear any existing timers
    if (volTimer.current) clearTimeout(volTimer.current);
    if (volTickTimer.current) clearInterval(volTickTimer.current);

    const delay = 1500 + Math.random() * 2500;
    setVolPhase("waiting");
    volPhaseRef.current = "waiting";
    setVolHits(0);
    volHitsRef.current = 0;
    setVolRemainingMs(0);

    volTimer.current = setTimeout(() => {
      if (!captureRef.current) return;

      const signalStartTime = performance.now();
      const windowEndTime = signalStartTime + VOLUME_WINDOW_MS;

      setVolPhase("signal");
      volPhaseRef.current = "signal";
      setVolHits(0);
      volHitsRef.current = 0;
      setVolRemainingMs(0);
      volSignalAt.current = signalStartTime;
      volWindowEndsAt.current = windowEndTime;
      volWindowIdxRef.current += 1;
      volWindowHitSeqRef.current = 0;

      // Play the signal tone
      playSignal("volume");

      // Start countdown timer - updates every 50ms
      if (volTickTimer.current) clearInterval(volTickTimer.current);
      volTickTimer.current = setInterval(() => {
        const now = performance.now();
        const elapsed = Math.max(0, now - signalStartTime);
        const remaining = Math.max(0, VOLUME_WINDOW_MS - elapsed);
        
        setVolRemainingMs(remaining);
        
        // When window closes, end it
        if (elapsed >= VOLUME_WINDOW_MS) {
          if (volTickTimer.current) {
            clearInterval(volTickTimer.current);
            volTickTimer.current = null;
          }
          finishVolumeWindow(volHitsRef.current);
        }
      }, 50);

    }, delay);
  }, [finishVolumeWindow]);

  // Fade tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60);
    return () => clearInterval(id);
  }, []);

  // Timer
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - (startTimeRef.current ?? Date.now()));
    }, 250);
    return () => clearInterval(id);
  }, [sessionActive]);

  // Session cleanup when deactivated
  useEffect(() => {
    if (sessionActive) return;
    // Clean up all mode timers on session end
    if (rxTimer.current) clearTimeout(rxTimer.current);
    if (tgtTimer.current) clearTimeout(tgtTimer.current);
    if (volTimer.current) clearTimeout(volTimer.current);
    if (volTickTimer.current) clearInterval(volTickTimer.current);
  }, [sessionActive]);

  // ── BLE notify handler ────────────────────────────────────────────────────────
  // Accepts a DataView directly — same signature used by both adapter paths.
  const handleNotify = useCallback((value: DataView) => {
    const text = new TextDecoder().decode(value).trim();

    assemblerRef.current.maybeTimeout();
    const maybeJson = assemblerRef.current.push(text);
    if (!maybeJson) return;

    let obj: any;
    try { obj = JSON.parse(maybeJson); } catch { return; }

    // ── Non-data control frames — handled before the hits path ────────────────
    if (obj.type === "hello") {
      const info: DeviceInfo = { id: obj.id, fw: obj.fw, rows: obj.rows, cols: obj.cols };
      setDeviceInfo(info);
      // Upsert to Supabase devices table so last_seen_at and fw_version stay current
      if (supabase) {
        supabase.from("devices").upsert({
          id:           obj.id,
          fw_version:   obj.fw,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "id" }).then(({ error }) => {
          if (error) console.warn("[devices] upsert failed:", error.message);
        });
      }
      return;
    }
    if (obj.type === "ota_ok") {
      setOtaState("done");
      setOtaProgress(100);
      console.log(`[OTA] applied — new fw ${obj.fw}`);
      return;
    }
    if (obj.type === "ota_err") {
      setOtaError(obj.msg ?? "Unknown error");
      setOtaState("error");
      console.warn(`[OTA] failed — ${obj.msg}`);
      return;
    }

    // ESP32 now sends 7-element hit arrays: [r, c, mv, t_first_ms, t_peak_ms, v_peak_mv, is_new]
    const hits: RichHit[] = obj.hits ?? [];
    if (!hits.length) return;

    const epochMs = Date.now();
    const frameT: number = obj.t ?? 0;

    // ── Reaction mode: first incoming hit resolves the current phase ──────────
    if (captureRef.current && sessionModeRef.current === "reaction") {
      const phase = rxPhaseRef.current;
      if (phase === "waiting") {
        // Hit before signal — too early penalty
        if (rxTimer.current) clearTimeout(rxTimer.current);
        setRxPhase("early");
        rxPhaseRef.current = "early";
        playSignal("early");
        setTimeout(() => scheduleNextReaction(), 1800);
        return;
      }
      if (phase === "signal" && rxSignalAt.current !== null) {
        const rt = Math.round(performance.now() - rxSignalAt.current);
        pendingRxMsRef.current = rt;            // carry into frame push below
        setRxTime(rt);
        setRxPhase("result");
        rxPhaseRef.current = "result";
        setRxAttempts(a => a + 1);
        rxSumMs.current += rt;
        setRxBestMs(prev => prev === null ? rt : Math.min(prev, rt));
        setRxAvgMs(Math.round((rxSumMs.current + rt) / (rxAttemptsRef.current + 1)));
        setTimeout(() => scheduleNextReaction(), 2200);
        // Fall through to still display the hit on the grid
      }
    }

    // ── Volume mode: wait for signal, then count all hits for 5 seconds ──────
    if (captureRef.current && sessionModeRef.current === "volume") {
      const phase = volPhaseRef.current;

      if (phase === "waiting") {
        if (volTimer.current) clearTimeout(volTimer.current);
        setVolPhase("early");
        volPhaseRef.current = "early";
        setTimeout(() => scheduleNextVolume(), 1800);
        return;
      }

      if (phase === "signal" && volWindowEndsAt.current !== null) {
        const stillOpen = performance.now() <= volWindowEndsAt.current;
        if (stillOpen) {
          const hitCount = hits.length;
          volHitsRef.current += hitCount;
          setVolHits(volHitsRef.current);
          // Stamp window index and hit sequence BEFORE the frame push below
          pendingVolWindowIdxRef.current  = volWindowIdxRef.current;
          pendingVolHitSeqRef.current     = volWindowHitSeqRef.current + 1;
          volWindowHitSeqRef.current     += hitCount;
        }
      }
    }

    // ── Target mode: check zone on first hit after signal ─────────────────────
    if (captureRef.current && sessionModeRef.current === "target") {
      const phase = tgtPhaseRef.current;
      if (phase === "waiting") {
        if (tgtTimer.current) clearTimeout(tgtTimer.current);
        setTgtPhase("early");
        tgtPhaseRef.current = "early";
        playSignal("early");
        setTimeout(() => scheduleNextTarget(), 1800);
        return;
      }
      if (phase === "signal" && tgtSignalAt.current !== null && tgtZoneRef.current !== null) {
        const rt       = Math.round(performance.now() - tgtSignalAt.current);
        const totalMv  = hits.reduce((s, [,, mv]) => s + mv, 0);
        const wRow     = hits.reduce((s, [r,, mv]) => s + r * mv, 0) / totalMv;
        const wCol     = hits.reduce((s, [, c, mv]) => s + c * mv, 0) / totalMv;
        const struck   = hitZone(Math.round(wRow), Math.round(wCol));
        const isCorrect = zonesMatch(struck, tgtZoneRef.current);
        pendingRxMsRef.current = rt;
        // Stamp zone data so the frame carries the full attempt record
        pendingTgtZoneRef.current      = tgtZoneRef.current;
        pendingTgtCorrectRef.current   = isCorrect;
        setTgtReactMs(rt);
        setTgtZoneHit(struck);
        setTgtCorrect(isCorrect);
        setTgtPhase("result");
        tgtPhaseRef.current = "result";
        setTgtAttempts(a => a + 1);
        tgtSumMs.current += rt;
        if (isCorrect) {
          setTgtHits(h => h + 1);
          tgtCorrectSumMs.current += rt;
        }
        setTgtBestMs(prev => prev === null ? rt : Math.min(prev, rt));
        setTgtAvgMs(Math.round((tgtSumMs.current + rt) / (tgtAttemptsRef.current + 1)));
        setTimeout(() => scheduleNextTarget(), 2400);
        // Fall through to display hit on grid
      }
    }

    // ── Accuracy scoring ──────────────────────────────────────────────────────
    const ACC_CX = (NUM_COLS + 1) / 2;  // 4.5
    const ACC_CY = (NUM_ROWS + 1) / 2;  // 6.5

    if (captureRef.current && sessionModeRef.current === "accuracy") {
      for (const [r, c] of hits) {
        const dx = (c - ACC_CX) / (NUM_COLS / 2);
        const dy = (r - ACC_CY) / (NUM_ROWS / 2);
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 1);
        const score = Math.round((1 - dist) * 100);
        accHitsRef.current += 1;
        accSumRef.current  += score;
        setAvgAccuracy(Math.round(accSumRef.current / accHitsRef.current));
      }
    }

    // Accumulate frame for Supabase
    if (captureRef.current) {
      const idx = frameIndex.current++;
      framesRef.current.push({
        event_id:         `${sessionIdRef.current}_e${String(idx).padStart(5, "0")}`,
        t_device_ms:      frameT,
        epoch_ms:         epochMs,
        hits,
        raw:              obj,
        reaction_time_ms: pendingRxMsRef.current,
        // Target mode — stamped in the target block above when phase === "signal"
        target_zone:      pendingTgtZoneRef.current,
        zone_correct:     pendingTgtCorrectRef.current,
        // Volume mode — stamped in the volume block above when window is open
        vol_window_idx:   pendingVolWindowIdxRef.current,
        vol_hit_seq:      pendingVolHitSeqRef.current,
      });
      // Consume all pending stamps — reset for next frame
      pendingRxMsRef.current         = null;
      pendingTgtZoneRef.current      = null;
      pendingTgtCorrectRef.current   = null;
      pendingVolWindowIdxRef.current = null;
      pendingVolHitSeqRef.current    = null;
    }

    // Update grid (display)
    setGrid(prev => {
      const next = new Map(prev);
      for (const [r, c, mv] of hits) next.set(cellKey(r, c), { mv, ts: epochMs });
      return next;
    });

    // Spawn ripples — match the mirrored grid: data C8 at visual-left, data C1 at visual-right.
    // (ESP32 numbers columns from the opposite side; display is flipped to show C1 on viewer's left.)
    // Rows: R12 top, R1 bottom. Padding: 28px top, 6px bottom/sides.
    const gridPadTop    = 28;
    const gridPadBottom = 6;
    const gridPadSide   = 6;
    const newRipples = hits.map(([r, c, mv]) => {
      const ri   = NUM_ROWS - r;                   // visual row: 0=top(R12), 11=bottom(R1)
      const ci   = NUM_COLS - c;                   // visual col: 0=left(C8 data), 7=right(C1 data)
      const xPct = `calc(${gridPadSide}px + (100% - ${gridPadSide * 2}px) * ${(ci + 0.5) / NUM_COLS})`;
      const yPct = `calc(${gridPadTop}px + (100% - ${gridPadTop + gridPadBottom}px) * ${(ri + 0.5) / NUM_ROWS})`;
      return { id: ++rippleIdRef.current, x: xPct as any, y: yPct as any, color: mvToColor(mv) };
    });
    setRipples(prev => [...prev, ...newRipples].slice(-24));

    // Update feed
    const newItems: FeedItem[] = hits.map(([row, col, mv]) => ({
      row, col, mv, key: String(feedCounter.current++),
    }));
    setFeed(prev => [...newItems, ...prev].slice(0, 60));

    setPeakMv(prev => Math.max(prev, ...hits.map(h => h[5])));  // h[5] = v_peak_mv
  }, []);

  // ── BLE connect / disconnect ──────────────────────────────────────────────────
  const [bleError,      setBleError]      = useState<string | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  // ── Native BLE picker state ───────────────────────────────────────────────
  const [pickerOpen,    setPickerOpen]    = useState(false);
  const [pickerDevices, setPickerDevices] = useState<ScannedDevice[]>([]);
  const [pickerScanning, setPickerScanning] = useState(false);
  // Resolves/rejects the pending connectBle promise when user picks or cancels
  const pickerResolveRef = useRef<((d: ScannedDevice | null) => void) | null>(null);

  // Opens the in-app picker for native: starts a scan, resolves when user picks
  const openNativePicker = useCallback((): Promise<ScannedDevice | null> => {
    return new Promise(resolve => {
      pickerResolveRef.current = resolve;
      setPickerDevices([]);
      setPickerScanning(true);
      setPickerOpen(true);

      scanForDevices({
        durationMs: 10_000,
        // Limit results to known bag prefixes (TS = new, MPY = returning).
        // Both are read from .env so a single constant stays in sync.
        namePrefixes: getBleNamePrefixes().all,
        onUpdate: devices => setPickerDevices(devices),
      }).finally(() => setPickerScanning(false));
    });
  }, []);

  const closePicker = useCallback((picked: ScannedDevice | null) => {
    setPickerOpen(false);
    setPickerScanning(false);
    stopScan();
    pickerResolveRef.current?.(picked);
    pickerResolveRef.current = null;
  }, []);

  const connectBle = useCallback(async () => {
    if (!bleSupported) return;
    setBleStatus("scanning");
    setBleError(null);
    try {
      let conn: AdapterConnection;

      if (isNativeApp()) {
        // ── Native path: show our own in-app picker ─────────────────────────
        // Opens a bottom sheet that runs a live BLE scan and lists all nearby
        // devices. The user taps one; we connect directly — no OS picker, no
        // name-cache dependency.
        const picked = await openNativePicker();
        if (!picked) {
          // User cancelled
          setBleStatus("idle");
          setBleError(null);
          return;
        }

        // Classify: "ts" = new/first-time, "mpy" = returning/paired
        const deviceKind = classifyDevice(picked.name);
        const isFirstTime = deviceKind === "ts";
        console.log(`[BLE] connecting to ${picked.name} — kind=${deviceKind} (${isFirstTime ? "first-time setup" : "returning device"})`);

        // Update status label to reflect which flow we're entering
        setBleStatus("scanning"); // keeps the scanning spinner visible

        conn = await connectToDeviceNative({
          device: picked,
          serviceUuid: NUS_SERVICE_UUID,
          onDisconnect: () => {
            setBleStatus("disconnected");
            setDeviceInfo(null);
            captureRef.current = false;
            connRef.current    = null;
            setSessionActive(false);
          },
        });

        // After a successful first-time (TS) connection, record this deviceId so
        // we can recognise it as a returning device if it ever re-advertises as TS.
        if (isFirstTime) {
          try {
            const stored: string[] = JSON.parse(localStorage.getItem("ts_known_devices") ?? "[]");
            if (!stored.includes(picked.deviceId)) {
              localStorage.setItem("ts_known_devices", JSON.stringify([...stored, picked.deviceId]));
            }
          } catch { /* localStorage unavailable — non-fatal */ }
        }
      } else {
        // ── Web Bluetooth path ───────────────────────────────────────────────
        // Try primary prefix (TS = new devices) first, then fall back to the
        // legacy prefix (MPY = returning devices) so both are reachable from
        // a single connect button press without requiring a second OS dialog.
        const { primary: webPrimary, legacy: webLegacy } = getBleNamePrefixes();
        const onDisc = () => {
          setBleStatus("disconnected");
          setDeviceInfo(null);
          captureRef.current = false;
          connRef.current    = null;
          setSessionActive(false);
        };
        let webConn: typeof conn | null = null;
        try {
          webConn = await connectToAdapter({ namePrefix: webPrimary, serviceUuid: NUS_SERVICE_UUID, onDisconnect: onDisc });
        } catch (e: any) {
          // Re-throw cancels immediately — don't show a second picker
          if (isUserCancel(e?.message ?? "")) throw e;
          // Primary prefix failed — retry with legacy prefix (MPY returning devices)
          console.warn(`[BLE] primary prefix "${webPrimary}" failed, retrying with "${webLegacy}":`, e?.message);
          webConn = await connectToAdapter({ namePrefix: webLegacy, serviceUuid: NUS_SERVICE_UUID, onDisconnect: onDisc });
        }
        conn = webConn!;
      }

      connRef.current = conn;

      const { TX } = getCharUuids();
      await adapterStartNotifications(conn, TX, handleNotify);

      setBleStatus("connected");
      setConnectAttempt(0);
      setBleError(null);
    } catch (err: any) {
      console.error("[BLE] connect error:", err);
      const msg = err?.message ?? "";

      const userCancelled =
        msg.includes("cancelled") ||
        msg.includes("NotFoundError") ||
        msg.includes("User cancelled") ||
        msg.includes("chooser");

      if (userCancelled) {
        setBleStatus("idle");
        setBleError(null);
        return;
      }

      setConnectAttempt(n => n + 1);
      setBleStatus("disconnected");

      if (msg.includes("GATT") || msg.includes("gatt")) {
        setBleError("GATT connection failed. Make sure the bag is powered on and within range, then try again.");
      } else if (msg.includes("Bluetooth") || msg.includes("adapter")) {
        setBleError("Bluetooth adapter error. Check that Bluetooth is enabled on this device.");
      } else {
        setBleError("Could not connect. Make sure the bag is powered on and no other device is already connected to it.");
      }
    }
  }, [bleSupported, handleNotify, openNativePicker]);

  const disconnectBle = useCallback(async () => {
    captureRef.current = false;
    setSessionActive(false);
    const conn = connRef.current;
    connRef.current = null;
    await adapterDisconnect(conn);
    setBleStatus("disconnected");
  }, []);

  const removeRipple = useCallback((id: number) => {
    setRipples(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── BLE command sender ────────────────────────────────────────────────────────
  const sendCommand = useCallback(async (cmd: "start" | "stop") => {
    const conn = connRef.current;
    if (!conn) return;
    const { RX } = getCharUuids();
    try {
      await writeUtf8(conn, RX, JSON.stringify({ cmd }));
      console.log(`[BLE] sent cmd=${cmd}`);
    } catch (err) {
      console.warn("[BLE] sendCommand failed:", err);
    }
  }, []);

  // ── OTA sender — splits a file into base64-encoded chunks over BLE NUS ─────────
  // Usage: await sendOta("main.py", fileContent, "1.1.0")
  //
  // Why base64? Python source contains multi-byte UTF-8 chars (e.g. box-drawing ─
  // = 3 bytes each) and JSON-escaped newlines (1 → 2 bytes). A 100-char chunk of
  // comment-divider lines can serialize to 340+ bytes — way over the 185-byte iOS
  // ATT write MTU. Base64 is all ASCII: every char is exactly 1 byte, so packet
  // sizes are deterministic. 128 base64 chars = 96 raw bytes; total JSON packet =
  // 128 + 26-byte envelope = 154 bytes — safely under every platform's MTU.
  // CHUNK_SIZE must be a multiple of 4 so every chunk is valid base64 on its own.
  const sendOta = useCallback(async (filename: string, content: string, newFw: string) => {
    const conn = connRef.current;
    if (!conn) return;
    const { RX } = getCharUuids();
    const CHUNK_SIZE = 128; // multiple of 4 — each chunk is self-contained valid base64

    // UTF-8 encode then base64 so the ESP32 gets the exact original bytes
    const b64 = btoa(
      Array.from(new TextEncoder().encode(content), b => String.fromCharCode(b)).join("")
    );

    await writeUtf8(conn, RX, JSON.stringify({ cmd: "ota_start", filename, size: content.length }));
    await new Promise(r => setTimeout(r, 100));

    for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
      await writeUtf8(conn, RX, JSON.stringify({
        cmd: "ota_chunk",
        data: b64.slice(i, i + CHUNK_SIZE),
      }));
      await new Promise(r => setTimeout(r, 30));  // give ESP32 time to buffer
    }

    await writeUtf8(conn, RX, JSON.stringify({ cmd: "ota_end", fw: newFw }));
    console.log(`[OTA] transfer complete — ${content.length} bytes → ${filename} fw=${newFw}`);
  }, []);

  // ── runOta — fetches firmware + drives sendOta with live progress ─────────────
  // Called by the "Confirm Update" button. Tracks chunk progress 0→95%, then
  // waits for the ota_ok/ota_err notify from the device to reach 100% or error.
  const runOta = useCallback(async () => {
    if (!latestFw || !connRef.current) return;
    setOtaState("updating");
    setOtaProgress(0);
    setOtaError(null);

    try {
      // 1. Fetch the firmware file from the public folder
      const resp = await fetch("/firmware/main.py");
      if (!resp.ok) throw new Error(`Could not fetch firmware (${resp.status})`);
      const content = await resp.text();

      // 2. Stream chunks with progress updates
      const { RX } = getCharUuids();
      // Base64-encode so every chunk is pure ASCII — predictable 1 byte/char.
      // 128 base64 chars + 26-byte JSON envelope = 154 bytes per write.
      // Must be a multiple of 4 so each slice is self-contained valid base64.
      const CHUNK_SIZE = 128;
      const b64 = btoa(
        Array.from(new TextEncoder().encode(content), b => String.fromCharCode(b)).join("")
      );
      const totalChunks = Math.ceil(b64.length / CHUNK_SIZE);

      await writeUtf8(connRef.current, RX, JSON.stringify({
        cmd: "ota_start", filename: "main_new.py", size: content.length,
      }));
      await new Promise(r => setTimeout(r, 100));

      for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
        if (!connRef.current) throw new Error("BLE disconnected during update");
        await writeUtf8(connRef.current, RX, JSON.stringify({
          cmd: "ota_chunk",
          data: b64.slice(i, i + CHUNK_SIZE),
        }));
        const sent = Math.floor(i / CHUNK_SIZE) + 1;
        // Reserve last 5% for the device-side write + NVS update + reset signal
        setOtaProgress(Math.round((sent / totalChunks) * 95));
        await new Promise(r => setTimeout(r, 30));
      }

      await writeUtf8(connRef.current, RX, JSON.stringify({ cmd: "ota_end", fw: latestFw }));
      // Progress goes to 100% when ota_ok arrives via handleNotify
    } catch (err: any) {
      console.error("[OTA] runOta error:", err);
      setOtaError(err.message ?? "Update failed");
      setOtaState("error");
    }
  }, [latestFw]);

  // ── Session controls ──────────────────────────────────────────────────────────
  const startSession = async () => {
    // Unlock audio context synchronously inside the user-gesture handler.
    // This satisfies iOS/Android's requirement that AudioContext be resumed
    // during a tap — all subsequent playSignal calls will reuse this context.
    unlockAudio();

    sessionIdRef.current = genSessionId();
    framesRef.current    = [];
    frameIndex.current   = 0;
    feedCounter.current  = 0;
    // Reset accuracy
    accHitsRef.current = 0;
    accSumRef.current  = 0;
    setAvgAccuracy(null);
    // Reset reaction
    if (rxTimer.current) clearTimeout(rxTimer.current);
    setRxPhase("idle");
    rxPhaseRef.current = "idle";
    setRxTime(null);
    setRxBestMs(null);
    setRxAttempts(0);
    setRxAvgMs(null);
    rxSumMs.current = 0;
    rxAttemptsRef.current = 0;
    // Reset pending frame stamps
    pendingRxMsRef.current         = null;
    pendingTgtZoneRef.current      = null;
    pendingTgtCorrectRef.current   = null;
    pendingVolWindowIdxRef.current = null;
    pendingVolHitSeqRef.current    = null;

    setGrid(new Map());
    setFeed([]);
    setRipples([]);
    setPeakMv(0);
    setElapsedMs(0);
    setSaveState("idle");
    setSaveError(null);
    startTimeRef.current = Date.now();
    captureRef.current   = true;
    setSessionActive(true);
    await sendCommand("start");

        // Reset volume
    if (volTimer.current) clearTimeout(volTimer.current);
    if (volTickTimer.current) clearInterval(volTickTimer.current);
    setVolPhase("idle");
    volPhaseRef.current = "idle";
    setVolHits(0);
    setVolBest(null);
    setVolAttempts(0);
    setVolAvg(null);
    setVolRemainingMs(0);
    volHitsRef.current = 0;
    volSumRef.current = 0;
    volAttemptsRef.current = 0;
    volSignalAt.current = null;
    volWindowEndsAt.current = null;
    volWindowIdxRef.current = -1;       // first window open increments to 0
    volWindowHitSeqRef.current = 0;

    // Kick off reaction sequence immediately
    if (sessionMode === "reaction") {
      scheduleNextReaction();
    }
    if (sessionMode === "volume") {
      scheduleNextVolume();
    }
    if (sessionMode === "target") {
      // Reset target state
      if (tgtTimer.current) clearTimeout(tgtTimer.current);
      setTgtPhase("idle");
      tgtPhaseRef.current = "idle";
      setTgtZone(null);
      setTgtZoneHit(null);
      setTgtCorrect(null);
      setTgtReactMs(null);
      setTgtAttempts(0);
      setTgtHits(0);
      setTgtBestMs(null);
      setTgtAvgMs(null);
      tgtSumMs.current      = 0;
      tgtCorrectSumMs.current = 0;
      tgtAttemptsRef.current = 0;
      tgtZoneRef.current   = null;
      tgtSignalAt.current  = null;
      scheduleNextTarget();
    }
  };

  const stopSession = async () => {
    captureRef.current = false;
    if (rxTimer.current) clearTimeout(rxTimer.current);
    if (tgtTimer.current) clearTimeout(tgtTimer.current);
    if (volTimer.current) clearTimeout(volTimer.current);
    if (volTickTimer.current) clearInterval(volTickTimer.current);
    setRxPhase("idle");
    rxPhaseRef.current = "idle";
    setTgtPhase("idle");
    tgtPhaseRef.current = "idle";
    setVolPhase("idle");
    volPhaseRef.current = "idle";
    window.speechSynthesis?.cancel();
    setSessionActive(false);
    closeAudio();
    await sendCommand("stop");
  };

  // ── Save to Supabase ──────────────────────────────────────────────────────────
  const saveSession = async () => {
    if (!supabase || !selectedAthlete || !userId || !programId) return;
    if (framesRef.current.length === 0) return;

    setSaveState("saving");
    setSaveError(null);

    try {
      await uploadSession({
        sessionId:   sessionIdRef.current,
        programId,
        athleteId:   selectedAthlete.id,
        coreTeamId:  selectedAthlete.core_team_id ?? null,
        createdBy:   userId,
        frames:      framesRef.current,
        startedAtMs: startTimeRef.current ?? Date.now(),
        endedAtMs:   Date.now(),
        mode:        sessionMode,
        deviceModel: "TSII",
        samplingHz:  25,
        // reaction live stats
        rxBestMs:    rxBestMs,
        rxAvgMs:     rxAvgMs,
        rxAttempts:  rxAttemptsRef.current,
        // accuracy live stats
        accHitsCount: accHitsRef.current,
        accScoreSum:  accSumRef.current,
        // target live stats
        tgtAttempts:     tgtAttemptsRef.current,
        tgtCorrectHits:  tgtHits,
        tgtCorrectSumMs: tgtCorrectSumMs.current,
        tgtBestMs:       tgtBestMs,
        // physical device identity from hello packet
        deviceId:    deviceInfo?.id,
      });
      setSaveState("saved");
    } catch (err: any) {
      console.error("Session save failed:", err);
      setSaveError(err.message ?? "Unknown error");
      setSaveState("error");
    }
  };

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const [frameCount, setFrameCount] = useState(0);
  // Periodically sync frame count for display (ref doesn't trigger re-render)
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => setFrameCount(framesRef.current.length), 500);
    return () => clearInterval(id);
  }, [sessionActive]);

  // ── Status config ─────────────────────────────────────────────────────────────
  const statusConfig = {
    idle:        { dot: "var(--muted)",  label: "No device",       color: "var(--text)" },
    scanning:    { dot: "#ffcc00",       label: "Scanning…",       color: "#ffcc00" },
    connected:   { dot: "#00ff88",       label: "Connected",       color: "#00ff88" },
    disconnected:{ dot: "#ff4444",       label: "Disconnected",    color: "#ff4444" },
    unsupported: { dot: "#ff4444",       label: "BLE Unsupported", color: "#ff4444" },
  }[bleStatus];

  const canSave = !sessionActive && framesRef.current.length > 0 && saveState !== "saved";

  const saveBtnStyle: Record<SaveState, { bg: string; border: string; color: string; label: string }> = {
    idle:   { bg: "var(--accent)",           border: "rgba(180,0,255,0.55)", color: "#000",      label: "Save Session" },
    saving: { bg: "rgba(180,0,255,0.20)",    border: "rgba(180,0,255,0.35)", color: "rgba(180,0,255,0.9)", label: "Saving…" },
    saved:  { bg: "rgba(0,255,136,0.12)",    border: "rgba(0,255,136,0.30)", color: "#00ff88",   label: "✓  Saved" },
    error:  { bg: "rgba(255,80,80,0.12)",    border: "rgba(255,80,80,0.28)", color: "#ff8080",   label: "Retry Save" },
  };

  // ── Pre-compute mode-specific stats for the stats panel ──────────────────────
  type StatItem = { label: string; value: string; sub?: string; color?: string };
  const tgtAccPct = tgtAttempts > 0 ? Math.round((tgtHits / tgtAttempts) * 100) : null;
  const statsItems: StatItem[] = sessionMode === "reaction"
    ? [
        { label: "Time",     value: formatTime(elapsedMs) },
        { label: "Attempts", value: String(rxAttempts),  color: MODE_META.reaction.color },
        { label: "Best RT",  value: rxBestMs ? String(rxBestMs) : "—", sub: rxBestMs ? "ms" : "",
          color: rxBestMs ? (rxBestMs < 300 ? "#00ff88" : rxBestMs < 500 ? "#ffcc00" : "#ff6060") : undefined },
        { label: "Avg RT",   value: rxAvgMs  ? String(rxAvgMs)  : "—", sub: rxAvgMs  ? "ms" : "" },
      ]
    : sessionMode === "accuracy"
    ? [
        { label: "Time",     value: formatTime(elapsedMs) },
        { label: "Events",   value: String(sessionActive ? frameCount : framesRef.current.length) },
        { label: "Accuracy", value: avgAccuracy != null ? String(avgAccuracy) : "—", sub: avgAccuracy != null ? "%" : "",
          color: avgAccuracy != null ? (avgAccuracy >= 70 ? "#00ff88" : avgAccuracy >= 45 ? "#00dcff" : "#ffcc00") : undefined },
        { label: "Peak",     value: peakMv ? (peakMv / 1000).toFixed(3) : "—", sub: peakMv ? "V" : "" },
      ]
    : sessionMode === "target"
    ? [
        { label: "Time",     value: formatTime(elapsedMs) },
        { label: "Attempts", value: String(tgtAttempts), color: MODE_META.target.color },
        { label: "Accuracy", value: tgtAccPct != null ? String(tgtAccPct) : "—", sub: tgtAccPct != null ? "%" : "",
          color: tgtAccPct != null ? (tgtAccPct >= 70 ? "#00ff88" : tgtAccPct >= 45 ? "#ffcc00" : "#ff6060") : undefined },
        { label: "Best RT",  value: tgtBestMs ? String(tgtBestMs) : "—", sub: tgtBestMs ? "ms" : "",
          color: tgtBestMs ? (tgtBestMs < 300 ? "#00ff88" : tgtBestMs < 500 ? "#ffcc00" : "#ff6060") : undefined },
      ]
    : [
        { label: "Time",   value: formatTime(elapsedMs) },
        { label: "Events", value: String(sessionActive ? frameCount : framesRef.current.length), color: MODE_META.power.color },
        { label: "Hits",   value: String(feed.length) },
        { label: "Peak",   value: peakMv ? (peakMv / 1000).toFixed(3) : "—", sub: peakMv ? "V" : "", color: MODE_META.power.color },
      ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 38, height: 38, borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)", cursor: "pointer", flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 13L5 8l5-5" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: 0.1 }}>New Session</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Select an athlete, connect the bag, and record impacts live.
          </p>
        </div>
      </div>

      {/* ── 3-col layout ────────────────────────────────────────────────────── */}
      <div className="ts-ses-layout">

        {/* ════ LEFT — Athlete + BLE ════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Athlete card */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
              Athlete
            </div>

            {/* Search */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", marginBottom: 10 }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.45, flexShrink: 0 }}>
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                value={athleteFilter}
                onChange={e => setAthleteFilter(e.target.value)}
                placeholder="Search athletes…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13 }}
              />
              {athleteFilter && (
                <button onClick={() => setAthleteFilter("")} style={{ background: "none", border: "none", color: "var(--text)", opacity: 0.4, cursor: "pointer", padding: "0 2px", fontSize: 12, lineHeight: 1 }}>✕</button>
              )}
            </div>

            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
              {athletesLoading ? (
                <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>Loading…</div>
              ) : filteredAthletes.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
                  {athleteFilter ? "No results" : "No athletes found"}
                </div>
              ) : filteredAthletes.map(a => {
                const sel      = selectedAthlete?.id === a.id;
                const initials = `${a.first_name[0]}${a.last_name[0]}`.toUpperCase();
                return (
                  <div
                    key={a.id}
                    onClick={() => { setSelectedAthlete(sel ? null : a); if (sel) stopSession(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 11px", borderRadius: 11, cursor: "pointer",
                      border: sel ? "1px solid rgba(180,0,255,0.50)" : "1px solid rgba(255,255,255,0.06)",
                      background: sel ? "rgba(180,0,255,0.10)" : "rgba(255,255,255,0.02)",
                      transition: "all 140ms ease",
                    }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 800,
                      background: sel ? "linear-gradient(135deg, rgba(180,0,255,0.45), rgba(180,0,255,0.20))" : "linear-gradient(135deg, rgba(180,0,255,0.18), rgba(180,0,255,0.08))",
                      border: sel ? "1px solid rgba(180,0,255,0.55)" : "1px solid rgba(180,0,255,0.22)",
                      color: sel ? "rgba(220,150,255,1)" : "rgba(200,120,255,0.85)",
                    }}>{initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.first_name} {a.last_name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        {[a.position, a.sport].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    {sel && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, boxShadow: "0 0 6px 2px rgba(180,0,255,0.55)" }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* BLE card */}
          {selectedAthlete && (
            <div style={{
              background: "var(--panel)",
              border: bleStatus === "connected" ? "1px solid rgba(0,255,136,0.28)" : "1px solid var(--panel-border)",
              borderRadius: 16, padding: 16,
              animation: "tsSlideUp 0.22s ease-out",
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
                Bag Connection
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: statusConfig.dot, flexShrink: 0,
                  boxShadow: bleStatus === "connected" ? "0 0 6px 3px rgba(0,255,136,0.45)"
                           : bleStatus === "scanning"   ? "0 0 6px 3px rgba(255,200,0,0.45)" : "none",
                  animation: bleStatus === "scanning" ? "tsBlink 1s ease-in-out infinite" : "none",
                }} />
                <span style={{ fontSize: 13, color: statusConfig.color, fontWeight: 600 }}>{statusConfig.label}</span>
                {deviceInfo && bleStatus === "connected" && (
                  <div style={{
                    marginLeft: "auto",
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 9px", borderRadius: 7,
                    background: "rgba(180,0,255,0.10)",
                    border: "1px solid rgba(180,0,255,0.25)",
                    fontSize: 11, fontWeight: 700, color: "#b400ff",
                  }}>
                    {deviceInfo.id}
                    <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 10 }}>
                      v{deviceInfo.fw}
                    </span>
                  </div>
                )}
              </div>

              {/* Mode selector — visible once connected, locked during active session */}
              {bleStatus === "connected" && (
                <>
                  {/* ── OTA firmware banner ─────────────────────────────────── */}
                  {otaState === "available" && !sessionActive && (
                    <div style={{
                      marginBottom: 14, padding: "11px 13px", borderRadius: 10,
                      background: "rgba(255,200,0,0.07)",
                      border: "1px solid rgba(255,200,0,0.30)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "#ffcc00", letterSpacing: "0.03em" }}>
                            ⬆ Firmware Update
                          </div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
                            v{deviceInfo?.fw} → v{latestFw}
                          </div>
                        </div>
                        <button
                          onClick={runOta}
                          style={{
                            flexShrink: 0, padding: "5px 13px", borderRadius: 7,
                            fontWeight: 700, fontSize: 11, cursor: "pointer",
                            background: "#ffcc00", border: "none", color: "#000",
                          }}
                        >
                          Update
                        </button>
                      </div>
                    </div>
                  )}

                  {otaState === "updating" && (
                    <div style={{
                      marginBottom: 14, padding: "11px 13px", borderRadius: 10,
                      background: "rgba(255,200,0,0.06)",
                      border: "1px solid rgba(255,200,0,0.22)",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#ffcc00" }}>
                          Updating firmware…
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#ffcc00", fontVariantNumeric: "tabular-nums" }}>
                          {otaProgress}%
                        </div>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          background: "linear-gradient(90deg, #ffcc00, #ffaa00)",
                          width: `${otaProgress}%`,
                          transition: "width 200ms ease",
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 7, lineHeight: 1.4 }}>
                        Do not disconnect — device will reset automatically
                      </div>
                    </div>
                  )}

                  {otaState === "done" && (
                    <div style={{
                      marginBottom: 14, padding: "11px 13px", borderRadius: 10,
                      background: "rgba(0,255,136,0.06)",
                      border: "1px solid rgba(0,255,136,0.25)",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#00ff88" }}>
                        ✓ Update applied
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
                        Device is restarting — reconnect in a moment
                      </div>
                    </div>
                  )}

                  {otaState === "error" && (
                    <div style={{
                      marginBottom: 14, padding: "11px 13px", borderRadius: 10,
                      background: "rgba(255,80,80,0.06)",
                      border: "1px solid rgba(255,80,80,0.25)",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#ff6060" }}>
                        ✗ Update failed
                      </div>
                      {otaError && (
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>
                          {otaError}
                        </div>
                      )}
                      <button
                        onClick={() => setOtaState("available")}
                        style={{
                          marginTop: 7, fontSize: 10, fontWeight: 700,
                          color: "#ffcc00", background: "none", border: "none",
                          cursor: "pointer", padding: 0,
                        }}
                      >
                        Retry →
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Mode selector — visible once connected, locked during active session */}
              {bleStatus === "connected" && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
                    Mode
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {MODES.map(m => {
                      const meta = MODE_META[m];
                      const active = sessionMode === m;
                      const locked = sessionActive;
                      return (
                        <button
                          key={m}
                          onClick={() => !locked && setSessionMode(m)}
                          disabled={locked}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 12px", borderRadius: 10, width: "100%",
                            cursor: locked ? "default" : "pointer",
                            border: active ? `1px solid ${meta.color}66` : "1px solid rgba(255,255,255,0.07)",
                            background: active ? `${meta.color}14` : "rgba(255,255,255,0.02)",
                            transition: "all 150ms ease",
                            opacity: locked && !active ? 0.4 : 1,
                          }}
                        >
                          <span style={{ fontSize: 16, lineHeight: 1 }}>{meta.icon}</span>
                          <div style={{ textAlign: "left", flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: active ? meta.color : "var(--text)" }}>
                              {meta.label}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1, lineHeight: 1.4 }}>
                              {meta.desc}
                            </div>
                          </div>
                          {active && (
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0, boxShadow: `0 0 6px 2px ${meta.glow}` }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {bleStatus !== "connected" ? (
                <button
                  onClick={connectBle}
                  disabled={!bleSupported || bleStatus === "scanning"}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 11,
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                    background: bleStatus === "disconnected" ? "rgba(180,0,255,0.18)" : "var(--accent)",
                    border: bleStatus === "disconnected" ? "1px solid rgba(180,0,255,0.45)" : "1px solid rgba(180,0,255,0.55)",
                    color: bleStatus === "disconnected" ? "rgba(220,150,255,0.95)" : "#000",
                    opacity: bleStatus === "scanning" ? 0.65 : 1,
                    transition: "all 160ms ease",
                  }}
                >
                  {bleStatus === "scanning"
                    ? "Scanning…"
                    : bleStatus === "disconnected"
                    ? `Retry Connection${connectAttempt > 1 ? ` (${connectAttempt})` : ""}`
                    : "Connect to Bag"}
                </button>
              ) : (
                <button
                  onClick={disconnectBle}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 11,
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "var(--text)", transition: "all 160ms ease",
                  }}
                >
                  Disconnect
                </button>
              )}

              {/* Connection error hint */}
              {bleError && bleStatus === "disconnected" && (
                <div style={{
                  marginTop: 10, padding: "9px 11px", borderRadius: 9,
                  background: "rgba(255,80,80,0.07)",
                  border: "1px solid rgba(255,80,80,0.22)",
                  fontSize: 11, color: "#ff9090", lineHeight: 1.55,
                }}>
                  {bleError}
                  {connectAttempt >= 2 && (
                    <div style={{ marginTop: 6, color: "rgba(255,180,180,0.75)" }}>
                      Tip: make sure no other phone or laptop is already paired to this bag — ESP32 only accepts one connection at a time.
                    </div>
                  )}
                </div>
              )}

              {!bleSupported && (
                <p style={{ fontSize: 12, color: "#ff6060", margin: "10px 0 0", lineHeight: 1.5 }}>
                  Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop, or open the Trench Sports app on your phone.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ════ CENTER — Live bag grid (matches hitSimulator aesthetic) ════ */}
        <div>

          {/* Bag wrap — identical structure to ts-sim-bagWrap */}
          <div
            className="ts-ses-bagWrap"
            style={{
              boxShadow: bleStatus === "connected"
                ? `0 0 40px -10px ${MODE_META[sessionMode].glow.replace("0.55","0.35")}, inset 0 0 60px -20px ${MODE_META[sessionMode].glow.replace("0.55","0.12")}`
                : "none",
              borderColor: bleStatus === "connected"
                ? `${MODE_META[sessionMode].color}44`
                : "var(--panel-border)",
              transition: "border-color 300ms, box-shadow 300ms",
            }}
          >
            {/* Stop button — overlaid top-right inside bag */}
            {sessionActive && (
              <div style={{
                position: "absolute", top: 10, right: 10, zIndex: 9,
                display: "flex", gap: 8,
              }}>
                <button
                  onClick={stopSession}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: 11,
                    background: "rgba(255,80,80,0.18)", border: "1px solid rgba(255,80,80,0.35)",
                    color: "#ff8080", cursor: "pointer",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  Stop
                </button>
              </div>
            )}

            {/* Full-grid start overlay — tap anywhere to start */}
            {bleStatus === "connected" && !sessionActive && selectedAthlete && (
              <div
                onClick={startSession}
                style={{
                  position: "absolute", inset: 0, zIndex: 7,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  borderRadius: 16, cursor: "pointer",
                  background: "rgba(0,0,0,0.45)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <div style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 10,
                  animation: "tsStartPulse 1.4s ease-in-out infinite",
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: `${MODE_META[sessionMode].color}22`,
                    border: `2px solid ${MODE_META[sessionMode].color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: `0 0 24px 6px ${MODE_META[sessionMode].glow}`,
                    fontSize: 22,
                  }}>
                    {MODE_META[sessionMode].icon}
                  </div>
                  <div style={{
                    fontSize: 15, fontWeight: 900, letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: MODE_META[sessionMode].color,
                    textShadow: `0 0 18px ${MODE_META[sessionMode].glow}`,
                  }}>
                    Tap to Start
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                    color: "rgba(255,255,255,0.40)", textTransform: "uppercase",
                  }}>
                    {MODE_META[sessionMode].label} Mode
                  </div>
                </div>
              </div>
            )}

            {/* Bag label */}
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
              opacity: 0.30, pointerEvents: "none", zIndex: 4, whiteSpace: "nowrap",
            }}>
              Heavy Bag — {NUM_ROWS} × {NUM_COLS} Grid
            </div>

            {/* Accuracy rings overlay */}
            {sessionMode === "accuracy" && (
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3,
              }}>
                {[
                  { size: "20%",  color: "rgba(0,255,120,0.60)" },
                  { size: "40%",  color: "rgba(0,220,255,0.38)" },
                  { size: "62%",  color: "rgba(255,160,0,0.28)" },
                  { size: "84%",  color: "rgba(255,60,60,0.20)" },
                ].map((r, i) => (
                  <div key={i} style={{
                    position: "absolute",
                    width: r.size, paddingBottom: r.size,
                    borderRadius: "50%",
                    border: `1px solid ${r.color}`,
                    left: "50%", top: "50%",
                    transform: "translate(-50%, -50%)",
                  }} />
                ))}
                <div style={{
                  position: "absolute", width: 10, height: 10, borderRadius: "50%",
                  background: "rgba(0,255,120,0.9)",
                  boxShadow: "0 0 10px 4px rgba(0,255,120,0.5)",
                }} />
              </div>
            )}

            {/* Reaction overlay */}
            {sessionMode === "reaction" && sessionActive && (
              <ReactionOverlay phase={rxPhase} reactionMs={rxTime} />
            )}

            {/* Volume overlay */}
            {sessionMode === "volume" && sessionActive && (
              <VolumeOverlay phase={volPhase} hits={volHits} remainingMs={volRemainingMs} />
            )}

            {/* Target overlay */}
            {sessionMode === "target" && sessionActive && (
              <TargetOverlay
                phase={tgtPhase}
                zone={tgtZone}
                reactionMs={tgtReactMs}
                zoneHit={tgtZoneHit}
                correct={tgtCorrect}
                tgtAttempts={tgtAttempts}
                tgtHits={tgtHits}
              />
            )}

            {/* Target mode — 3×3 zone grid lines (always visible when mode is active) */}
            {sessionMode === "target" && (
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
                padding: "28px 6px 6px", boxSizing: "border-box",
              }}>
                {/* Horizontal dividers at 1/3 and 2/3 */}
                {[1, 2].map(i => (
                  <div key={`h${i}`} style={{
                    position: "absolute", left: 6, right: 6,
                    top: `calc(28px + (100% - 34px) * ${i / 3})`,
                    height: 1,
                    background: "rgba(0,255,136,0.18)",
                  }} />
                ))}
                {/* Vertical dividers at 1/3 and 2/3 */}
                {[1, 2].map(i => (
                  <div key={`v${i}`} style={{
                    position: "absolute", top: 28, bottom: 6,
                    left: `calc(6px + (100% - 12px) * ${i / 3})`,
                    width: 1,
                    background: "rgba(0,255,136,0.18)",
                  }} />
                ))}
              </div>
            )}

            {/* Hit grid — fills the bag */}
            <div style={{ position: "absolute", inset: 0 }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${NUM_COLS}, 1fr)`,
                gridTemplateRows: `repeat(${NUM_ROWS}, 1fr)`,
                gap: 3,
                padding: "28px 6px 6px",
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
              }}>
                {Array.from({ length: NUM_ROWS }, (_, ri) =>
                  Array.from({ length: NUM_COLS }, (_, ci) => {
                    const key   = cellKey(NUM_ROWS - ri, NUM_COLS - ci);
                    const cell  = grid.get(key);
                    const age   = cell ? now - cell.ts : Infinity;
                    const alive = age < FADE_TTL_MS;
                    const fade  = alive ? Math.max(0.07, 1 - age / FADE_TTL_MS) : 0;
                    const color = alive ? mvToColor(cell!.mv) : null;

                    return (
                      <div
                        key={key}
                        className="ts-sim-cell ts-ses-cell"
                        style={{
                          position: "relative",
                          borderRadius: 4,
                          background: alive
                            ? `${color}${hexAlpha(fade * 0.72)}`
                            : "rgba(255,255,255,0.03)",
                          boxShadow: alive
                            ? `0 0 10px 2px ${mvToGlow(cell!.mv)}${hexAlpha(fade * 0.8)}`
                            : "none",
                          border: alive
                            ? `1px solid ${color}${hexAlpha(fade * 0.6)}`
                            : undefined,
                          transform: alive && fade > 0.7 ? "scale(1.06)" : "scale(1)",
                          transition: "background 60ms, box-shadow 60ms, transform 80ms, border-color 60ms",
                          overflow: "hidden",
                        }}
                      >
                        {/* Live voltage label */}
                        {alive && cell && fade > 0.2 && (
                          <div style={{
                            position: "absolute", inset: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 8, fontWeight: 800,
                            color: color!,
                            opacity: Math.min(1, fade * 1.4),
                            pointerEvents: "none",
                            fontVariantNumeric: "tabular-nums",
                            letterSpacing: "-0.02em",
                            textShadow: `0 0 6px ${mvToGlow(cell.mv)}`,
                          }}>
                            {(cell.mv / 1000).toFixed(2)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Impact ripples */}
            {ripples.map(r => (
              <ImpactRipple
                key={r.id}
                id={r.id}
                x={r.x}
                y={r.y}
                color={r.color}
                onDone={() => removeRipple(r.id)}
              />
            ))}

            {/* Bottom glow edge */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: "radial-gradient(ellipse at 50% 100%, rgba(180,0,255,0.18) 0%, transparent 65%)",
              transition: "opacity 500ms",
              opacity: bleStatus === "connected" ? 1 : 0.3,
            }} />

            {/* Overlay — no athlete or not connected */}
            {(!selectedAthlete || bleStatus === "idle" || bleStatus === "disconnected" || bleStatus === "unsupported") && (
              <div style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: "rgba(7,7,10,0.78)", backdropFilter: "blur(6px)",
                borderRadius: 16, zIndex: 5, pointerEvents: "none",
              }}>
                {!selectedAthlete ? (
                  <>
                    <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.28 }}>👤</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", opacity: 0.55 }}>Select an athlete to begin</div>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: 52, height: 52, borderRadius: "50%",
                      border: "2px solid rgba(180,0,255,0.28)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginBottom: 12, opacity: 0.38,
                    }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M8.5 12.5c2-2 5-2 7 0" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round"/>
                        <path d="M5.5 9.5c4-4 9-4 13 0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round"/>
                        <circle cx="12" cy="16" r="1.5" fill="rgba(255,255,255,0.6)" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", opacity: 0.55 }}>Connect bag to see impacts</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT — Stats + feed ════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Stats */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
              {MODE_META[sessionMode].icon} {MODE_META[sessionMode].label} Session
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {statsItems.map(s => (
                <div key={s.label} style={{ padding: "10px 12px", borderRadius: 11, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, color: s.color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {s.value}
                    {s.sub && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", marginLeft: 2 }}>{s.sub}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Save */}
            {canSave && (
              <button
                onClick={saveSession}
                disabled={saveState === "saving" || saveState === "saved"}
                style={{
                  width: "100%", marginTop: 12, padding: "10px 0",
                  borderRadius: 10, fontWeight: 700, fontSize: 13,
                  background: saveBtnStyle[saveState].bg,
                  border:     `1px solid ${saveBtnStyle[saveState].border}`,
                  color:      saveBtnStyle[saveState].color,
                  cursor: saveState === "saving" || saveState === "saved" ? "default" : "pointer",
                  transition: "all 200ms",
                }}
              >
                {saveBtnStyle[saveState].label}
              </button>
            )}

            {saveState === "saved" && !canSave && (
              <div style={{ marginTop: 12, padding: "10px 0", borderRadius: 10, fontWeight: 700, fontSize: 13, background: "rgba(0,255,136,0.12)", border: "1px solid rgba(0,255,136,0.30)", color: "#00ff88", textAlign: "center" }}>
                ✓ Saved
              </div>
            )}

            {saveState === "error" && saveError && (
              <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.22)", fontSize: 11, color: "#ff9090", lineHeight: 1.5 }}>
                <strong>Error:</strong> {saveError}
              </div>
            )}
          </div>

          {/* Impact feed */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, padding: 16, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Impact Feed</span>
              {feed.length > 0 && <span style={{ fontWeight: 600, color: "var(--accent)", fontSize: 11 }}>{feed.length}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 340, overflowY: "auto" }}>
              {feed.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "20px 0", opacity: 0.7 }}>No impacts yet</div>
              ) : feed.map((h, i) => (
                <div
                  key={h.key}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "5px 8px", borderRadius: 8,
                    background: i === 0 ? "rgba(180,0,255,0.08)" : "rgba(255,255,255,0.02)",
                    border: i === 0 ? "1px solid rgba(180,0,255,0.20)" : "1px solid transparent",
                    fontSize: 12,
                    animation: i === 0 ? "tsImpactIn 0.18s ease" : "none",
                  }}
                >
                  <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11 }}>
                    R{String(h.row).padStart(2, "0")} C{String(h.col).padStart(2, "0")}
                  </span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: mvToColor(h.mv) }}>
                    {(h.mv / 1000).toFixed(3)}
                    <span style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)", marginLeft: 2 }}>V</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Native BLE device picker sheet ──────────────────────────────── */}
      {pickerOpen && (
        <BlePickerSheet
          devices={pickerDevices}
          scanning={pickerScanning}
          serviceUuid={NUS_SERVICE_UUID}
          onSelect={d => closePicker(d)}
          onCancel={() => closePicker(null)}
        />
      )}

      <style>{`
        @keyframes tsSheetUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .ts-ses-layout {
          display: grid;
          grid-template-columns: 300px minmax(300px, 1fr) 260px;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 1000px) {
          .ts-ses-layout {
            grid-template-columns: 300px 1fr;
          }
          .ts-ses-layout > :nth-child(3) {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 680px) {
          .ts-ses-layout {
            grid-template-columns: 1fr;
          }
        }

        /* ── Ripple animations (identical to hitSimulator) ── */
        @keyframes tsCorePulse {
          0%   { opacity: 1;   transform: scale(1); }
          60%  { opacity: 0.7; transform: scale(1.6); }
          100% { opacity: 0;   transform: scale(0.5); }
        }
        @keyframes tsRipple {
          0%   { opacity: 0.9; transform: translate(-50%,-50%) scale(0.5); }
          100% { opacity: 0;   transform: translate(-50%,-50%) scale(4.5); }
        }
        @keyframes tsPulseWait {
          0%,100% { opacity: 0.4; transform: scale(1); }
          50%     { opacity: 1;   transform: scale(1.15); }
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
        @keyframes tsSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes tsBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.28; }
        }
        @keyframes tsImpactIn {
          0%   { opacity: 0; transform: translateX(-8px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes tsStartPulse {
          0%, 100% { opacity: 1;    transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.96); }
        }

        /* ── Bag wrap — mirrors ts-sim-bagWrap exactly ── */
        .ts-ses-bagWrap {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          backdrop-filter: blur(12px);
          aspect-ratio: 0.72;
          user-select: none;
        }

        /* ── Cells — mirrors ts-sim-cell ── */
        .ts-ses-cell {
          border: 1px solid rgba(255,255,255,0.12);
        }
        :root[data-theme="light"] .ts-ses-cell {
          border-color: rgba(0,0,0,0.12);
        }

        /* ── Scrollbar ── */

      `}</style>
    </div>
  );
}