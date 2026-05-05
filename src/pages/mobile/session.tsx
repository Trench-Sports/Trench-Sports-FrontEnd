// src/pages/mobile/session.tsx
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { initTheme } from "../../lib/themeManager";
import { useSignalAudio } from "../../hooks/signalAudio";
import type { ZoneTarget, ZoneRow, ZoneCol } from "../../hooks/signalAudio";
import {
  connectToAdapter,
  disconnect as adapterDisconnect,
  startNotifications as adapterStartNotifications,
  writeUtf8,
  getBleConfig,
  isNativeApp,
  getBluetoothDiagnostics,
  type AdapterConnection,
} from "../../bluetooth/adapter";
import {
  scanForDevices,
  stopScan,
  connectToDeviceNative,
  classifyDevice,
  getBleNamePrefixes,
  isUserCancel,
  type ScannedDevice,
} from "../../bluetooth/adapter_native";

import { ModeRolodex } from "../../components/modeRolodex";

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
// SCAN_PERIOD_MS is now per-device — derived from the hello packet and stored in
// deviceInfoRef so handleNotify always reads the correct value without closure staleness.
// Model II  @ 80 MHz  → 37 ms (~27 Hz)
// Model III @ 160 MHz → 8 ms  (~120 Hz)
// Used as a duration floor for single-frame events where t_start == t_end.
// The constant below is a safe fallback before a hello has been received.
const SCAN_PERIOD_MS_DEFAULT = 37;
const VOLUME_WINDOW_MS  = 5000;   // 5-second recording window for volume mode
const SESSION_MAX_MS    = 30_000; // hard cap — session auto-stops after 30 s
const SESSION_WARN_MS   = 25_000; // warning fires 5 s before the cap
const CHUNK_RE    = /^C(\d{2})\/(\d{2}):/;

// ─── Mode config (mirrors hitSimulator) ──────────────────────────────────────
// Defined in a separate file to avoid a circular dependency with modeRolodex.tsx.
export { MODES, MODE_META } from "../../lib/sessionModes";
export type { SessionMode } from "../../lib/sessionModes";
import { MODES, MODE_META, type SessionMode } from "../../lib/sessionModes";

// ─── Target mode — zone mapping ───────────────────────────────────────────────
// Grid is 12 rows × 8 cols (1-indexed from ESP32).
// Rows:    top = 9–12, middle = 5–8, bottom = 1–4
// Columns: left = 7–8, center = 3–6, right = 1–2  (C8 renders leftmost, C1 rightmost)
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

// ─── Wave 1 #1 — ArcTimer ────────────────────────────────────────────────────
// Self-contained SVG countdown. Reads the same elapsedMs that drives the
// existing 5s warning banner. Color thresholds are derived from SESSION_WARN_MS
// (amber) and SESSION_MAX_MS - 2s (red). Replaces the text-only "{X}s left"
// banner that previously lived in the bag's top-right corner.
function ArcTimer({
  elapsedMs,
  maxMs = SESSION_MAX_MS,
  warnMs = SESSION_WARN_MS,
  size = 64,
}: {
  elapsedMs: number;
  maxMs?: number;
  warnMs?: number;
  size?: number;
}) {
  const stroke = 5;
  const r = (size / 2) - stroke - 1;       // padding so the stroke isn't clipped
  const c = 2 * Math.PI * r;
  const ratio = Math.min(Math.max(elapsedMs / maxMs, 0), 1);
  const offset = c * ratio;                 // depletes clockwise from 0 → c
  const dangerMs = maxMs - 2_000;            // last 2 s → red
  const color =
    elapsedMs >= dangerMs ? "#ef4444"
    : elapsedMs >= warnMs ? "#f59e0b"
    : "#22c55e";
  const secs = Math.max(0, Math.ceil((maxMs - elapsedMs) / 1000));
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="timer"
      aria-label={`${secs} seconds remaining`}
      style={{
        filter: `drop-shadow(0 0 8px ${color}66)`,
        transition: "filter 300ms",
      }}
    >
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="rgba(0,0,0,0.45)"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{
          transition: "stroke-dashoffset 200ms linear, stroke 300ms ease",
        }}
      />
      {/* Countdown text */}
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: Math.round(size * 0.32),
          fontWeight: 800,
          fill: color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
          transition: "fill 300ms",
        }}
      >
        {secs}
      </text>
    </svg>
  );
}

// ─── Wave 1 #2 — useBagModeSwipe ─────────────────────────────────────────────
// Horizontal swipe on the bag wrap cycles modes (only when !sessionActive).
// Wraps around at the ends. Uses cubic-bezier(.25,.46,.45,.94) on the mode
// indicator transitions for the iOS-spring feel without a library.
//   - swipe left  → next mode
//   - swipe right → previous mode
// Tap-throughs (e.g. the "Tap to Start" overlay onClick) are preserved because
// browsers suppress the synthesized click after a touchmove > ~10 px. We also
// only act on swipes that exceeded the distance/velocity threshold.
function useBagModeSwipe(
  mode: SessionMode,
  setMode: (m: SessionMode) => void,
  enabled: boolean,
) {
  const x0 = useRef(0);
  const y0 = useRef(0);
  const t0 = useRef(0);
  const swipedRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const t = e.touches[0];
    x0.current = t.clientX;
    y0.current = t.clientY;
    t0.current = Date.now();
    swipedRef.current = false;
  }, [enabled]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0.current;
    const dy = t.clientY - y0.current;
    const dt = Date.now() - t0.current;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.4;
    const fast = dt < 280 && Math.abs(dx) > 30;
    const far = Math.abs(dx) > 60;
    if (!horizontal || (!fast && !far)) return;

    const idx = MODES.indexOf(mode);
    if (idx < 0) return;
    const next = dx < 0
      ? MODES[(idx + 1) % MODES.length]
      : MODES[(idx - 1 + MODES.length) % MODES.length];
    if (next !== mode) {
      setMode(next);
      swipedRef.current = true;
      // Suppress the synthesized click that would otherwise start the session
      // when the swipe terminates on top of the "Tap to Start" overlay.
      e.preventDefault();
    }
  }, [enabled, mode, setMode]);

  // If the touch turned into a swipe, eat the first click that fires after.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (swipedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      swipedRef.current = false;
    }
  }, []);

  return { onTouchStart, onTouchEnd, onClickCapture };
}

// ─── Wave 2 #6 — useDismissSwipe ─────────────────────────────────────────────
// Vertical-down swipe gesture for dismissing a card. The card translates +
// fades in real time as the user drags; on release past `threshold` px the
// `onDismiss` callback fires (e.g. discardSession). Below threshold it springs
// back. `disabled` halts the gesture without unmounting the handlers.
function useDismissSwipe(
  onDismiss: () => void,
  opts: { threshold?: number; disabled?: boolean } = {},
) {
  const { threshold = 80, disabled = false } = opts;
  const y0 = useRef(0);
  const [drag, setDrag] = useState(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    y0.current = e.touches[0].clientY;
    setDrag(0);
  }, [disabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const dy = e.touches[0].clientY - y0.current;
    // Only react to downward drags. Upward stays at 0.
    if (dy > 0) setDrag(dy);
  }, [disabled]);

  const onTouchEnd = useCallback(() => {
    if (disabled) return;
    if (drag > threshold) {
      // Animate out the rest of the way before discarding so the user sees
      // the card leave the screen rather than blink away.
      setDrag(window.innerHeight);
      // Tiny delay so the transition has a frame to start.
      setTimeout(() => {
        onDismiss();
        setDrag(0);
      }, 180);
    } else {
      setDrag(0);
    }
  }, [disabled, drag, threshold, onDismiss]);

  // Visual style — apply via spread on the wrapper. We use `transition: none`
  // while actively dragging so it tracks the finger 1:1, then snap back via
  // a transition when released. `touch-action: none` means the browser won't
  // scroll the page when the user starts a drag here — the gesture is ours.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const style: React.CSSProperties = {
    transform: drag ? `translateY(${drag}px)` : "none",
    opacity: drag ? Math.max(0, 1 - drag / 220) : 1,
    transition: drag === 0 || drag >= viewportH
      ? "transform 280ms cubic-bezier(.25,.46,.45,.94), opacity 280ms ease"
      : "none",
    touchAction: "none",
    willChange: "transform, opacity",
    position: "relative", // anchor for the absolute hint chip
  };

  return { onTouchStart, onTouchMove, onTouchEnd, style, drag };
}

