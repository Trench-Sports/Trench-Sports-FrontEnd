// src/components/modeRolodex.tsx
//
// Infinite-scroll semi-circle rolodex overlaying session content.
// • Drag left/right on the arc to scroll — wraps infinitely through 5 modes
// • Center orb = 68px, adjacent ±1 = 50px, outer ±2 = 36px (smooth lerp)
// • Momentum + snap-to-nearest on release
// • Slides up on adapter connect, hides when session starts
// • Swipe-up / handle tap to recall
//
// Imports SessionMode and MODE_META from session.tsx so there is
// a single source of truth for mode definitions.

import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

// Re-import the shared types and constants from the session module.
// session.tsx must export: SessionMode, MODES, MODE_META
import { type SessionMode, MODES, MODE_META } from "../lib/sessionModes";
import { SwipeDeckContext } from "./mobileSwipeDeck";

const N = MODES.length;

// ─── Arc geometry ─────────────────────────────────────────────────────────────
// The orbs lie on a circle. ARC_CY shifts that circle vertically so the
// resulting arc sits inside the dark wave area instead of hovering above the
// panel. With ARC_CY = 130, the center orb's centre lands at panel y ≈ 63
// (top edge ~29, well below the wave's center crest at y ≈ 12) and edge orbs
// land near panel y ≈ 136 — comfortably above the mode-description footer.
const ARC_R     = 155;  // orbit radius px
const ARC_CY    = 130;  // circle centre Y inside the dark wave area
const ARC_START = 212;  // left end degrees
const ARC_END   = 328;  // right end degrees
const VISIBLE   = 2;    // render ±2 slots from centre

function arcPos(offsetFromCenter: number, containerW: number) {
  const cx = containerW / 2;
  const t = Math.max(0, Math.min(1, 0.5 + offsetFromCenter / N));
  const rad = ((ARC_START + t * (ARC_END - ARC_START)) * Math.PI) / 180;
  return { x: cx + ARC_R * Math.cos(rad), y: ARC_CY + ARC_R * Math.sin(rad) + 60 };
}

/** Smooth size interpolation: 68 at centre → 36 at edges */
function lerpSize(dist: number): number {
  const d = Math.abs(dist);
  if (d <= 0.5) return 68;
  if (d <= 1.5) return 68 - (d - 0.5) * 18;
  if (d <= 2.5) return 50 - (d - 1.5) * 14;
  return 36;
}

function orbOpacity(dist: number): number {
  const d = Math.abs(dist);
  if (d < 0.5)  return 1;
  if (d < 1.5)  return 0.78;
  if (d < 2.5)  return 0.45;
  return 0.15;
}

