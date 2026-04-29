// src/components/mobileSwipeDeck.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Native-feeling horizontal swipe deck for the mobile pages. Mounts both the
// dashboard and session pages once, then slides between them via touch/pointer
// drag — so either neighbor is already painted offscreen and gets revealed in
// real time as the finger drags.
//
// ── Performance model ────────────────────────────────────────────────────────
// The previous version called setDragDelta() on every pointermove, which sends
// every finger movement through the full React render → reconcile → commit
// pipeline. On iOS that lag is visible: the page lags 1-2 frames behind the
// finger even on a fast device.
//
// This version bypasses React state entirely during the drag and writes
// style.transform directly on the track DOM element via trackRef. React state
// (activeIndex, transitioning) only changes at gesture commit — snap or
// rubber-band back — which is at most once per swipe gesture.
//
// The scroll-vs-swipe disambiguation, edge resistance, snap threshold, and
// flick velocity logic are all preserved from the original.
//
// ── Public surface ───────────────────────────────────────────────────────────
// • Drag to peek both pages (preview) in real time.
// • Release past 20 % of the viewport (or flick) snaps to the next page;
//   otherwise rubber-bands back with the same spring curve.
// • Bottom-tab taps and navigate() calls animate to the correct page.
// ─────────────────────────────────────────────────────────────────────────────
import React, {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import MobileDashboard from "../pages/mobile/dashboard";
import MobileSession from "../pages/mobile/session";

type DeckPage = {
  path: string;
  node: React.ReactNode;
};

const PAGES: DeckPage[] = [
  { path: "/m/dashboard", node: <MobileDashboard /> },
  { path: "/m/session",   node: <MobileSession />   },
];
const COUNT = PAGES.length;

// ── Context exposed to descendants ──────────────────────────────────────────
export type SwipeDeckCtx = {
  sessionPanelEl: HTMLDivElement | null;
};
export const SwipeDeckContext = createContext<SwipeDeckCtx>({ sessionPanelEl: null });

// ── Tunables ─────────────────────────────────────────────────────────────────
const DECIDE_THRESHOLD_PX  = 8;    // px before committing to swipe vs scroll (was 12 — lower feels snappier)
const SNAP_THRESHOLD_RATIO = 0.20; // |dx| > 20 % viewport → snap to next page
const FLICK_VELOCITY_PXMS  = 0.35; // px/ms above this → snap even if dx is small (was 0.45)
const EDGE_RESISTANCE      = 0.20; // rubber-band factor at first/last page (was 0.35 — tighter)
const TRANSITION_MS        = 380;  // snap/rubber-band animation duration
// iOS scroll spring: fast out, gentle settle. Matches UIScrollView's default.
const TRANSITION_EASE      = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

function pathToIndex(p: string) {
  const idx = PAGES.findIndex((pg) => p.startsWith(pg.path));
  return idx < 0 ? 0 : idx;
}

// ── Direct-DOM transform helper ───────────────────────────────────────────────
// Writes the track's CSS transform without touching React state.
// `dx`      — additional pixel offset on top of the active-page base position
// `animate` — whether to apply the snap CSS transition
function applyTransform(
  el: HTMLDivElement,
  activeIndex: number,
  containerWidth: number,
  dx: number,
  animate: boolean,
) {
  const base = -activeIndex * containerWidth; // px from origin to active panel's left edge
  el.style.transition = animate
    ? `transform ${TRANSITION_MS}ms ${TRANSITION_EASE}`
    : "none";
  // translate3d promotes to a GPU layer and avoids triggering layout.
  el.style.transform = `translate3d(${base + dx}px, 0, 0)`;
}

export default function MobileSwipeDeck() {
  const loc      = useLocation();
  const navigate = useNavigate();

  // ── React state (changes at most once per gesture) ────────────────────────
  const [activeIndex,   setActiveIndex]   = useState(() => pathToIndex(loc.pathname));
  const [sessionPanelEl, setSessionPanelEl] = useState<HTMLDivElement | null>(null);

  // ── Refs — mutated during the drag, never cause re-renders ───────────────
  const containerRef    = useRef<HTMLDivElement>(null);
  const trackRef        = useRef<HTMLDivElement>(null);
  const widthRef        = useRef(0);           // container width in px
  const activeIndexRef  = useRef(activeIndex); // shadow of state for use in event handlers
  const dragDeltaRef    = useRef(0);           // current drag offset in px
  const isAnimatingRef  = useRef(false);       // true while CSS transition is running

  // Gesture tracking refs
  const startXRef    = useRef(0);
  const startYRef    = useRef(0);
  const startTimeRef = useRef(0);
  const decidedRef   = useRef<null | "swipe" | "scroll">(null);

  // Keep activeIndexRef in sync whenever React commits a state update.
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

  // ── Container sizing ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        widthRef.current = containerRef.current.clientWidth;
      }
    };
    measure();
    // ResizeObserver is more efficient than window resize for this use-case.
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Sync active page when URL changes externally ──────────────────────────
  // (bottom-tab tap, navigate() call, browser back/forward)
  useEffect(() => {
    const idx = pathToIndex(loc.pathname);
    if (idx === activeIndexRef.current) return;

    // Animate to the new page.
    const el = trackRef.current;
    if (el) {
      isAnimatingRef.current = true;
      applyTransform(el, idx, widthRef.current, 0, /* animate */ true);
    }
    setActiveIndex(idx);
  }, [loc.pathname]);

  // ── Re-apply base transform whenever activeIndex changes ─────────────────
  // This covers the case where React re-renders (e.g. theme toggle) after a
  // snap — we need the transform to match the (possibly new) container width.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || isAnimatingRef.current) return; // don't clobber mid-animation
    applyTransform(el, activeIndex, widthRef.current, 0, false);
  }, [activeIndex]);

  // ── Pointer down — record start position ─────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    startXRef.current    = e.clientX;
    startYRef.current    = e.clientY;
    startTimeRef.current = performance.now();
    decidedRef.current   = null;
    dragDeltaRef.current = 0;
  }, []);

  // ── Pointer move — mutate DOM directly, zero React involvement ────────────
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startTimeRef.current) return;

    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    // Disambiguate swipe vs scroll on first significant movement.
    if (decidedRef.current === null) {
      const horizontal = Math.abs(dx) > Math.abs(dy);
      if (Math.abs(dx) > DECIDE_THRESHOLD_PX && horizontal) {
        decidedRef.current = "swipe";
        // Cancel any in-progress snap animation so the page follows the finger.
        isAnimatingRef.current = false;
        const el = trackRef.current;
        if (el) el.style.transition = "none";
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer may already be released */
        }
      } else if (Math.abs(dy) > DECIDE_THRESHOLD_PX) {
        decidedRef.current = "scroll";
      }
      return; // don't move anything until we've decided
    }

    if (decidedRef.current !== "swipe") return;

    const idx = activeIndexRef.current;
    const atLeftEdge  = idx === 0         && dx > 0;
    const atRightEdge = idx === COUNT - 1 && dx < 0;
    const resisted = (atLeftEdge || atRightEdge) ? dx * EDGE_RESISTANCE : dx;

    dragDeltaRef.current = resisted;

    // ← The critical change: write to the DOM directly, no setState. →
    const el = trackRef.current;
    if (el) applyTransform(el, idx, widthRef.current, resisted, false);
  }, []);

  // ── Commit gesture: snap to page or rubber-band back ─────────────────────
  const commitGesture = useCallback(() => {
    if (decidedRef.current !== "swipe") {
      decidedRef.current   = null;
      startTimeRef.current = 0;
      return;
    }

    const dx      = dragDeltaRef.current;
    const elapsed = Math.max(1, performance.now() - startTimeRef.current);
    decidedRef.current   = null;
    startTimeRef.current = 0;
    dragDeltaRef.current = 0;

    const v = dx / elapsed; // px/ms
    const w = widthRef.current || 1;
    const passed =
      Math.abs(dx) > w * SNAP_THRESHOLD_RATIO ||
      Math.abs(v)  > FLICK_VELOCITY_PXMS;

    const idx  = activeIndexRef.current;
    let   next = idx;
    if (passed) {
      if (dx < 0 && idx < COUNT - 1) next = idx + 1;
      else if (dx > 0 && idx > 0)    next = idx - 1;
    }

    // Animate to the target page (could be the same page for rubber-band).
    isAnimatingRef.current = true;
    const el = trackRef.current;
    if (el) applyTransform(el, next, widthRef.current, 0, /* animate */ true);

    if (next !== idx) {
      setActiveIndex(next);
      activeIndexRef.current = next;
      navigate(PAGES[next].path, { replace: true });
    }
  }, [navigate]);

  const onPointerUp     = useCallback(() => commitGesture(), [commitGesture]);
  const onPointerCancel = useCallback(() => commitGesture(), [commitGesture]);

  // ── Clear isAnimatingRef when the CSS transition ends ────────────────────
  // We use a DOM event listener (not React's onTransitionEnd prop) so it fires
  // even when the element is re-used across renders without unmounting.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") isAnimatingRef.current = false;
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, []);

  return (
    <SwipeDeckContext.Provider value={{ sessionPanelEl }}>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          // Allow vertical scrolls to pass through; we own horizontal pans.
          touchAction: "pan-y",
        }}
      >
        {/*
         * Track — width is COUNT × container. We start it at the correct
         * position synchronously in the useLayoutEffect above, then only ever
         * move it with direct style mutations (during drag) or the CSS
         * transition (on snap). React never touches the transform after mount.
         *
         * willChange: "transform" tells the compositor to promote this layer
         * to a GPU tile so transforms are applied on the compositor thread,
         * completely off the main thread during the snap animation.
         */}
        <div
          ref={trackRef}
          style={{
            display:    "flex",
            width:      `${COUNT * 100}%`,
            height:     "100%",
            willChange: "transform",
            // Initial transform is set imperatively in useLayoutEffect.
            // Setting it here too avoids a flash before layout runs.
            transform:  `translate3d(${-activeIndex * (widthRef.current || 0)}px, 0, 0)`,
          }}
        >
          {PAGES.map((p, i) => {
            const isActive  = i === activeIndex;
            const isSession = p.path === "/m/session";
            return (
              <div
                key={p.path}
                ref={isSession ? setSessionPanelEl : undefined}
                {...(!isActive ? { inert: "" } : {})}
                style={{
                  width:        `${100 / COUNT}%`,
                  flexShrink:   0,
                  height:       "100%",
                  position:     "relative",
                  overflow:     "hidden",
                  pointerEvents: isActive ? "auto" : "none",
                  // Subtle shadow on the offscreen panel so pages feel stacked.
                  boxShadow:    isActive
                    ? "none"
                    : "inset 0 0 60px rgba(0,0,0,0.18)",
                }}
              >
                <div
                  style={{
                    height:                  "100%",
                    overflowY:               "auto",
                    overflowX:               "hidden",
                    WebkitOverflowScrolling: "touch",
                    padding:                 "12px 12px 80px",
                  }}
                >
                  {p.node}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SwipeDeckContext.Provider>
  );
}