// ─── Wave 3 #1 — AthleteRow ──────────────────────────────────────────────────
// Roster row with always-visible "Add first" / "Add last" inline buttons:
//   purple "Add first" → unshift onto queue
//   black  "Add last"  → push onto queue
// Tap on the row body selects the athlete (or deselects when already selected).
function AthleteRow({
  athlete,
  selected,
  inQueue,
  isDark,
  onSelect,
  onAddFirst,
  onAddLast,
}: {
  athlete: { id: string; first_name: string; last_name: string; position: string | null; sport: string | null };
  selected: boolean;
  inQueue: any;
  isDark: boolean;
  onSelect: () => void;
  onAddFirst: () => any;
  onAddLast: () => any;
}) {
  const initials = `${athlete.first_name[0] ?? ""}${athlete.last_name[0] ?? ""}`.toUpperCase();

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 11,
        overflow: "hidden",
        height: 58,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={onSelect}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 11px",
          cursor: "pointer",
          border: selected ? "1px solid rgba(180,0,255,0.50)" : isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.09)",
          background: selected ? (isDark ? "rgba(180,0,255,0.10)" : "rgba(180,0,255,0.07)") : isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
          borderRadius: 11,
          transition: "background 140ms ease, border-color 140ms ease",
          userSelect: "none",
          WebkitUserSelect: "none",
          boxSizing: "border-box",
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800,
          background: selected ? "linear-gradient(135deg, rgba(180,0,255,0.45), rgba(180,0,255,0.20))" : "linear-gradient(135deg, rgba(180,0,255,0.18), rgba(180,0,255,0.08))",
          border: selected ? "1px solid rgba(180,0,255,0.55)" : "1px solid rgba(180,0,255,0.22)",
          color: selected ? "rgba(220,150,255,1)" : "rgba(200,120,255,0.85)",
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {athlete.first_name} {athlete.last_name}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {[athlete.position, athlete.sport].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        {/* ── Queue action buttons — always visible inline ── */}
        {inQueue ? (
          <div title="In queue" style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
            padding: "2px 6px", borderRadius: 999,
            background: "rgba(180,0,255,0.15)", color: "rgba(220,150,255,1)",
            border: "1px solid rgba(180,0,255,0.35)", flexShrink: 0,
          }}>QUEUED</div>
        ) : (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddFirst(); }}
              title="Add to front of queue"
              aria-label={`Add ${athlete.first_name} ${athlete.last_name} to front of queue`}
              style={{
                height: 28, borderRadius: 7, border: "none",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 4, padding: "0 8px",
                background: "linear-gradient(135deg, rgba(180,0,255,0.85), rgba(140,0,210,0.85))",
                color: "#fff",
                flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 13V4M8 4l-4 4M8 4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 1.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddLast(); }}
              title="Add to end of queue"
              aria-label={`Add ${athlete.first_name} ${athlete.last_name} to end of queue`}
              style={{
                height: 28, borderRadius: 7,
                border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.14)",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 4, padding: "0 8px",
                background: isDark
                  ? "linear-gradient(135deg, rgba(40,40,40,0.95), rgba(10,10,10,0.95))"
                  : "linear-gradient(135deg, rgba(245,245,245,0.95), rgba(225,225,225,0.95))",
                color: isDark ? "#fff" : "#222",
                flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v9M8 12l-4-4M8 12l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 14.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {selected && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, boxShadow: "0 0 6px 2px rgba(180,0,255,0.55)" }} />}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.35, flexShrink: 0 }}>
          <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Wave 3 #1 — QueueRow ────────────────────────────────────────────────────
