// src/components/dashboardTour.tsx
//
// Guided "how to use the dashboard" tour. A modal card walks the coach through
// each area of the desktop dashboard; steps with a target switch to the right
// tab and spotlight that element (a fixed "hole" with a giant box-shadow, so it
// works regardless of the target's stacking context).
//
// Targets are found by `data-tour="<id>"` attributes in pages/dashboard.tsx.
// Opens automatically the first time a user lands on the dashboard; the "Tour"
// button in the dashboard header replays it.
import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TabKey } from "../hooks/useCoachDashboard";

const ACCENT = "#b400ff";
const SEEN_KEY_PREFIX = "ts-dashTour-v1";

type TourStep = {
  title: string;
  body: React.ReactNode;
  /** data-tour id to spotlight; omitted for centered intro/outro steps. */
  target?: string;
  /** Tab to switch to before spotlighting. */
  tab?: TabKey;
};

const STEPS: TourStep[] = [
  {
    title: "Welcome to your dashboard",
    body: (
      <>
        This is where every session your athletes record ends up. Take a quick
        tour to see where things live — it takes under a minute, and you can
        skip anytime.
      </>
    ),
  },
  {
    title: "Your profile & program",
    target: "profile",
    body: (
      <>
        Your name, role and program at a glance. Use <strong>Edit Profile</strong> to
        update your details, and <strong>View Program</strong> to see your plan and
        coaching staff.
      </>
    ),
  },
  {
    title: "Three dashboard sections",
    target: "tabs",
    tab: "recent",
    body: (
      <>
        The dashboard is split into three tabs: <strong>Recent Session</strong>,{" "}
        <strong>Insights and Analysis</strong>, and <strong>Individual Athletes</strong>.
        We'll walk through each one.
      </>
    ),
  },
  {
    title: "Recent Session",
    target: "content",
    tab: "recent",
    body: (
      <>
        Your latest sessions, the strike heatmap from the bag, coaching insights,
        in-depth analysis for any athlete, and charts comparing athletes or teams
        week over week. Click a session to open it.
      </>
    ),
  },
  {
    title: "Insights and Analysis",
    target: "content",
    tab: "insights",
    body: (
      <>
        Program-wide leaderboards for strength, reaction time, accuracy and
        volume, plus who's improving most. Change the date range or metric from
        the card header; click an athlete to jump to their sessions.
      </>
    ),
  },
  {
    title: "Individual Athletes",
    target: "content",
    tab: "athletes",
    body: (
      <>
        Your full roster and teams. Filter by name, open an athlete to edit
        their details, and create or manage teams to group athletes together.
      </>
    ),
  },
  {
    title: "Quick actions",
    target: "actions",
    tab: "recent",
    body: (
      <>
        <strong>New Session</strong> connects to a bag and starts recording.{" "}
        <strong>Add Athlete</strong> creates a single athlete; admins can also{" "}
        <strong>Import Roster</strong> from a CSV.
      </>
    ),
  },
  {
    title: "You're all set",
    target: "tour-button",
    body: (
      <>
        That's the tour. You can replay it anytime with the <strong>Tour</strong>{" "}
        button here.
      </>
    ),
  },
];

function seenKey(userId: string | null | undefined) {
  return `${SEEN_KEY_PREFIX}:${userId ?? "anon"}`;
}

export function hasSeenDashboardTour(userId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return true; // storage blocked — don't nag on every visit
  }
}

function markDashboardTourSeen(userId: string | null | undefined) {
  try {
    localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* storage unavailable — nothing here is load-bearing */
  }
}

type Rect = { top: number; left: number; width: number; height: number };

const SPOT_PAD = 8;
const CARD_W = 380;

function measure(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  // Tab content can be thousands of px tall; clamp the spotlight to the
  // viewport so the card still has somewhere to sit.
  const top = Math.max(r.top - SPOT_PAD, 8);
  const bottom = Math.min(r.bottom + SPOT_PAD, window.innerHeight - 8);
  return {
    top,
    left: Math.max(r.left - SPOT_PAD, 8),
    width: Math.min(r.width + SPOT_PAD * 2, window.innerWidth - 16),
    height: Math.max(bottom - top, 40),
  };
}