function hexRgb(hex: string): string {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(",");
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface ModeRolodexProps {
  /** Whether the BLE adapter is connected — controls visibility */
  connected: boolean;
  /** Hides the panel while a session is actively running */
  sessionActive: boolean;
  /** Currently selected mode (controlled by session.tsx) */
  mode: SessionMode;
  /** Called when the user scrolls to a new mode */
  onModeSelect: (m: SessionMode) => void;
  /** Optional z-index override (default 50) */
  zIndex?: number;
  /** True once the just-finished session has been saved — triggers an
   *  auto-recall so the user can pick the next mode without tapping the
   *  collapsed handle. Watched on the rising edge only. */
  saveComplete?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ModeRolodex({
  connected,
  sessionActive,
  mode,
  onModeSelect,
  zIndex = 50,
  saveComplete = false,
}: ModeRolodexProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // We portal the rolodex into the swipe deck's session panel so it shares
  // the panel's coordinate space — same width, slides off with the panel
  // during a horizontal swipe, hidden when the dashboard panel is active.
  const swipeCtx = useContext(SwipeDeckContext);
  const portalHost = swipeCtx.sessionPanelEl;

  // The route check is still useful as a belt-and-suspenders: in development,
  // hot-reload can leave a stale host pointer briefly. If the URL isn't on the
  // session page we bail entirely.
  const loc = useLocation();
  const onSessionPage = loc.pathname.startsWith("/m/session");

  // Continuous scroll position — integer = mode snapped to centre, fractional = mid-scroll
  const scrollPos  = useRef(0);
  const targetPos  = useRef(0);
  const velocity   = useRef(0);
  const animId     = useRef<number | null>(null);
  const dragging   = useRef(false);
  const dragStartX = useRef(0);
  const dragStartS = useRef(0);
  const lastX      = useRef(0);
  const lastT      = useRef(0);

  // Force re-renders from the RAF loop without external state
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick(t => t + 1), []);

  // Track real container width reactively so arc positions are always correct.
  // Initialise from window.innerWidth so the very first render is right even
  // before the ResizeObserver fires.
  const [containerW, setContainerW] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 380),
  );
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    // Read immediately in case the first observer callback fires after paint
    setContainerW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  // ── Open / close lifecycle ─────────────────────────────────────────────────
  // Slide up ~250 ms after adapter first connects (was 400 — felt sluggish).
  const prevConnected = useRef(false);
  useEffect(() => {
    if (connected && !prevConnected.current) {
      const t = setTimeout(() => setOpen(true), 250);
      return () => clearTimeout(t);
    }
    prevConnected.current = connected;
  }, [connected]);

  // Auto-hide when a session is running; stay hidden until user recalls it
  // (or until the just-finished session is saved — see saveComplete effect).
  useEffect(() => {
    if (sessionActive) setOpen(false);
  }, [sessionActive]);

  // Auto-recall once the post-session save completes. Rising-edge only, so
  // resetting saveState back to "idle" (e.g. starting a new session) won't
  // re-trigger this effect.
  const prevSaveComplete = useRef(false);
  useEffect(() => {
    if (saveComplete && !prevSaveComplete.current && !sessionActive) {
      setOpen(true);
    }
    prevSaveComplete.current = saveComplete;
  }, [saveComplete, sessionActive]);

  // Keep scroll position in sync when session.tsx changes mode externally
  // (e.g. via the existing bag swipe gesture or keyboard shortcut)
  useEffect(() => {
    const idx = MODES.indexOf(mode);
    if (idx < 0) return;
    const current = ((Math.round(scrollPos.current) % N) + N) % N;
    if (current === idx) return;
    let diff = idx - current;
    if (Math.abs(diff) > N / 2) diff -= Math.sign(diff) * N;
    targetPos.current = Math.round(scrollPos.current) + diff;
    cancelAnim();
    animateSnap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Animation helpers ──────────────────────────────────────────────────────
  const cancelAnim = useCallback(() => {
    if (animId.current !== null) {
      cancelAnimationFrame(animId.current);
      animId.current = null;
    }
  }, []);

  const animateSnap = useCallback(() => {
    const diff = targetPos.current - scrollPos.current;
    if (Math.abs(diff) < 0.003) {
      scrollPos.current = targetPos.current;
      const idx = ((Math.round(scrollPos.current) % N) + N) % N;
      onModeSelect(MODES[idx]);
      bump();
      return;
    }
    scrollPos.current += diff * 0.18;
    bump();
    animId.current = requestAnimationFrame(animateSnap);
  }, [onModeSelect, bump]);

  const momentumScroll = useCallback(() => {
    if (Math.abs(velocity.current) < 0.005) {
      targetPos.current = Math.round(scrollPos.current);
      animateSnap();
      return;
    }
    scrollPos.current += velocity.current;
    velocity.current  *= 0.88;
    bump();
    animId.current = requestAnimationFrame(momentumScroll);
  }, [animateSnap, bump]);

  // ── Arc drag (pointer events for mouse + touch) ────────────────────────────
  const STEP = 72; // px of horizontal drag per mode step

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartS.current = scrollPos.current;
    lastX.current = e.clientX;
    lastT.current = Date.now();
    velocity.current = 0;
    cancelAnim();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [cancelAnim]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const now = Date.now();
    const dt  = Math.max(1, now - lastT.current);
    velocity.current = ((e.clientX - lastX.current) / dt) * 16 / STEP * -1;
    lastX.current = e.clientX;
    lastT.current = now;
    scrollPos.current = dragStartS.current + (-(e.clientX - dragStartX.current) / STEP);
    bump();
  }, [bump]);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    cancelAnim();
    momentumScroll();
  }, [cancelAnim, momentumScroll]);

  // ── Panel swipe-up / swipe-down gesture ───────────────────────────────────
  const panelTy0    = useRef(0);
  const panelLastDy = useRef(0);
  const [panelDrag, setPanelDrag] = useState(0);

  const onPanelTouchStart = useCallback((e: React.TouchEvent) => {
    panelTy0.current = e.touches[0].clientY;
    panelLastDy.current = 0;
    setPanelDrag(0);
  }, []);

  const onPanelTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - panelTy0.current;
    panelLastDy.current = dy;
    if (open && dy > 0)  setPanelDrag(Math.min(dy, 200));
    if (!open && dy < 0) setPanelDrag(Math.max(dy, -204));
  }, [open]);

  const onPanelTouchEnd = useCallback(() => {
    if (!open && panelLastDy.current < -48) setOpen(true);
    else if (open && panelLastDy.current > 64) setOpen(false);
    setPanelDrag(0);
  }, [open]);

  // ── Render values ──────────────────────────────────────────────────────────
  const PANEL_H   = 240;
  const PEEK      = 36;          // px of panel visible when closed (handle only)
  const baseY     = open ? 0 : PANEL_H - PEEK;
  const totalY    = baseY + panelDrag;
  const springing = panelDrag === 0;

  const trueActive = ((Math.round(scrollPos.current) % N) + N) % N;
  const activeMeta = MODE_META[MODES[trueActive]];

  // Build orb list for current scroll position
  const orbs: Array<{
    key: string; dist: number; mIdx: number;
    x: number; y: number; size: number; opacity: number; isCenter: boolean;
  }> = [];

  for (let offset = -VISIBLE; offset <= VISIBLE; offset++) {
    const dist = scrollPos.current - Math.round(scrollPos.current) + offset;
    const mIdx = ((Math.round(scrollPos.current) - offset) % N + N) % N;
    const op   = orbOpacity(dist);
    if (op < 0.05) continue;
    const pos  = arcPos(-dist, containerW);
    orbs.push({
      key: `${offset}-${mIdx}`,
      dist, mIdx,
      x: pos.x, y: pos.y,
      size: lerpSize(dist),
      opacity: op,
      isCenter: Math.abs(dist) < 0.45,
    });
  }

  // Don't render until the adapter is connected, we're on the session page,
  // and the deck has handed us a portal host.
  if (!connected || !onSessionPage || !portalHost) return null;

  const rolodex = (
    <div
      style={{
        // Anchored to the session panel — width tracks the panel exactly,
        // and translation by the deck's transform during a swipe carries the
        // rolodex with the page (no more "fixed-to-viewport" mismatch).
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex,
        height: PANEL_H + 16,
        overflow: "visible",
        transform: `translate3d(0, ${totalY}px, 0)`,
        // iOS sheet-presentation curve — feels like a real native sheet.
        transition: springing
          ? "transform 480ms cubic-bezier(0.32, 0.72, 0, 1)"
          : "none",
        willChange: "transform",
        // Panel itself is now transparent — the wave SVG below provides a
        // gentle bottom-only dark fade for description legibility, and the
        // top of the arc reads straight through to the dashboard.
      }}
      onTouchStart={onPanelTouchStart}
      onTouchMove={onPanelTouchMove}
      onTouchEnd={onPanelTouchEnd}
      // Isolate the rolodex from the parent swipe deck. The deck listens for
      // pointer events at its container level and treats horizontal motion as
      // a page swipe — so dragging the orb scroll, or even tapping inside the
      // panel and moving slightly sideways, would otherwise flick to the
      // dashboard. Stop pointer events from bubbling past the rolodex root so
      // the deck never sees them; the rolodex's own arc-stage handlers still
      // fire because they're inside this subtree.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
    >
      {/* ── Wave cut-out background ── */}
      {/* Fill is a vertical gradient: fully transparent at the top of the
          arc so the dashboard reads through, fading to a soft dark only
          near the bottom so the mode description stays legible. */}
      <svg
        viewBox="0 0 390 256"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        <defs>
          <filter id="rdGlow2">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* userSpaceOnUse so the stops map straight to viewBox y values.
              Above the arc peak (y<-22) is outside the path entirely — fully
              transparent. Right at the arc line (y≈46 at edges) the dark
              gradient kicks in, deepening gently toward the bottom. */}
          <linearGradient
            id="rdFade"
            gradientUnits="userSpaceOnUse"
            x1="195" y1="0" x2="195" y2="256"
          >
            <stop offset="0%"   stopColor="#0a0a0d" stopOpacity={0} />
            <stop offset="18%"  stopColor="#0a0a0d" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#0a0a0d" stopOpacity={0.82} />
          </linearGradient>
        </defs>
        <path d="M0,46 Q195,-22 390,46 L390,256 L0,256 Z" fill="url(#rdFade)" />
        <path
          d="M0,46 Q195,-22 390,46"
          fill="none"
          stroke={activeMeta.color}
          strokeWidth="1.5"
          opacity="0.52"
          filter="url(#rdGlow2)"
          style={{ transition: "stroke 300ms" }}
        />
      </svg>

      {/* ── Pull handle ── */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 3,
          display: "flex", flexDirection: "column", alignItems: "center",
          paddingTop: 10, cursor: "pointer",
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
      </div>

      {/* ── Active mode label — centred inside the semi-circle ── */}
      {/* Sits in the visual cradle between the centre orb (y≈35 in stage
          coords, ends at y≈69) and the edge orbs (y≈108, top edge ≈90),
          so the label reads from the inside of the arc. */}
      <div
        style={{
          position: "absolute",
          top: 28 + 96,           // 28 = arc stage offset, 96 = visual centre of bowl
          left: 0, right: 0,
          textAlign: "center",
          pointerEvents: "none",
          zIndex: 2,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: activeMeta.color,
          textShadow: `0 0 18px rgba(${hexRgb(activeMeta.color)},.45)`,
          transition: "color 300ms",
        }}
      >
        {activeMeta.label}
      </div>

      {/* ── Arc stage — drag surface + orbs ── */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute", top: 28, left: 0, right: 0, height: 200,
          zIndex: 2, cursor: "grab", touchAction: "none", overflow: "visible",
        }}
      >
        {orbs.map(orb => {
          const m       = MODE_META[MODES[orb.mIdx]];
          // Icon fills the orb now that the label has moved to the centre
          // of the semi-circle. Larger at the centre so the active mode
          // icon reads clearly; smaller orbs still get a healthy glyph.
          const emojiSz = Math.round(orb.size * (orb.isCenter ? 0.55 : 0.5));
          // Beef the chrome up — without the inner label the orb relied on
          // text for legibility. Bump border + fill opacities so the circles
          // remain clearly visible at every distance from centre.
          const borderAlpha = orb.isCenter ? 1 : Math.max(0.35, orb.opacity * 0.55);
          const fillAlpha   = orb.isCenter ? 0.18 : 0.10;
          return (
            <React.Fragment key={orb.key}>
              {/* Glow halo behind active orb */}
              <div style={{
                position: "absolute", left: orb.x, top: orb.y,
                width: orb.size + 28, height: orb.size + 28,
                borderRadius: "50%", transform: "translate(-50%,-50%)",
                background: m.glow,
                opacity: orb.isCenter ? 0.25 : 0,
                pointerEvents: "none",
                animation: orb.isCenter ? "rdGlowPulse 2s ease-in-out infinite" : "none",
              }} />

              {/* Orb button */}
              <div
                role="button"
                aria-label={m.label}
                aria-pressed={orb.isCenter}
                onClick={e => {
                  if (Math.abs(orb.dist) > 0.5) {
                    e.stopPropagation();
                    targetPos.current = Math.round(scrollPos.current) - Math.round(orb.dist);
                    cancelAnim();
                    animateSnap();
                  }
                }}
                style={{
                  position: "absolute", left: orb.x, top: orb.y,
                  width: orb.size, height: orb.size,
                  borderRadius: "50%", transform: "translate(-50%,-50%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: orb.isCenter
                    ? `2px solid ${m.color}`
                    : `1.5px solid rgba(255,255,255,${borderAlpha})`,
                  background: orb.isCenter
                    ? `rgba(${hexRgb(m.color)},${fillAlpha})`
                    : `rgba(255,255,255,${fillAlpha})`,
                  opacity: orb.opacity,
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  cursor: Math.abs(orb.dist) < 0.5 ? "default" : "pointer",
                  pointerEvents: Math.abs(orb.dist) < 1.2 ? "auto" : "none",
                }}
              >
                <span style={{ fontSize: emojiSz, lineHeight: 1 }}>{m.icon}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Mode description ── */}
      <div style={{
        position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
        width: 210, textAlign: "center", fontSize: 11, lineHeight: 1.45,
        color: "rgba(255,255,255,0.32)", pointerEvents: "none", zIndex: 2,
        transition: "opacity 200ms",
      }}>
        {activeMeta.desc}
      </div>

      <style>{`@keyframes rdGlowPulse{0%,100%{opacity:.18}50%{opacity:.35}}`}</style>
    </div>
  );

  // Portal into the swipe deck's session panel so the rolodex inherits its
  // transform (slides off during swipes) and its width.
  return createPortal(rolodex, portalHost);
}

export default ModeRolodex;