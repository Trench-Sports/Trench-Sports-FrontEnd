// src/components/brandLoaders.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Brand animations built from the TS mark (from the "TS App Animations" canvas):
//
//  • <OpeningSplash>  — Opening A "draw-in": once per launch on mobile, on
//                        sign-in on desktop.
//  • <LoadingScreen>  — full-screen brand loader (lazy routes, auth gate).
//  • <TsLoader>       — inline tracing mark for lists and cards (96/48/24 px).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import "./brandLoaders.css";

// The mark's geometry, in the logo's own coordinate space.
// Each outline starts mid-way along a straight edge, not on a corner: the
// stroke is dash-drawn, and a dash's two ends meet square, which notches a
// corner but is invisible on a straight run. The S's top sits on the T's
// crossbar line (y 575) so the shared edge draws as one line, and the bolts
// reach the centre of the S outline so they tuck under it with no gap.
const T_POINTS = "645,381 974,381 940,575 741,575 653,1068 408,1068 497,575 283,575 317,381";
const S_POINTS = "905,1172 635,1172 741,575 1283,575 1174,1172";
const BOLT_A = "1024,608 988,806 1241,806 1233,848 872,848";
const BOLT_B = "683,899 1048,899 895,1138 931,939 676,939";
const MARK_VIEWBOX = "255 355 1055 845";
const BOLTS_VIEWBOX = "670 590 580 570";

const SPLASH_MS = 4800;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Module scope, so the launch splash plays once per launch (a cold start
// reloads the bundle) and not again when a route remounts.
let splashPlayed = false;

// Sign-in plays the splash on desktop: login queues it, and the layout's
// <OpeningSplash on="login"> (already mounted) picks it up and covers the
// dashboard while it loads underneath.
let splashQueued = false;
const splashListeners = new Set<() => void>();

export function playOpeningSplash() {
  splashQueued = true;
  splashListeners.forEach((l) => l());
}

export function OpeningSplash({ on = "launch" }: { on?: "launch" | "login" }) {
  const [visible, setVisible] = useState(() =>
    !prefersReducedMotion() && (on === "launch" ? !splashPlayed : splashQueued),
  );

  useEffect(() => {
    if (on !== "login") return;
    const listener = () => { if (!prefersReducedMotion()) setVisible(true); };
    splashListeners.add(listener);
    return () => { splashListeners.delete(listener); };
  }, [on]);

  useEffect(() => {
    if (!visible) return;
    if (on === "launch") splashPlayed = true;
    else splashQueued = false;
    const t = window.setTimeout(() => setVisible(false), SPLASH_MS);
    return () => window.clearTimeout(t);
  }, [visible, on]);

  if (!visible) return null;

  // Tap anywhere to skip. aria-hidden: it's decorative and the app is already
  // mounting underneath it.
  return (
    <div className="tsSplash tsBrand" aria-hidden="true" onClick={() => setVisible(false)}>
      <div className="sp-flash" />
      <svg width="230" height="184" viewBox={MARK_VIEWBOX}>
        <g className="sp-mark">
          <polygon className="sp-t" pathLength={1} points={T_POINTS} />
          <polygon className="sp-s" pathLength={1} points={S_POINTS} />
          <polygon className="sp-b1" points={BOLT_A} />
          <polygon className="sp-b2" points={BOLT_B} />
        </g>
      </svg>
    </div>
  );
}

type Tone = "auto" | "light" | "dark";

/**
 * Inline loader. `size` is the rendered width; 24 and under draws the bolts
 * alone, since the full mark's outline doesn't survive that small.
 * `tone` "auto" follows the app theme; "dark" is for the brand color.
 */
export function TsLoader({
  size = 48,
  tone = "auto",
  label = "Loading",
}: {
  size?: number;
  tone?: Tone;
  label?: string;
}) {
  const cls = `tsMark on-${tone}${size <= 64 ? " is-sm" : ""}`;

  if (size <= 24) {
    return (
      <svg className={cls} width={size} height={size} viewBox={BOLTS_VIEWBOX} role="img" aria-label={label}>
        <polygon className="lx-b" points={BOLT_A} />
        <polygon className="lx-b lx-b2" points={BOLT_B} />
      </svg>
    );
  }

  return (
    <svg className={cls} width={size} height={Math.round(size * 0.8)} viewBox={MARK_VIEWBOX} role="img" aria-label={label}>
      <polygon className="lx-base" points={T_POINTS} />
      <polygon className="lx-trace" pathLength={1} points={T_POINTS} />
      <polygon className="lx-base" points={S_POINTS} />
      <polygon className="lx-trace lx-trace-s" pathLength={1} points={S_POINTS} />
      <polygon className="lx-b" points={BOLT_A} />
      <polygon className="lx-b lx-b2" points={BOLT_B} />
    </svg>
  );
}

/** Full-screen loading screen. Fades in after 300ms so quick loads never flash it. */
export function LoadingScreen() {
  return (
    <div className="tsLoadingScreen tsBrand">
      <TsLoader size={180} tone="dark" label="Trench Sports logo, loading" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className="ld-bar" role="progressbar" aria-label="Loading"><div className="ld-fill" /></div>
        <div className="ld-label">Loading</div>
      </div>
    </div>
  );
}