// Place the card below the spotlight, else above, else pinned to the bottom.
function cardPosition(rect: Rect | null): React.CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 32);
  const left = Math.min(Math.max(rect.left, 16), vw - width - 16);
  const roomBelow = vh - (rect.top + rect.height);
  if (roomBelow >= 240) return { top: rect.top + rect.height + 12, left };
  if (rect.top >= 240) return { bottom: vh - rect.top + 12, left };
  return { bottom: 24, left: "50%", transform: "translateX(-50%)" };
}

export interface DashboardTourProps {
  open: boolean;
  onClose: () => void;
  setActiveTab: (tab: TabKey) => void;
  userId: string | null | undefined;
}

export function DashboardTour({ open, onClose, setActiveTab, userId }: DashboardTourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = useCallback(() => {
    markDashboardTourSeen(userId);
    onClose();
  }, [userId, onClose]);

  // Switch tab, scroll the target into view, then measure it. The tab content
  // remounts on switch, so measure on the next frame (and again after the
  // smooth scroll settles).
  useLayoutEffect(() => {
    if (!open) return;
    if (current.tab) setActiveTab(current.tab);
    setRect(null);
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const el = current.target
        ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
        : null;
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      setRect(measure(current.target));
    });
    const settle = window.setTimeout(() => !cancelled && setRect(measure(current.target)), 450);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [open, step, current.tab, current.target, setActiveTab]);

  useEffect(() => {
    if (!open) return;
    const remeasure = () => setRect(measure(current.target));
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open, current.target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ts-tour-title"
      style={{ position: "fixed", inset: 0, zIndex: 1000 }}
    >
      <style>{`
        @keyframes tsTourIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .ts-tourCard{animation:tsTourIn .22s ease-out}
        .ts-tourSpot{transition:top .25s ease,left .25s ease,width .25s ease,height .25s ease}
        @media (prefers-reduced-motion: reduce){.ts-tourCard{animation:none}.ts-tourSpot{transition:none}}
      `}</style>

      {/* Backdrop: a spotlight hole when there's a target, a plain dim otherwise.
          Clicks are swallowed so the dashboard can't be used mid-tour. */}
      {rect ? (
        <div
          className="ts-tourSpot"
          aria-hidden="true"
          style={{
            position: "fixed",
            top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            borderRadius: 14,
            boxShadow: `0 0 0 2px ${ACCENT}, 0 0 24px 4px rgba(180,0,255,0.35), 0 0 0 9999px rgba(7,7,10,0.62)`,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(7,7,10,0.62)", backdropFilter: "blur(3px)" }} />
      )}
      <div style={{ position: "fixed", inset: 0 }} />

      <div
        key={step}
        className="ts-tourCard"
        style={{
          position: "fixed",
          ...cardPosition(rect),
          width: `min(${CARD_W}px, calc(100vw - 32px))`,
          boxSizing: "border-box",
          background: "linear-gradient(var(--panel), var(--panel)), var(--bg)",
          border: "1px solid var(--panel-border)",
          borderRadius: 16,
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(180,0,255,0.14)",
          padding: 18,
          color: "var(--text)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT }}>
            Dashboard tour · {step + 1} of {STEPS.length}
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Close tour"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: 4 }}
          >✕</button>
        </div>

        <h2 id="ts-tour-title" style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 900, letterSpacing: "0.01em" }}>
          {current.title}
        </h2>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, opacity: 0.92 }}>{current.body}</div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
          <div style={{ display: "flex", gap: 5 }} aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === step ? 16 : 6, height: 6, borderRadius: 3,
                  background: i === step ? ACCENT : "var(--panel-border)",
                  transition: "width .2s ease, background .2s ease",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 0 ? (
              <button type="button" className="ts-btn ts-btnGhost" onClick={finish}>Skip</button>
            ) : (
              <button type="button" className="ts-btn ts-btnGhost" onClick={() => setStep(step - 1)}>Back</button>
            )}
            <button
              type="button"
              className="ts-btn ts-btnPrimary"
              autoFocus
              onClick={() => (isLast ? finish() : setStep(step + 1))}
            >
              {isLast ? "Done" : step === 0 ? "Start tour" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default DashboardTour;
