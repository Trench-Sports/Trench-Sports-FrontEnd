// src/components/mobileSwipeDeck.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Native-feeling horizontal swipe deck for the mobile pages. Mounts both the
// dashboard and session pages once, then slides between them via touch/pointer
// drag — so either neighbor is already painted offscreen and gets revealed in
// real time as the finger drags.
//
// • Drag to peek both pages at once (preview).
// • Release past 20% of the viewport (or with a fast flick) snaps to the next
//   page, otherwise rubber-bands back.
// • Edge resistance when trying to swipe past the first/last page.
// • Vertical scrolls inside a page still work — the gesture commits to "swipe"
//   only when horizontal motion dominates.
// • External navigations (bottom-tab tap, in-page navigate(), back/forward)
//   animate to the matching page automatically.
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
const PAGE_PCT = 100 / COUNT; // each panel occupies this % of the track

// ── Context exposed to descendants ──────────────────────────────────────────
// Used by ModeRolodex (rendered deep inside session.tsx) to portal itself into
// the session panel so it sits within the swipe deck's coordinate system —
// matching the panel's width, sliding off with it during a swipe, and being
// invisible while the dashboard panel is active.
export type SwipeDeckCtx = {
  sessionPanelEl: HTMLDivElement | null;
};
export const SwipeDeckContext = createContext<SwipeDeckCtx>({ sessionPanelEl: null });

// Tunables
const DECIDE_THRESHOLD_PX  = 12;   // movement before we commit to swipe vs scroll
const SNAP_THRESHOLD_RATIO = 0.20; // |dx| > 20% of viewport ⇒ go to next page
const FLICK_VELOCITY_PXMS  = 0.45; // |v| above this ⇒ go to next page even if dx small
const EDGE_RESISTANCE      = 0.35; // rubber-band factor at first/last page
const TRANSITION_MS        = 320;
const TRANSITION_EASE      = "cubic-bezier(.32,.72,0,1)"; // iOS-ish

function pathToIndex(p: string) {
  const idx = PAGES.findIndex((pg) => p.startsWith(pg.path));
  return idx < 0 ? 0 : idx;
}