// Queue list row with a drag handle on the left and a remove button on the
// right. Reorder is driven by the parent: it tracks where the picked-up row
// is hovering (overIdx vs fromIdx) and tells each row how much to translate
// via `dragTranslateY`. Three render states matter here:
//
//   isDragging       — this is the picked-up row. translateY tracks the
//                      finger 1:1 (no transition), and a lift effect is
//                      composed on top: gentle scale-up + tilt + drop
//                      shadow + raised z-index.
//   flipFromY != 0   — this row was *just released*. We render it at the
//                      compensating flip transform with no transition for
//                      one frame, then the parent clears flipFromY and the
//                      row glides into its new slot via the standard
//                      transform transition.
//   neighbor offset  — non-dragged rows that need to make space. They
//                      render with translateY(±rowHeight), animated by the
//                      same cubic-bezier transition so they slide rather
//                      than snap.
function QueueRow({
  athlete,
  position,            // 0 = "Now", 1+ = numbered
  isDragging,
  dragTranslateY,
  flipFromY,
  handleProps,
  isDark,
  onRemove,
}: {
  athlete: { id: string; first_name: string; last_name: string; position: string | null; sport: string | null };
  position: number;
  isDragging: boolean;
  dragTranslateY: number;
  flipFromY: number;
  handleProps: any;
  isDark: boolean;
  onRemove: () => any;
}) {
  const initials = `${athlete.first_name[0] ?? ""}${athlete.last_name[0] ?? ""}`.toUpperCase();
  const isNow = position === 0;

  // The dragged row composes its translateY with a slight scale + tilt so
  // the row visibly "lifts off the page" while the finger moves it. The
  // tilt direction follows pointer travel for a touch of physicality, but
  // the magnitude stays small so it doesn't feel cartoonish.
  const tiltDeg = isDragging ? Math.max(-2, Math.min(2, dragTranslateY * 0.012)) : 0;
  const transform = isDragging
    ? `translate3d(0, ${dragTranslateY}px, 0) scale(1.025) rotate(${tiltDeg}deg)`
    : flipFromY !== 0
      ? `translate3d(0, ${flipFromY}px, 0)`
      : dragTranslateY !== 0
        ? `translate3d(0, ${dragTranslateY}px, 0)`
        : "none";

  // While actively dragging, transform must be transition-free (we want
  // 1:1 finger tracking); shadow + background can still ease in. The FLIP
  // frame also runs without a transform transition so the compensating
  // offset applies instantly. Everything else (neighbors making space,
  // post-release glide) uses the same cubic-bezier for visual consistency.
  const transition = isDragging
    ? "background 140ms ease, box-shadow 220ms ease, border-color 140ms ease"
    : flipFromY !== 0
      ? "none"
      : "transform 260ms cubic-bezier(.22,.61,.36,1), background 140ms ease, box-shadow 260ms ease, border-color 140ms ease";

  return (
    <div
      data-queue-id={athlete.id}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 11px",
        height: 58,
        flexShrink: 0,
        boxSizing: "border-box",
        borderRadius: 11,
        border: isDragging
          ? "1px solid rgba(180,0,255,0.45)"
          : isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.09)",
        background: isDragging
          ? (isDark ? "rgba(180,0,255,0.16)" : "rgba(180,0,255,0.10)")
          : isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
        boxShadow: isDragging
          ? isDark
            ? "0 18px 36px -8px rgba(0,0,0,0.70), 0 0 0 1px rgba(180,0,255,0.30)"
            : "0 8px 24px -4px rgba(0,0,0,0.18), 0 0 0 1px rgba(180,0,255,0.30)"
          : "none",
        transform,
        transition,
        position: "relative",
        zIndex: isDragging ? 20 : 1,
        willChange: isDragging ? "transform" : undefined,
        touchAction: "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Drag handle — dot grid (2 × 3 dots) */}
      <button
        type="button"
        {...handleProps}
        aria-label="Drag to reorder"
        style={{
          flexShrink: 0, width: 18, height: 26, padding: 0,
          background: "none", border: "none",
          cursor: isDragging ? "grabbing" : "grab",
          color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.30)", display: "flex", alignItems: "center", justifyContent: "center",
          touchAction: "none",
        }}
      >
        <svg width="12" height="18" viewBox="0 0 12 18" fill="none">
          {[3, 9, 15].map(y => (
            <g key={y}>
              <circle cx="3" cy={y} r="1.4" fill="currentColor" />
              <circle cx="9" cy={y} r="1.4" fill="currentColor" />
            </g>
          ))}
        </svg>
      </button>

      {/* Position pill: "Now" badge for index 0, dark numbered chip otherwise */}
      {isNow ? (
        <div style={{
          flexShrink: 0,
          fontSize: 10, fontWeight: 800, letterSpacing: "0.04em",
          padding: "3px 9px", borderRadius: 999,
          background: "rgba(180,0,255,0.18)",
          color: "rgba(220,150,255,1)",
          border: "1px solid rgba(180,0,255,0.45)",
        }}>Now</div>
      ) : (
        <div style={{
          flexShrink: 0,
          width: 22, height: 22, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800,
          color: isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.60)",
          background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
          border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.12)",
        }}>{position}</div>
      )}

      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800,
        background: "linear-gradient(135deg, rgba(180,0,255,0.18), rgba(180,0,255,0.08))",
        border: "1px solid rgba(180,0,255,0.22)",
        color: "rgba(200,120,255,0.85)",
      }}>{initials}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {athlete.first_name} {athlete.last_name}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
          {[athlete.position, athlete.sport].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${athlete.first_name} ${athlete.last_name} from queue`}
        style={{
          flexShrink: 0,
          background: "none", border: "none", cursor: "pointer",
          color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.40)",
          padding: 4, lineHeight: 1, fontSize: 14,
        }}
      >✕</button>
    </div>
  );
}

// ─── Wave 1 #3 — Skeleton ────────────────────────────────────────────────────
// Reusable shimmer primitive. Pairs with the @keyframes tsShimmer rule in the
// global <style> block at the bottom of this file.
function Skeleton({
  w = "100%",
  h = 14,
  r = 6,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: "rgba(255,255,255,0.06)",
        animation: "tsShimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
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

// Identity packet sent by ESP32 immediately after BLE connect.
// hw / mode are populated from the hello packet and used to branch
// between Model II (single-frame) and Model III (batch) data paths.
type DeviceInfo = {
  id:           string;
  fw:           string;
  hw:           string;        // "II" | "III"
  rows:         number;
  cols:         number;
  mode:         string;        // "batch" (Model III) | "single" (Model II)
  scanPeriodMs: number;        // 8 ms (Model III @ 120 Hz) | 37 ms (Model II @ 27 Hz)
  samplingHz:   number;        // 120 (Model III) | 25 (Model II)
} | null;

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
  deviceModel?:   string;
  samplingHz?:    number;
  scanPeriodMs?:  number;   // duration floor for single-frame events — 8 (Model III) | 37 (Model II)
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
  tgtBestMs?:            number | null;   // best RT across all attempts
  tgtBestCorrectMs?:     number | null;   // best RT for correct-zone hits only
  // physical device
  deviceId?:    string;
}) {
  if (!supabase) throw new Error("Supabase client not initialised");

  const {
    sessionId, programId, athleteId, coreTeamId,
    createdBy, frames, startedAtMs, endedAtMs, mode = "power",
    deviceModel = "TSII", samplingHz = 25, scanPeriodMs = SCAN_PERIOD_MS_DEFAULT,
    rxBestMs = null, rxAvgMs = null, rxAttempts = 0,
    accHitsCount = 0, accScoreSum = 0,
    tgtAttempts = 0, tgtCorrectHits = 0, tgtCorrectSumMs = 0, tgtBestMs = null, tgtBestCorrectMs = null,
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
    // scanPeriodMs — the contact lasted at most one scan cycle (8 ms on Model III,
    // 37 ms on Model II).
    const rawDuration = tEnd - tStart;
    const duration    = rawDuration > 0 ? rawDuration : scanPeriodMs;

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
  // Derive attempt counts from frames — single source of truth, immune to
  // stale-state issues at save time. Only frames with a target_zone stamped
  // count as attempts; zone_correct === true marks a correct hit.
  const tgtRxAll     = frames.filter(f => f.reaction_time_ms !== null && f.target_zone !== null)
                             .map(f => f.reaction_time_ms as number);
  const tgtRxCorrect = frames.filter(f => f.reaction_time_ms !== null && f.zone_correct === true)
                             .map(f => f.reaction_time_ms as number);
  // Frame-derived counts are always consistent with the stored events
  const tgtAttemptsFromFrames  = frames.filter(f => f.target_zone !== null).length;
  const tgtCorrectFromFrames   = frames.filter(f => f.zone_correct === true).length;

  const targetQuality = mode === "target"
    ? {
        // Use frame-derived counts — not the live-ref counters — as the authoritative
        // values written to the DB. They match the event rows exactly.
        attempts:              tgtAttemptsFromFrames,
        correct_hits:          tgtCorrectFromFrames,
        target_accuracy_pct:   tgtAttemptsFromFrames > 0
                                 ? +(tgtCorrectFromFrames / tgtAttemptsFromFrames * 100).toFixed(1)
                                 : null,
        // best RT across all attempts (tgtBestAllMsRef.current passed in at call site)
        best_reaction_ms:         tgtBestMs,
        // best RT for correct-zone hits only — the more meaningful competitive benchmark
        best_reaction_ms_correct: tgtBestCorrectMs,
        // Correct-only avg is more informative: measures decision+execution speed on good hits
        avg_reaction_ms_correct: tgtCorrectFromFrames > 0
                                   ? +(tgtCorrectSumMs / tgtCorrectFromFrames).toFixed(0)
                                   : null,
        // All-attempts avg RT
        avg_reaction_ms_all: tgtAttemptsFromFrames > 0
                               ? +(tgtRxAll.reduce((a, b) => a + b, 0) / tgtRxAll.length).toFixed(0)
                               : null,
        // Full distribution stats for both splits
        reaction_time_ms_all:     tgtRxAll.length     ? statSummary(tgtRxAll)     : null,
        reaction_time_ms_correct: tgtRxCorrect.length ? statSummary(tgtRxCorrect) : null,
      }
    : null;

  // Volume stats — per-window breakdown with SI fatigue tracking
  const volumeQuality = (() => {
    if (mode !== "volume") return null;

    // Group frames by window index (only frames inside an open window)
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
        // Sort by sequence so intra-window slope is meaningful
        const sorted = [...wFrames].sort((a, b) => (a.vol_hit_seq ?? 0) - (b.vol_hit_seq ?? 0));
        // IEI-free SI — pure force component, no cadence bias within a burst window
        const siPerHit = sorted.map(f => {
          const peakMv = f.hits.reduce((m, h) => Math.max(m, h[5]), 0);
          return strengthIndex(null, peakMv);
        });
        // IEI between consecutive hits in this window (wall-clock ms)
        const ieiWithin = sorted.slice(1).map((f, i) => f.epoch_ms - sorted[i].epoch_ms);

        const avgSi  = siPerHit.length
          ? +(siPerHit.reduce((a, b) => a + b, 0) / siPerHit.length).toFixed(1)
          : null;
        const peakSi = siPerHit.length ? Math.max(...siPerHit) : null;
        const minSi  = siPerHit.length ? Math.min(...siPerHit) : null;

        // Intra-window SI slope via least-squares linear regression over hit sequence.
        // More robust than (last - first): handles noisy mid-window readings.
        let siSlopeIntra: number | null = null;
        if (siPerHit.length >= 2) {
          const n    = siPerHit.length;
          const xBar = (n - 1) / 2;
          const yBar = siPerHit.reduce((a, b) => a + b, 0) / n;
          const ssXX = siPerHit.map((_, i) => (i - xBar) ** 2).reduce((a, b) => a + b, 0);
          const ssXY = siPerHit.map((v, i) => (i - xBar) * (v - yBar)).reduce((a, b) => a + b, 0);
          siSlopeIntra = ssXX > 0 ? +(ssXY / ssXX).toFixed(1) : 0;
        }

        return {
          window_idx:    idx,
          hits:          sorted.length,
          avg_si:        avgSi,
          peak_si:       peakSi,
          min_si:        minSi,
          si_values:     siPerHit,       // per-hit SI in vol_hit_seq order
          si_slope:      siSlopeIntra,   // SI change per hit within this window
          avg_iei_ms:    ieiWithin.length
            ? +(ieiWithin.reduce((a, b) => a + b, 0) / ieiWithin.length).toFixed(0)
            : null,
          iei_ms_values: ieiWithin,
        };
      });

    // ── Global SI fatigue slope (across windows) ──────────────────────────────
    // Least-squares linear regression over window avg_si values ordered by window_idx.
    // Uses all windows, not just first-vs-last, so a single outlier window won't
    // skew the reading. Unit: SI points per window (negative = fatigue).
    const windowAvgSis = windows.map(w => w.avg_si).filter((v): v is number => v !== null);
    let globalSiSlope: number | null = null;
    if (windowAvgSis.length >= 2) {
      const n    = windowAvgSis.length;
      const xBar = (n - 1) / 2;
      const yBar = windowAvgSis.reduce((a, b) => a + b, 0) / n;
      const ssXX = windowAvgSis.map((_, i) => (i - xBar) ** 2).reduce((a, b) => a + b, 0);
      const ssXY = windowAvgSis.map((v, i) => (i - xBar) * (v - yBar)).reduce((a, b) => a + b, 0);
      globalSiSlope = ssXX > 0 ? +(ssXY / ssXX).toFixed(1) : 0;
    }

    // Classify trend — threshold of ±10 SI/window separates real fatigue/building
    // from noise. Below that, session-to-session variance dominates.
    const SI_TREND_THRESHOLD = 10;
    const siTrend: "fatigue" | "building" | "stable" =
      globalSiSlope === null              ? "stable"
      : globalSiSlope <= -SI_TREND_THRESHOLD ? "fatigue"
      : globalSiSlope >=  SI_TREND_THRESHOLD ? "building"
      : "stable";

    // Session-level SI values in chronological hit order for dashboard charting
    const allHitSiValues = frames
      .filter(f => f.vol_window_idx !== null)
      .map(f => {
        const peakMv = f.hits.reduce((m, h) => Math.max(m, h[5]), 0);
        return strengthIndex(null, peakMv);
      });

    return {
      windows,
      best_window_hits:  Math.max(...windows.map(w => w.hits)),
      avg_window_hits:   +(windows.reduce((s, w) => s + w.hits, 0) / windows.length).toFixed(1),
      total_windows:     windows.length,
      si_fatigue_slope:  globalSiSlope,   // SI pts/window via linear regression; negative = fatigue
      si_trend:          siTrend,         // "fatigue" | "building" | "stable"
      si_all_values:     allHitSiValues,  // per-hit SI chronological for charting
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

  // Portal into document.body so the sheet escapes any CSS transform on a
  // parent (e.g. the swipe deck panel). Without this, `position: fixed` is
  // relative to the transformed ancestor instead of the viewport, which pushes
  // the sheet to the bottom-left corner — the same fix used by ModeRolodex.
  return createPortal(
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
    </div>,
    document.body,
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function Session() {
  const navigate = useNavigate();
  const { unlock: unlockAudio, playSignal, playVolumeEnd, playZoneCue, closeAudio } = useSignalAudio();

  // ── Theme ────────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState<boolean>(() => initTheme() === "dark");
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute("data-theme") !== "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

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

  // ── Wave 3 #1 — Roster / Queue ──────────────────────────────────────────────
  // The roster is the searchable source list; the queue is a coach-curated
  // "up next" line. unshift = "Add first" (front), push = "Add last" (back).
  // splice handles drop-reorder.
  type AthleteView = "roster" | "queue";
  const [athleteView, setAthleteView] = useState<AthleteView>("roster");
  const [queue,       setQueue]       = useState<Athlete[]>([]);

  // ── Wave 3 #1 — Queue drag-to-reorder state ────────────────────────────────
  // dragInfo holds everything we need during an active drag:
  //   fromIdx       – the array index where the row was when picked up
  //   overIdx       – the array slot the finger is currently hovering over
  //                   (this is what the row would occupy if dropped now)
  //   startPointerY – pointer Y at the moment of pickup
  //   pointerY      – current pointer Y (drives the lift translateY)
  //   rowHeight     – measured at pickup, used to slide neighbors by 1 row
  //   athleteId     – stable id of the picked-up athlete (used by the
  //                   FLIP-release pass to find the row after the array
  //                   reorders, since indexes shift)
  // The array is NOT reordered during the drag — neighbors slide via CSS-
  // transitioned transforms, and the splice happens once on release. This is
  // what makes the gesture feel like picking the row up rather than swapping
  // chunks of the list around.
  type QueueDragInfo = {
    fromIdx: number;
    overIdx: number;
    startPointerY: number;
    pointerY: number;
    rowHeight: number;
    athleteId: string;
  };
  const [dragInfo, setDragInfo] = useState<QueueDragInfo | null>(null);

  // After release, the dragged row's natural DOM position has changed (the
  // queue was just spliced) but the user's finger left it visually somewhere
  // else. We capture that visual delta as a one-frame FLIP transform and then
  // clear it on the next animation frame, so CSS transitions the row from its
  // last finger position into its new slot rather than snapping.
  const [flipRelease, setFlipRelease] = useState<{ athleteId: string; deltaY: number } | null>(null);

  // Queue mutators — kept tiny so the row callbacks stay readable.
  const queueAddFirst = useCallback((a: Athlete) => {
    setQueue(q => {
      if (q.some(x => x.id === a.id)) return q;
      // Auto-switch to queue view when first item is added so the user
      // immediately sees the queue they just started building.
      if (q.length === 0) {
        setAthleteView("queue");
        // Auto-select the first queued athlete so the session can start immediately.
        setSelectedAthlete(a);
      }
      return [a, ...q];
    });
  }, []);
  const queueAddLast = useCallback((a: Athlete) => {
    setQueue(q => {
      if (q.some(x => x.id === a.id)) return q;
      if (q.length === 0) {
        setAthleteView("queue");
        // Auto-select the first queued athlete so the session can start immediately.
        setSelectedAthlete(a);
      }
      return [...q, a];
    });
  }, []);
  const queueRemove = useCallback((id: string) => {
    setQueue(q => {
      const next = q.filter(x => x.id !== id);
      // If the removed athlete was the currently selected one, advance to the
      // new head of the queue (or clear selection if the queue is now empty).
      setSelectedAthlete(prev => {
        if (prev?.id !== id) return prev;
        return next[0] ?? null;
      });
      return next;
    });
  }, []);
  const queueClear = useCallback(() => {
    setQueue([]);
    // Clear selection when the whole queue is wiped.
    setSelectedAthlete(null);
  }, []);
  const queueMove = useCallback((from: number, to: number) => {
    setQueue(q => {
      if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return q;
      const next = q.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // Queue drag-to-reorder. We capture the pointer on the dot-grid handle so
  // every subsequent move/up event re-fires on the same button. queueListRef
  // is the scroll container. naturalRectsRef caches each row's bounding rect
  // captured at pickup time, before any drag transforms are applied — these
  // are the slot positions we hit-test the pointer against during the move,
  // so the slot mapping stays stable even as visible rows slide around.
  const queueListRef     = useRef<HTMLDivElement | null>(null);
  const naturalRectsRef  = useRef<{ top: number; bottom: number }[]>([]);
  // We need the *current* queue inside the pointerDown closure to read the
  // picked athlete's id, but we don't want to invalidate the callback every
  // time the queue changes (that would re-bind handlers mid-drag). A ref
  // keeps the closure stable while always pointing at the latest array.
  const queueRef = useRef<Athlete[]>(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const queueHandlePropsFor = useCallback((idx: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const list = queueListRef.current;
      if (!list) return;

      // Snapshot every row's natural top/bottom *before* we apply any drag
      // transforms — these are the slot lanes the pointer hit-tests against.
      const rows = list.querySelectorAll('[data-queue-id]');
      const rects: { top: number; bottom: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = (rows[i] as HTMLElement).getBoundingClientRect();
        rects.push({ top: r.top, bottom: r.bottom });
      }
      naturalRectsRef.current = rects;

      // Distance from one slot's top to the next, used to slide neighbors
      // by exactly one row when they need to make space. Falls back to the
      // first row's height when there's only one row (no drag possible
      // anyway, but keeps the math safe).
      const rowHeight = rects.length > 1
        ? rects[1].top - rects[0].top
        : (rects[0] ? rects[0].bottom - rects[0].top : 50);

      const athleteId = queueRef.current[idx]?.id ?? "";

      setDragInfo({
        fromIdx: idx,
        overIdx: idx,
        startPointerY: e.clientY,
        pointerY: e.clientY,
        rowHeight,
        athleteId,
      });

      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
    },
    onPointerMove: (e: React.PointerEvent) => {
      setDragInfo(prev => {
        if (!prev) return prev;
        const rects = naturalRectsRef.current;
        const y = e.clientY;
        let overIdx = prev.fromIdx;

        if (rects.length > 0) {
          if (y < rects[0].top) {
            overIdx = 0;
          } else if (y >= rects[rects.length - 1].bottom) {
            overIdx = rects.length - 1;
          } else {
            for (let i = 0; i < rects.length; i++) {
              if (y >= rects[i].top && y < rects[i].bottom) {
                overIdx = i;
                break;
              }
            }
          }
        }

        // Bail out of state-change churn if nothing about the drag changed.
        if (prev.pointerY === y && prev.overIdx === overIdx) return prev;
        return { ...prev, pointerY: y, overIdx };
      });
    },
    onPointerUp: () => {
      setDragInfo(prev => {
        if (!prev) return null;
        const totalDelta = prev.pointerY - prev.startPointerY;
        const slotsMoved = prev.overIdx - prev.fromIdx;

        if (slotsMoved !== 0) {
          queueMove(prev.fromIdx, prev.overIdx);
        }

        // FLIP delta — after the array reorder, the row's natural DOM top
        // jumps by `slotsMoved * rowHeight`. To avoid a visible snap we
        // start the post-release frame with a transform that keeps the row
        // visually in the same place the finger left it, then transition
        // it to translateY(0) on the next frame.
        const flipDelta = totalDelta - slotsMoved * prev.rowHeight;
        if (Math.abs(flipDelta) > 0.5 && prev.athleteId) {
          setFlipRelease({ athleteId: prev.athleteId, deltaY: flipDelta });
        }

        return null;
      });
    },
    onPointerCancel: () => {
      setDragInfo(null);
    },
  }), [queueMove]);

  // FLIP step 2 — clear the compensating transform on the next animation
  // frame so the CSS transition kicks in and the row glides to its new slot.
  useLayoutEffect(() => {
    if (!flipRelease) return;
    const id = requestAnimationFrame(() => setFlipRelease(null));
    return () => cancelAnimationFrame(id);
  }, [flipRelease]);

  const queueIds = queue.map(q => q.id);
  const isInQueue = useCallback((id: string) => queueIds.includes(id), [queueIds]);

  // Snap back to the Roster tab whenever the queue drains — avoids leaving the
  // user staring at an empty-state panel after they hit "Clear all".
  useEffect(() => {
    if (queue.length === 0 && athleteView === "queue") setAthleteView("roster");
  }, [queue.length, athleteView]);

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
  const [latestFwFile, setLatestFwFile] = useState<string | null>(null); // model-specific path from manifest

  const connRef      = useRef<AdapterConnection | null>(null);  // active adapter connection
  const assemblerRef = useRef(new ChunkAssembler());
  // Mirrors deviceInfo state — readable inside handleNotify without closure staleness.
  // Updated synchronously in the hello handler before any data frames arrive.
  const deviceInfoRef = useRef<DeviceInfo>(null);

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
  // Fetches /firmware/manifest.json and looks up the entry for this device's hw
  // model (II / III) so each model can be updated independently.
  // Silent on network failure — OTA is optional, never blocks the session flow.
  useEffect(() => {
    if (!deviceInfo) {
      setOtaState("idle");
      setOtaProgress(0);
      setOtaError(null);
      setLatestFw(null);
      setLatestFwFile(null);
      return;
    }
    fetch("/firmware/manifest.json")
      .then(r => r.json())
      .then((m: { models: Record<string, { version: string; file: string }> }) => {
        const entry = m.models?.[deviceInfo.hw];
        if (!entry) {
          console.warn(`[OTA] no manifest entry for hw="${deviceInfo.hw}"`);
          return;
        }
        setLatestFw(entry.version);
        setLatestFwFile(`/${entry.file}`);
        if (fwIsOutdated(deviceInfo.fw, entry.version)) {
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
  const [sessionMode,    setSessionMode]    = useState<SessionMode>("power");
  const [sessionActive,  setSessionActive]  = useState(false);
  // sessionWarning is still set internally (line ~1924) to gate audio cues — the
  // visual banner it used to drive was replaced by <ArcTimer/> in the bag corner.
  const [sessionWarning, setSessionWarning] = useState(false); // true during final 5 s
  const [saveState,      setSaveState]      = useState<SaveState>("idle");
  const [saveError,      setSaveError]      = useState<string | null>(null);
  const [elapsedMs,      setElapsedMs]      = useState(0);
  const startTimeRef        = useRef<number | null>(null);
  const sessionIdRef        = useRef("");
  const sessionWarningFired = useRef(false); // prevents double-firing the 5 s cue

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
  const [tgtBestMs,   setTgtBestMs]   = useState<number | null>(null);       // best RT display (all attempts)
  const [tgtAvgMs,    setTgtAvgMs]    = useState<number | null>(null);
  const tgtPhaseRef    = useRef<string>("idle");
  const tgtZoneRef     = useRef<ZoneTarget | null>(null);
  const tgtSignalAt    = useRef<number | null>(null);
  const tgtTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tgtSumMs       = useRef(0);
  const tgtCorrectSumMs  = useRef(0);    // reaction time sum for correct-zone hits only
  const tgtAttemptsRef   = useRef(0);
  const tgtHitsRef       = useRef(0);    // mirrors tgtHits state — always current at save time
  // Best RT refs — tracked separately from state so saveSession always reads
  // the latest value (setState is async and can be one attempt stale at save time)
  const tgtBestAllMsRef     = useRef<number | null>(null);   // best RT across all attempts
  const tgtBestCorrectMsRef = useRef<number | null>(null);   // best RT for correct-zone hits only

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
  const programIdRef    = useRef<string | null>(null);  // stable ref — readable inside handleNotify (memoised [])
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
  useEffect(() => { programIdRef.current    = programId;    }, [programId]);
  useEffect(() => { sessionModeRef.current = sessionMode; }, [sessionMode]);
  useEffect(() => { rxPhaseRef.current = rxPhase; }, [rxPhase]);
  useEffect(() => { rxAttemptsRef.current = rxAttempts; }, [rxAttempts]);
  useEffect(() => { volPhaseRef.current = volPhase; }, [volPhase]);
  useEffect(() => { volAttemptsRef.current = volAttempts; }, [volAttempts]);
  useEffect(() => { tgtPhaseRef.current = tgtPhase; }, [tgtPhase]);
  // tgtAttemptsRef and tgtHitsRef are updated directly in the hit handler — no useEffect sync needed

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
    // Alert the athlete that the 5-second window is over
    playVolumeEnd();

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
  }, [playVolumeEnd]);

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

  // Timer — also drives the 30 s hard cap and the 5 s warning cue
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
      setElapsedMs(elapsed);

      // 5-second warning (fires once at 25 s)
      if (elapsed >= SESSION_WARN_MS && !sessionWarningFired.current) {
        sessionWarningFired.current = true;
        setSessionWarning(true);
        playVolumeEnd(); // descending 3-tone on web, "Stop!" on native
      }

      // Hard cap — auto-stop at 30 s
      if (elapsed >= SESSION_MAX_MS) {
        clearInterval(id);
        stopSession();
      }
    }, 250);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Derive per-device timing constants from the hello packet.
      // Model III sends hw:"III" and mode:"batch"; Model II omits both fields.
      const isModelIII    = obj.hw === "III";
      const info: DeviceInfo = {
        id:           obj.id,
        fw:           obj.fw,
        hw:           obj.hw   ?? "II",
        rows:         obj.rows,
        cols:         obj.cols,
        mode:         obj.mode ?? "single",
        scanPeriodMs: isModelIII ? 8  : 37,
        samplingHz:   isModelIII ? 120 : 25,
      };
      setDeviceInfo(info);
      deviceInfoRef.current = info;
      console.log(`[BLE] hello hw=${info.hw} mode=${info.mode} scanPeriodMs=${info.scanPeriodMs}`);
      // ── Device claim check ────────────────────────────────────────────────
      // Three outcomes:
      //   1. Claimed by a different program → disconnect immediately, show error.
      //   2. Unclaimed → claim it for this program (sets program_id + claimed_at).
      //   3. Same program → allow, just update last_seen_at / fw metadata.
      if (supabase && programIdRef.current) {
        (async () => {
          const deviceId    = obj.id as string;
          const myProgramId = programIdRef.current!;

          const { data: existing } = await supabase!
            .from("devices")
            .select("program_id, claimed_at")
            .eq("id", deviceId)
            .maybeSingle();

          // ── Blocked: device belongs to a different program ──────────────────
          if (existing?.program_id && existing.program_id !== myProgramId) {
            console.warn(`[devices] ${deviceId} is claimed by another program — blocking`);
            setDeviceInfo(null);
            deviceInfoRef.current = null;
            setBleStatus("disconnected");
            setBleError("This device is registered to a different program and can't be used here.");
            adapterDisconnect(connRef.current);
            connRef.current = null;
            return;
          }

          // ── Allowed: build upsert payload ───────────────────────────────────
          const upsertData: Record<string, unknown> = {
            id:           deviceId,
            fw_version:   obj.fw,
            last_seen_at: new Date().toISOString(),
            hw:           info.hw,
            mode:         info.mode,
            // Keep features in sync for dashboards that read features->>'hw'
            features:     { hw: info.hw, mode: info.mode },
          };

          // ── Claim: first time this device is seen by any program ─────────────
          if (!existing?.program_id) {
            upsertData.program_id = myProgramId;
            upsertData.claimed_at = new Date().toISOString();
            console.log(`[devices] claiming ${deviceId} for program ${myProgramId}`);
          }

          const { error } = await supabase!
            .from("devices")
            .upsert(upsertData, { onConflict: "id" });
          if (error) console.warn("[devices] upsert failed:", error.message);
        })();
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

    // ── Normalise both packet shapes into a list of { hits, t } frame objects ──
    // Model II  sends: { hits: [...], t: number }          → one frame per packet
    // Model III sends: { type:"batch", frames:[{hits,t}] } → N frames per packet
    // All per-frame logic below is identical for both hardware generations.
    const isBatch = obj.type === "batch" && Array.isArray(obj.frames);
    const rawFrames: Array<{ hits: RichHit[]; t: number }> = isBatch
      ? (obj.frames as Array<any>).map(f => ({ hits: (f.hits ?? []) as RichHit[], t: (f.t ?? 0) as number }))
      : [{ hits: (obj.hits ?? []) as RichHit[], t: (obj.t ?? 0) as number }];

    for (const { hits, t: frameT } of rawFrames) {
      if (!hits.length) continue;

    const epochMs = Date.now();

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
        continue;
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
        continue;
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
        continue;
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
        // Increment attempt counters — ref immediately, state for display
        tgtAttemptsRef.current += 1;
        setTgtAttempts(tgtAttemptsRef.current);
        tgtSumMs.current += rt;
        // Track best RT across all attempts (for display) and correct-only (for quality)
        tgtBestAllMsRef.current = tgtBestAllMsRef.current === null
          ? rt : Math.min(tgtBestAllMsRef.current, rt);
        setTgtBestMs(tgtBestAllMsRef.current);
        if (isCorrect) {
          tgtHitsRef.current += 1;
          setTgtHits(tgtHitsRef.current);
          tgtCorrectSumMs.current += rt;
          tgtBestCorrectMsRef.current = tgtBestCorrectMsRef.current === null
            ? rt : Math.min(tgtBestCorrectMsRef.current, rt);
        }
        setTgtAvgMs(Math.round(tgtSumMs.current / tgtAttemptsRef.current));
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
        raw:              isBatch ? { t: frameT, hits } : obj,
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

    } // end for (batch dispatcher loop)
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
    // Clear device identity so stale hw/mode/samplingHz can't bleed into
    // the next connection if a different hardware generation reconnects
    // before its hello packet arrives.
    setDeviceInfo(null);
    deviceInfoRef.current = null;
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
    if (!latestFw || !latestFwFile || !connRef.current) return;
    setOtaState("updating");
    setOtaProgress(0);
    setOtaError(null);

    try {
      // 1. Fetch the model-specific firmware file from the public folder
      const resp = await fetch(latestFwFile);
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
    setSessionWarning(false);
    sessionWarningFired.current = false;
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
      tgtSumMs.current          = 0;
      tgtCorrectSumMs.current    = 0;
      tgtAttemptsRef.current     = 0;
      tgtHitsRef.current         = 0;
      tgtBestAllMsRef.current    = null;
      tgtBestCorrectMsRef.current = null;
      tgtZoneRef.current         = null;
      tgtSignalAt.current        = null;
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
    setSessionWarning(false);
    sessionWarningFired.current = false;
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
        // Derive hardware metadata from the hello packet — never hardcoded.
        // Falls back to Model II defaults when deviceInfo is unavailable.
        deviceModel:  deviceInfo?.hw === "III" ? "TSIII" : "TSII",
        samplingHz:   deviceInfo?.samplingHz   ?? 25,
        scanPeriodMs: deviceInfo?.scanPeriodMs ?? SCAN_PERIOD_MS_DEFAULT,
        // reaction live stats
        rxBestMs:    rxBestMs,
        rxAvgMs:     rxAvgMs,
        rxAttempts:  rxAttemptsRef.current,
        // accuracy live stats
        accHitsCount: accHitsRef.current,
        accScoreSum:  accSumRef.current,
        // target live stats
        // All target counters read from refs — never stale at save time
        tgtAttempts:     tgtAttemptsRef.current,
        tgtCorrectHits:  tgtHitsRef.current,
        tgtCorrectSumMs: tgtCorrectSumMs.current,
        tgtBestMs:           tgtBestAllMsRef.current,
        tgtBestCorrectMs:    tgtBestCorrectMsRef.current,
        // physical device identity from hello packet
        deviceId:    deviceInfo?.id,
      });
      setSaveState("saved");
      // Advance queue: pop the athlete we just saved and select the next one.
      setQueue(q => {
        if (q.length === 0) return q;
        const next = q.slice(1);
        setSelectedAthlete(next[0] ?? null);
        return next;
      });
    } catch (err: any) {
      console.error("Session save failed:", err);
      setSaveError(err.message ?? "Unknown error");
      setSaveState("error");
    }
  };

  // ── Discard session — wipes accumulated frames without saving ─────────────────
  const discardSession = () => {
    framesRef.current  = [];
    frameIndex.current = 0;
    feedCounter.current = 0;
    setFeed([]);
    setGrid(new Map());
    setPeakMv(0);
    setElapsedMs(0);
    setSaveState("idle");
    setSaveError(null);
  };

  // ── Feed / stats display metric toggle ───────────────────────────────────────
  const [feedMetric, setFeedMetric] = useState<"v" | "si">("v");
  // MiniStatStrip: which counter is featured in the left pill — hits or
  // total BLE events. Click the pill to flip it.
  const [topMetric, setTopMetric] = useState<"hits" | "events">("hits");

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
        { label: "Peak",     value: peakMv ? (feedMetric === "si" ? String(strengthIndex(null, peakMv)) : (peakMv / 1000).toFixed(3)) : "—",
          sub: peakMv ? (feedMetric === "si" ? "SI" : "V") : "", color: feedMetric === "si" ? "#b400ff" : undefined },
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
        { label: "Peak",   value: peakMv ? (feedMetric === "si" ? String(strengthIndex(null, peakMv)) : (peakMv / 1000).toFixed(3)) : "—",
          sub: peakMv ? (feedMetric === "si" ? "SI" : "V") : "", color: feedMetric === "si" ? "#b400ff" : MODE_META.power.color },
      ];

  // ── Onboarding flow step ─────────────────────────────────────────────────────
  // 1 = pick athlete  2 = connect bag  3 = pick mode  0 = all done / session active
  const flowStep =
    sessionActive                                  ? 0
    : !selectedAthlete                             ? 1
    : bleStatus !== "connected"                    ? 2
    : framesRef.current.length === 0               ? 3
    : 0;

  // Wave 1 #2 — Horizontal swipe on the bag cycles modes (only when the bag is
  // connected and a session isn't running). Suppresses the synthesized click
  // that would otherwise fire startSession() at the end of a swipe.
  const bagSwipe = useBagModeSwipe(
    sessionMode,
    setSessionMode,
    bleStatus === "connected" && !sessionActive,
  );

  // Wave 2 #4 — Focus mode. Double-click the bag to collapse both sidebars and
  // give the bag the full width. Escape exits. The grid transition is on the
  // outer .ts-ses-layout container; sidebars get overflow:hidden so children
  // don't bleed during the slide-out.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wave 2 #6 — Swipe down on the Save/Discard card to discard. Disabled while
  // saving so we don't yank the buttons mid-network-call.
  const dismissSwipe = useDismissSwipe(discardSession, {
    threshold: 80,
    disabled: saveState === "saving",
  });

  return (
    /* Wave 2 #4 (refined) — Focus mode lifts the 1100px page cap and
       shrinks the page padding so the bag can grow to fill the viewport.
       The bag itself is then clamped by .ts-ses-layout--focused .ts-ses-bagWrap
       (see <style> block) using min(100%, (100dvh - chrome) * 0.72) so it
       respects the user's viewport height too. */
    <div
      className={focused ? "ts-ses-page ts-ses-page--focused" : "ts-ses-page"}
      style={{
        maxWidth: focused ? "100%" : 1100,
        margin: "0 auto",
        padding: focused ? "8px 12px" : "24px 20px",
        transition: "max-width 380ms cubic-bezier(.25,.46,.45,.94), padding 380ms cubic-bezier(.25,.46,.45,.94)",
      }}
    >

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      {/* Wave 2 #4 (refined) — collapse header marginBottom in focus mode to
          reclaim vertical space for the bag. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        marginBottom: focused ? 10 : 28,
        transition: "margin-bottom 380ms cubic-bezier(.25,.46,.45,.94)",
      }}>
        <button
          onClick={() => navigate("/m/dashboard")}
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
      {/* Wave 2 #4 — `focused` collapses the sidebars by overriding the grid.
          The base .ts-ses-layout rule (and its 1000px / 680px media-query
          variants) lives in the <style> block at the bottom; we only override
          when focused is true. The transition lives in the .ts-ses-layout rule
          so it applies to both directions. */}
      <div
        className={`ts-ses-layout ${focused ? "ts-ses-layout--focused" : ""}`}
        style={focused ? {
          gridTemplateColumns: "0px minmax(300px, 1fr) 0px",
        } : undefined}
      >

        {/* ════ LEFT — Athlete + BLE ════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Athlete card */}
          <div className={flowStep === 1 ? "ts-flow-athlete" : undefined} style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", height: 480, minHeight: 360, maxHeight: 560 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                Athletes
                {flowStep === 1 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#b400ff", letterSpacing: "0.06em", animation: "tsBlink 1.4s ease-in-out infinite", whiteSpace: "nowrap" }}>
                    Step 1 — Pick ↓
                  </span>
                )}
              </span>

              {/* Roster ⇄ Queue toggle — single button that swaps views on
                  click. Appears as soon as the first athlete is queued and
                  auto-animates in with a slide+fade. Carries a live count
                  badge that pulses whenever the count changes (React key swap
                  re-fires the CSS animation). Purple highlight when in Queue
                  view; neutral when in Roster view. */}
              {queue.length > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={athleteView === "queue"}
                  aria-label={
                    athleteView === "queue"
                      ? "Switch to roster view"
                      : `Switch to queue view (${queue.length} athlete${queue.length !== 1 ? "s" : ""})`
                  }
                  title={athleteView === "queue" ? "Switch to Roster" : "Switch to Queue"}
                  onClick={() => setAthleteView(athleteView === "queue" ? "roster" : "queue")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                    color: "var(--text)",
                    background: athleteView === "queue"
                      ? "rgba(180,0,255,0.22)"
                      : "rgba(255,255,255,0.06)",
                    border: athleteView === "queue"
                      ? "1px solid rgba(180,0,255,0.50)"
                      : "1px solid rgba(255,255,255,0.15)",
                    flexShrink: 0,
                    animation: "tsSlideUp 0.22s ease-out",
                    transition: "all 150ms ease",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.7, flexShrink: 0 }}>
                    <path d="M3 5h10M10 2l3 3-3 3M13 11H3M6 14l-3-3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {athleteView === "queue" ? "Queue" : "Roster"}
                  <span
                    key={queue.length}
                    style={{
                      minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 800,
                      background: athleteView === "queue"
                        ? "rgba(180,0,255,0.85)"
                        : "rgba(180,0,255,0.30)",
                      color: "#fff",
                      animation: "tsValuePop 240ms ease-out",
                    }}
                  >{queue.length}</span>
                </button>
              )}
            </div>

            {athleteView === "roster" ? (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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

                {/* Queue hint — only show when there's something to queue. */}
                {!athletesLoading && filteredAthletes.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      background: "linear-gradient(135deg, rgba(180,0,255,0.75), rgba(140,0,210,0.75))",
                    }}>
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                        <path d="M8 13V4M8 4l-4 4M8 4l4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M3 1.5h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    Add first &nbsp;·&nbsp;
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      background: "linear-gradient(135deg, rgba(40,40,40,0.95), rgba(10,10,10,0.95))",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}>
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3v9M8 12l-4-4M8 12l4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M3 14.5h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    Add last
                  </div>
                )}

                {/* List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
                  {athletesLoading ? (
                    /* Wave 1 #3 — Skeleton rows replace the legacy "Loading…" text. */
                    <>
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          height: 58,
                          flexShrink: 0,
                          boxSizing: "border-box",
                          padding: "0 11px", borderRadius: 11,
                          border: "1px solid rgba(255,255,255,0.04)",
                          background: "rgba(255,255,255,0.02)",
                        }}>
                          <Skeleton w={34} h={34} r="50%" />
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                            <Skeleton w={`${60 + ((i * 13) % 30)}%`} h={11} />
                            <Skeleton w={`${30 + ((i * 17) % 25)}%`} h={9} />
                          </div>
                        </div>
                      ))}
                    </>
                  ) : filteredAthletes.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
                      {athleteFilter ? "No results" : "No athletes found"}
                    </div>
                  ) : filteredAthletes.map((a: Athlete) => {
                    const sel = selectedAthlete?.id === a.id;
                    return (
                      <AthleteRow
                        key={a.id}
                        athlete={a}
                        selected={sel}
                        inQueue={isInQueue(a.id)}
                        isDark={isDark}
                        onSelect={() => { setSelectedAthlete(sel ? null : a); if (sel) stopSession(); }}
                        onAddFirst={() => queueAddFirst(a)}
                        onAddLast={() => queueAddLast(a)}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                {/* Queue view */}
                {queue.length === 0 ? (
                  <div style={{
                    fontSize: 13, color: "var(--muted)", textAlign: "center",
                    padding: "28px 8px",
                    border: isDark ? "1px dashed rgba(255,255,255,0.08)" : "1px dashed rgba(0,0,0,0.12)",
                    borderRadius: 12,
                    background: isDark ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.02)",
                  }}>
                    Queue is empty.<br />
                    <span style={{ fontSize: 11, opacity: 0.8 }}>
                      Switch to <b>Roster</b> and tap <b>First</b> or <b>Last</b> on an athlete to queue them.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Queue action bar — count + clear all at top */}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 8,
                      padding: "6px 10px",
                      borderRadius: 9,
                      background: "rgba(180,0,255,0.06)",
                      border: "1px solid rgba(180,0,255,0.15)",
                    }}>
                      <span style={{ fontSize: 11, color: "rgba(200,140,255,0.80)", fontWeight: 600 }}>
                        {queue.length} athlete{queue.length !== 1 ? "s" : ""} · drag to reorder
                      </span>
                      <button
                        type="button"
                        onClick={queueClear}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "rgba(255,70,90,0.10)",
                          border: "1px solid rgba(255,70,90,0.25)",
                          borderRadius: 6,
                          cursor: "pointer",
                          color: "rgba(255,100,115,0.95)",
                          fontSize: 11, fontWeight: 700,
                          letterSpacing: "0.03em",
                          padding: "3px 8px",
                          transition: "background 140ms ease",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,70,90,0.18)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,70,90,0.10)")}
                      >
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                        Clear all
                      </button>
                    </div>

                    <div
                      ref={queueListRef}
                      style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}
                    >
                      {queue.map((a: Athlete, idx: number) => {
                        // Per-row visual offset during an active drag:
                        //   • Picked-up row → follows the finger (translateY = pointer delta)
                        //   • Rows between fromIdx and overIdx → slide one row to make space
                        //   • Everyone else → 0 (their natural position)
                        let dragTranslateY = 0;
                        const isDraggedRow = dragInfo?.fromIdx === idx;
                        if (dragInfo) {
                          if (isDraggedRow) {
                            dragTranslateY = dragInfo.pointerY - dragInfo.startPointerY;
                          } else {
                            const { fromIdx, overIdx, rowHeight } = dragInfo;
                            if (overIdx > fromIdx && idx > fromIdx && idx <= overIdx) {
                              dragTranslateY = -rowHeight;
                            } else if (overIdx < fromIdx && idx < fromIdx && idx >= overIdx) {
                              dragTranslateY = rowHeight;
                            }
                          }
                        }
                        // FLIP applies for one frame after release on the row that
                        // was just dropped — by id, since indexes have shifted.
                        const flipFromY = (flipRelease && flipRelease.athleteId === a.id)
                          ? flipRelease.deltaY
                          : 0;
                        return (
                          <QueueRow
                            key={a.id}
                            athlete={a}
                            position={idx}
                            isDragging={isDraggedRow}
                            dragTranslateY={dragTranslateY}
                            flipFromY={flipFromY}
                            handleProps={queueHandlePropsFor(idx)}
                            isDark={isDark}
                            onRemove={() => queueRemove(a.id)}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* BLE card */}
          {selectedAthlete && (
            <div className={flowStep === 2 ? "ts-flow-ble" : undefined} style={{
              background: "var(--panel)",
              border: bleStatus === "connected" ? "1px solid rgba(0,255,136,0.28)" : "1px solid var(--panel-border)",
              borderRadius: 16, padding: 16,
              animation: flowStep === 2 ? undefined : "tsSlideUp 0.22s ease-out",
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                Bag Connection
                {flowStep === 2 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#b400ff", letterSpacing: "0.06em", animation: "tsBlink 1.4s ease-in-out infinite" }}>
                    Step 2 — Connect ↓
                  </span>
                )}
                {flowStep === 3 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#b400ff", letterSpacing: "0.06em", animation: "tsBlink 1.4s ease-in-out infinite" }}>
                    Step 3 — Pick mode below ↓
                  </span>
                )}
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
                    {/* Hardware generation badge — distinguishes Model II from Model III */}
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
                      color: deviceInfo.hw === "III" ? "#00ff88" : "#b400ff",
                      background: deviceInfo.hw === "III" ? "rgba(0,255,136,0.12)" : "rgba(180,0,255,0.12)",
                      border: `1px solid ${deviceInfo.hw === "III" ? "rgba(0,255,136,0.30)" : "rgba(180,0,255,0.30)"}`,
                      borderRadius: 4, padding: "1px 5px",
                    }}>
                      {deviceInfo.hw === "III" ? "III · 120Hz" : "II · 27Hz"}
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

              {/* Mode selection lives in the ModeRolodex (fixed bottom panel
                  that auto-slides up after the adapter connects). The Bag
                  Connection card stays focused on the adapter itself —
                  status, firmware/OTA, connect/disconnect — so this is where
                  the inline mode chips used to be. */}

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
            onTouchStart={bagSwipe.onTouchStart}
            onTouchEnd={bagSwipe.onTouchEnd}
            onClickCapture={bagSwipe.onClickCapture}
            // Wave 2 #4 — Double-click toggles focus mode. Most useful during
            // an active session; before the session starts the "Tap to Start"
            // overlay swallows the first click, so this gesture effectively
            // gates itself behind sessionActive.
            onDoubleClick={() => setFocused(f => !f)}
            style={{
              boxShadow: bleStatus === "connected"
                ? `0 0 40px -10px ${MODE_META[sessionMode].glow.replace("0.55","0.35")}, inset 0 0 60px -20px ${MODE_META[sessionMode].glow.replace("0.55","0.12")}`
                : "none",
              borderColor: bleStatus === "connected"
                ? `${MODE_META[sessionMode].color}44`
                : "var(--panel-border)",
              // Wave 2 #4 (refined) — also transition `width` so the bag
              // visibly scales between focus / unfocus instead of snapping.
              transition: "border-color 300ms, box-shadow 300ms, width 380ms cubic-bezier(.25,.46,.45,.94)",
            }}
          >
            {/* Wave 2 #5 — MiniStatStrip. Two interactive glass pills inline
                with the ArcTimer + Stop cluster.
                  • Left pill — taps cycle Hits ↔ Events.
                  • Right pill — taps cycle the V ↔ SI feed metric (mirrors the
                    standalone toggle in the right sidebar).
                The legacy count-up "time" pill was retired — the ArcTimer
                already shows session time visually.
                The container is pointerEvents:none so empty space passes
                through to the bag; only the pills themselves opt in. Mode-
                tinted accent ring + tap-down scale make the toggles feel
                tactile, and a key={value} swap on the value div re-runs the
                tsValuePop animation whenever the number ticks. */}
            {sessionActive && (() => {
              const modeColor = MODE_META[sessionMode].color;
              const isHits   = topMetric === "hits";
              const topValue = isHits ? String(feed.length) : String(frameCount);
              const peakValue =
                peakMv
                  ? (feedMetric === "si"
                      ? String(strengthIndex(null, peakMv))
                      : (peakMv / 1000).toFixed(2))
                  : "—";
              const peakSub  = peakMv ? (feedMetric === "si" ? "SI" : "V") : "";
              const peakColor = feedMetric === "si" ? "#b400ff" : modeColor;

              const pillBase: React.CSSProperties = {
                flex: 1, minWidth: 0,
                height: 40,
                padding: "0 8px", borderRadius: 8,
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                // Flex column so the label + value sit dead-centered both
                // horizontally and vertically inside the fixed-height pill.
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                textAlign: "center",
                cursor: "pointer",
                userSelect: "none",
                WebkitTapHighlightColor: "transparent",
                pointerEvents: "auto",
                transition: "transform 120ms ease, border-color 200ms ease, background 200ms ease",
              };

              return (
                <div style={{
                  position: "absolute", top: 10, left: 10, zIndex: 8,
                  right: 128,                  // ArcTimer (40) + gap (10) + Stop (~58) + right inset (10) ≈ 118
                  display: "flex", gap: 6, alignItems: "center",
                  pointerEvents: "none",
                }}>
                  {/* Hits ↔ Events */}
                  <button
                    type="button"
                    aria-label={`Showing ${topMetric}. Tap to switch.`}
                    onClick={() => setTopMetric(m => (m === "hits" ? "events" : "hits"))}
                    className="ts-mini-pill"
                    style={{
                      ...pillBase,
                      border: `1px solid ${modeColor}55`,
                      boxShadow: `inset 0 0 0 1px ${modeColor}10`,
                    }}
                  >
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.55)",
                      textAlign: "center",
                    }}>
                      {isHits ? "hits" : "events"}
                    </div>
                    <div
                      key={`${topMetric}:${topValue}`}
                      style={{
                        fontSize: 13, fontWeight: 800, lineHeight: 1.15,
                        color: "#fff",
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "-0.01em",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        animation: "tsValuePop 220ms ease",
                      }}
                    >
                      {topValue}
                    </div>
                  </button>

                  {/* Peak  ·  V ↔ SI */}
                  <button
                    type="button"
                    aria-label={`Peak in ${feedMetric === "si" ? "Strike Index" : "Volts"}. Tap to switch.`}
                    onClick={() => setFeedMetric(m => (m === "v" ? "si" : "v"))}
                    className="ts-mini-pill"
                    style={{
                      ...pillBase,
                      border: `1px solid ${peakColor}55`,
                      boxShadow: `inset 0 0 0 1px ${peakColor}10`,
                    }}
                  >
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.55)",
                      textAlign: "center",
                    }}>
                      peak
                    </div>
                    <div
                      key={`${feedMetric}:${peakValue}`}
                      style={{
                        fontSize: 13, fontWeight: 800, lineHeight: 1.15,
                        color: peakColor,
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "-0.01em",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        animation: "tsValuePop 220ms ease",
                        display: "inline-flex", alignItems: "baseline", gap: 3,
                      }}
                    >
                      <span>{peakValue}</span>
                      {peakSub && (
                        <span style={{
                          fontSize: 9, fontWeight: 700,
                          color: `${peakColor}cc`,
                          letterSpacing: "0.04em",
                        }}>
                          {peakSub}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })()}

            {/* Stop button + ArcTimer — overlaid top-right inside bag.
                Heights are pinned to 40px to match the MiniStatStrip pills so
                the whole top-row toolbar reads as a single horizontal cluster. */}
            {sessionActive && (
              <div style={{
                position: "absolute", top: 10, right: 10, zIndex: 9,
                display: "flex", alignItems: "center", gap: 10,
                height: 40,
              }}>
                {/* Wave 1 #1 — ArcTimer replaces the legacy "{X}s left" text banner.
                    Runs the full 30s; color shifts amber at 25s, red at 28s. */}
                <ArcTimer elapsedMs={elapsedMs} size={40} />
                <button
                  onClick={stopSession}
                  style={{
                    height: 40, padding: "0 14px", borderRadius: 8,
                    fontWeight: 700, fontSize: 12,
                    background: "rgba(255,80,80,0.18)", border: "1px solid rgba(255,80,80,0.35)",
                    color: "#ff8080", cursor: "pointer",
                    backdropFilter: "blur(8px)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
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
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{MODE_META[sessionMode].icon} {MODE_META[sessionMode].label} Session</span>
              {(() => {
                const toggleInk = isDark ? "255,255,255" : "20,20,40";
                return (
                  <div style={{
                    display: "inline-flex", alignItems: "center",
                    background: `rgba(${toggleInk},0.04)`,
                    border: `1px solid rgba(${toggleInk},0.10)`,
                    borderRadius: 7,
                    padding: "2px 4px",
                    gap: 1,
                  }}>
                    {(["v", "si"] as const).map(m => (
                      <button key={m} onClick={() => setFeedMetric(m)} style={{
                        padding: "4px 10px", borderRadius: 5,
                        border: feedMetric === m ? "1px solid #b400ff" : "1px solid transparent",
                        background: feedMetric === m ? "rgba(180,0,255,0.15)" : "transparent",
                        color: feedMetric === m ? "#b400ff" : `rgba(${toggleInk},0.50)`,
                        font: "inherit", fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                        transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                        textTransform: "uppercase",
                      }}>{m === "v" ? "V" : "SI"}</button>
                    ))}
                  </div>
                );
              })()}
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

            {/* Save / Discard — shown after session ends with recorded data */}
            {canSave && (
              <div
                onTouchStart={dismissSwipe.onTouchStart}
                onTouchMove={dismissSwipe.onTouchMove}
                onTouchEnd={dismissSwipe.onTouchEnd}
                style={{
                  marginTop: 12, display: "flex", gap: 8,
                  // Wave 2 #6 — Swipe down to discard. Visual style spread last
                  // so the transform/opacity overrides our static layout.
                  ...dismissSwipe.style,
                }}
              >
                {/* Hint chip — only visible mid-drag so it doesn't clutter idle state. */}
                {dismissSwipe.drag > 8 && (
                  <div style={{
                    position: "absolute",
                    left: 0, right: 0,
                    top: -22,
                    textAlign: "center",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: dismissSwipe.drag >= 80 ? "#ff8080" : "var(--muted)",
                    pointerEvents: "none",
                    transition: "color 160ms ease",
                  }}>
                    {dismissSwipe.drag >= 80 ? "Release to discard" : "Swipe down to discard"}
                  </div>
                )}
                <button
                  onClick={saveSession}
                  disabled={saveState === "saving"}
                  style={{
                    flex: 1, padding: "10px 0",
                    borderRadius: 10, fontWeight: 700, fontSize: 13,
                    background: saveBtnStyle[saveState].bg,
                    border:     `1px solid ${saveBtnStyle[saveState].border}`,
                    color:      saveBtnStyle[saveState].color,
                    cursor: saveState === "saving" ? "default" : "pointer",
                    transition: "all 200ms",
                  }}
                >
                  {saveBtnStyle[saveState].label}
                </button>
                <button
                  onClick={discardSession}
                  disabled={saveState === "saving"}
                  title="Discard this session — data will not be saved"
                  style={{
                    padding: "10px 14px", borderRadius: 10, fontWeight: 700, fontSize: 13,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "var(--muted)",
                    cursor: saveState === "saving" ? "default" : "pointer",
                    transition: "all 200ms",
                    opacity: saveState === "saving" ? 0.45 : 1,
                  }}
                >
                  Discard
                </button>
              </div>
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

          {/* Impact feed — hidden until a session starts; remains visible afterward if there's data to review */}
          {(sessionActive || feed.length > 0) && (
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, padding: 16, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Impact Feed</span>
              {feed.length > 0 && <span style={{ fontWeight: 600, color: "var(--accent)", fontSize: 11 }}>{feed.length}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 340, overflowY: "auto" }}>
              {feed.length === 0 ? (
                /* Wave 1 #3 — Skeleton rows replace the "No impacts yet" text. */
                <>
                  {[88, 64, 92, 70, 80, 58].map((w, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "5px 8px", borderRadius: 8,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid transparent",
                      }}
                    >
                      <Skeleton w={`${w * 0.55}%`} h={11} />
                      <Skeleton w={48} h={11} />
                    </div>
                  ))}
                </>
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
          )}
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

      {/* ── Mode Rolodex — slides up once the adapter is connected,
              hides automatically while a session is running, and slides
              back up once the post-session save completes ── */}
      <ModeRolodex
        connected={bleStatus === "connected"}
        sessionActive={sessionActive}
        mode={sessionMode}
        onModeSelect={setSessionMode}
        saveComplete={saveState === "saved"}
      />

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
          /* Wave 2 #4 — animate sidebars in/out for focus mode. */
          transition: grid-template-columns 380ms cubic-bezier(.25,.46,.45,.94),
                      gap 380ms cubic-bezier(.25,.46,.45,.94);
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
        /* Wave 2 #4 — Focus mode overrides. Inline style sets the columns
           (so we can animate cleanly). These rules clip & fade the sidebars
           and kill the inter-column gap. The nth-child(3) override below
           wins over the 1000px media-query rule for the wide layout. */
        .ts-ses-layout--focused {
          gap: 0 !important;
        }
        .ts-ses-layout--focused > :nth-child(1),
        .ts-ses-layout--focused > :nth-child(3) {
          overflow: hidden;
          opacity: 0;
          transform: scale(0.96);
          pointer-events: none;
          transition: opacity 240ms ease, transform 240ms ease;
        }
        @media (max-width: 1000px) {
          .ts-ses-layout--focused > :nth-child(3) {
            grid-column: auto;
          }
        }

        /* Wave 2 #4 (refined) — Adaptive zoom for focus mode.
           The bag is clamped by BOTH viewport-width and viewport-height so it
           fits any device while preserving its 0.72 aspect ratio (W:H).
           - 100% fills the now-full-width middle column (page cap is lifted).
           - (100dvh - chrome) * 0.72 caps width by available viewport height,
             so on tall mobile screens / short desktop windows the bag never
             overflows vertically. min() picks whichever is smaller.
           Chrome budget (~96px) accounts for: page padding (8 top + 8 bottom),
           the page header (~30px h1 + 10 margin-bottom while focused), plus a
           small safety buffer so the bag doesn't kiss the bottom edge. */
        .ts-ses-layout--focused > :nth-child(2) {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-width: 0; /* allow the grid item to actually shrink to its child */
        }
        .ts-ses-layout--focused .ts-ses-bagWrap {
          /* dvh is the dynamic viewport unit — it accounts for mobile URL bars
             showing/hiding without layout jumps. Falls back via the @supports
             check below for very old browsers. */
          width: min(100%, calc((100vh - 96px) * 0.72));
          margin: 0 auto;
        }
        @supports (height: 100dvh) {
          .ts-ses-layout--focused .ts-ses-bagWrap {
            width: min(100%, calc((100dvh - 96px) * 0.72));
          }
        }
        /* On very narrow / short screens (small phones in landscape) the
           default chrome budget is too generous — give the bag more room. */
        @media (max-height: 520px) {
          .ts-ses-layout--focused .ts-ses-bagWrap {
            width: min(100%, calc((100vh - 70px) * 0.72));
          }
          @supports (height: 100dvh) {
            .ts-ses-layout--focused .ts-ses-bagWrap {
              width: min(100%, calc((100dvh - 70px) * 0.72));
            }
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

        /* MiniStatStrip — quick pop on the value when it changes (driven
           by the React key swap so the animation re-fires every tick). */
        @keyframes tsValuePop {
          0%   { transform: scale(0.92); opacity: 0.55; }
          50%  { transform: scale(1.06); opacity: 1;    }
          100% { transform: scale(1);    opacity: 1;    }
        }
        /* Tap feedback for the interactive pills. */
        .ts-mini-pill { -webkit-appearance: none; appearance: none; font: inherit; }
        .ts-mini-pill:hover { background: rgba(0,0,0,0.65); }
        .ts-mini-pill:active { transform: scale(0.94); }

        /* Wave 1 #3 — Skeleton shimmer (paired with the Skeleton component). */
        @keyframes tsShimmer {
          0%, 100% { opacity: 0.40; }
          50%      { opacity: 0.85; }
        }

        /* Wave 1 #2 — iOS-spring bounce on the mode chip that becomes active
           after a swipe (or a tap). Triggers when the active button changes
           because the animation-name flips from "none" → tsModeBounce. */
        @keyframes tsModeBounce {
          0%   { transform: scale(1);    }
          40%  { transform: scale(1.04); }
          70%  { transform: scale(0.99); }
          100% { transform: scale(1);    }
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
          /* "manipulation" skips the legacy 300ms click delay and disables
             double-tap-to-zoom on touch devices, so two quick taps reliably
             fire the onDoubleClick handler that toggles focus mode. */
          touch-action: manipulation;
        }

        /* ── Cells — mirrors ts-sim-cell ── */
        .ts-ses-cell {
          border: 1px solid rgba(255,255,255,0.12);
        }
        :root[data-theme="light"] .ts-ses-cell {
          border-color: rgba(0,0,0,0.12);
        }

        /* ── Onboarding flow glow / bounce ── */
        @keyframes tsFlowBounce {
          0%,100% { transform: translateY(0);    box-shadow: 0 0 0 0 transparent; }
          30%      { transform: translateY(-4px); box-shadow: 0 8px 28px -4px rgba(180,0,255,0.40); }
          60%      { transform: translateY(-2px); box-shadow: 0 6px 20px -4px rgba(180,0,255,0.22); }
        }
        @keyframes tsFlowPulse {
          0%,100% { border-color: rgba(180,0,255,0.22); }
          50%      { border-color: rgba(180,0,255,0.75); }
        }
        .ts-flow-athlete,
        .ts-flow-ble,
        .ts-flow-mode {
          animation: tsFlowBounce 1.8s ease-in-out infinite, tsFlowPulse 1.8s ease-in-out infinite;
        }
        .ts-flow-mode {
          border: 1px solid rgba(180,0,255,0.22) !important;
        }
      `}</style>
    </div>
  );
}