export default function MobileSwipeDeck() {
  const loc = useLocation();
  const navigate = useNavigate();

  const [activeIndex, setActiveIndex] = useState(() => pathToIndex(loc.pathname));
  const [dragDelta, setDragDelta] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  // Sync activeIndex when something else changes the URL (bottom tabs,
  // in-page navigate calls, browser back/forward).
  useEffect(() => {
    const idx = pathToIndex(loc.pathname);
    setActiveIndex((prev) => {
      if (prev === idx) return prev;
      // Animate to the new page rather than jumping.
      setTransitioning(true);
      return idx;
    });
  }, [loc.pathname]);

  // Measure container width so we can convert px drag → % of track.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // The session panel element — portal target for the rolodex (and any other
  // deck-anchored overlay we add later). Stored in state so descendants
  // re-render when it becomes available.
  const [sessionPanelEl, setSessionPanelEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // ── Pointer/touch handling ────────────────────────────────────────────────
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const decidedRef = useRef<null | "swipe" | "scroll">(null);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore non-primary buttons (right-click etc).
    if (e.button !== undefined && e.button !== 0) return;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startTimeRef.current = performance.now();
    decidedRef.current = null;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startTimeRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    // Decide intent on first significant move.
    if (decidedRef.current === null) {
      if (Math.abs(dx) > DECIDE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
        decidedRef.current = "swipe";
        setTransitioning(false);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* setPointerCapture can throw if the pointer is already released */
        }
      } else if (Math.abs(dy) > DECIDE_THRESHOLD_PX) {
        decidedRef.current = "scroll";
      }
    }

    if (decidedRef.current !== "swipe") return;

    const idx = activeIndexRef.current;
    const atLeftEdge  = idx === 0          && dx > 0;
    const atRightEdge = idx === COUNT - 1  && dx < 0;
    const resisted = (atLeftEdge || atRightEdge) ? dx * EDGE_RESISTANCE : dx;
    setDragDelta(resisted);
  }, []);

  const finishGesture = useCallback(() => {
    const wasSwipe = decidedRef.current === "swipe";
    const elapsed = Math.max(1, performance.now() - startTimeRef.current);
    decidedRef.current = null;
    startTimeRef.current = 0;

    if (!wasSwipe) {
      // Wasn't a swipe — make sure no leftover translation is showing.
      setDragDelta(0);
      return;
    }

    const dx = dragDelta;
    const v = dx / elapsed; // px per ms
    const w = width || 1;
    const passed =
      Math.abs(dx) > w * SNAP_THRESHOLD_RATIO ||
      Math.abs(v)  > FLICK_VELOCITY_PXMS;

    const idx = activeIndexRef.current;
    let next = idx;
    if (passed) {
      if (dx < 0 && idx < COUNT - 1) next = idx + 1;
      else if (dx > 0 && idx > 0)    next = idx - 1;
    }

    setTransitioning(true);
    setDragDelta(0);

    if (next !== idx) {
      setActiveIndex(next);
      // `replace` so swiping doesn't pollute the back stack with every page
      // the user passes through.
      navigate(PAGES[next].path, { replace: true });
    }
  }, [dragDelta, navigate, width]);

  const onPointerUp = useCallback(() => {
    finishGesture();
  }, [finishGesture]);

  const onPointerCancel = useCallback(() => {
    finishGesture();
  }, [finishGesture]);

  // ── Translate math ────────────────────────────────────────────────────────
  // Track is COUNT × 100% of the container; translate is expressed as % of
  // track width. Dragging by dx px corresponds to a track-fraction of
  // (dx / containerWidth) × (1 / COUNT).
  const dragPct = width ? (dragDelta / width) * PAGE_PCT : 0;
  const translatePct = -activeIndex * PAGE_PCT + dragPct;

  return (
    <SwipeDeckContext.Provider value={{ sessionPanelEl }}>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          // Fills .mMain (which we set to overflow:hidden + position:relative
          // for deck routes in MobileLayout). The deck owns the bounded box
          // so panels can be height:100% scrolling containers.
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          // Allow vertical scrolls to pass through; we own horizontal pans.
          touchAction: "pan-y",
        }}
      >
        <div
          style={{
            display: "flex",
            width: `${COUNT * 100}%`,
            height: "100%",
            transform: `translate3d(${translatePct}%, 0, 0)`,
            transition: transitioning
              ? `transform ${TRANSITION_MS}ms ${TRANSITION_EASE}`
              : "none",
            willChange: "transform",
          }}
          onTransitionEnd={() => setTransitioning(false)}
        >
          {PAGES.map((p, i) => {
            const isActive = i === activeIndex;
            const isSession = p.path === "/m/session";
            // Each panel splits into two layers:
            //   • Outer (this div) — non-scrolling, position:relative. This is
            //     the portal host for overlays like the ModeRolodex, so they
            //     anchor to the panel's *visible* bottom and stay pinned there
            //     regardless of how far the user scrolls inside the page.
            //   • Inner — scrolling container that holds the actual page
            //     content. This is the only thing that moves on scroll.
            // The horizontal swipe transform lives on the parent flex row, so
            // both layers still slide together during a page swipe — no
            // fixed-to-viewport mismatch.
            return (
              <div
                key={p.path}
                ref={isSession ? setSessionPanelEl : undefined}
                // `inert` is the correct primitive for "off-screen panel":
                // it removes the subtree from the a11y tree, moves focus out
                // of it, AND blocks pointer/keyboard input — all of which we
                // want for the inactive deck pages. We previously used
                // aria-hidden, but the browser blocks aria-hidden when a
                // descendant still has focus (e.g. a button the user just
                // tapped before the deck swiped away), which fires a console
                // warning. `inert` handles that case cleanly by stealing focus
                // back to the active panel.
                // React 18 doesn't have `inert` in its boolean-attribute
                // allowlist (that landed in React 19), so passing a boolean
                // triggers a "non-boolean attribute" warning. Passing the
                // empty string is the spec-correct way to enable a boolean
                // HTML attribute, and React will round-trip it as `inert=""`.
                {...(!isActive ? { inert: "" } : {})}
                style={{
                  width: `${100 / COUNT}%`,
                  flexShrink: 0,
                  height: "100%",
                  position: "relative",
                  overflow: "hidden",
                  // pointerEvents is now redundant with inert, but kept as a
                  // belt-and-suspenders for any browser that hasn't shipped
                  // inert yet (caniuse: ≥ 96% global as of 2024).
                  pointerEvents: isActive ? "auto" : "none",
                  boxShadow: isActive
                    ? "none"
                    : "inset 0 0 60px rgba(0,0,0,0.18)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    overflowY: "auto",
                    overflowX: "hidden",
                    WebkitOverflowScrolling: "touch",
                    // Restore the page gutters and bottom-nav clearance that
                    // .mMain used to provide before we zeroed it out for deck
                    // routes.
                    padding: "12px 12px 80px",
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
