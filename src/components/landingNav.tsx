// src/components/landingNav.tsx
// Scroll-tracking nav — fixed LEFT-edge ghost overlay.
// Floats over page content, zero layout impact.
// No auth buttons, no CTAs.

import React, { useState } from "react";

export type NavSection = {
  id: string;
  label: string;
};

export const LANDING_NAV_SECTIONS: NavSection[] = [
  { id: "hero",          label: "Home"         },
  { id: "how-it-works",  label: "How It Works" },
  { id: "platform",      label: "Platform"     },
  { id: "proof",         label: "Results"      },
  { id: "use-cases",     label: "Use Cases"    },
  { id: "testimonials",  label: "Athletes Say" },
];

type LandingNavProps = {
  activeSection: string;
};

export default function LandingNav({ activeSection }: LandingNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileOpen(false);
  };

  const activeIdx = LANDING_NAV_SECTIONS.findIndex((s) => s.id === activeSection);
  const fillPct = Math.max(((activeIdx + 1) / LANDING_NAV_SECTIONS.length) * 100, 8);

  return (
    <>
      {/* ── Desktop: fixed LEFT-edge ghost overlay ────────────────────── */}
      <aside className="lnav-overlay" aria-label="Page sections">
        <nav className="lnav-nav">
          {/* Vertical progress track — left side of list */}
          <div className="lnav-track">
            <div className="lnav-trackFill" style={{ height: `${fillPct}%` }} />
          </div>

          <ul className="lnav-list">
            {LANDING_NAV_SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <li key={s.id}>
                  <button
                    className={`lnav-item ${isActive ? "lnav-item--active" : ""}`}
                    onClick={() => scrollTo(s.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {/* Dot LEFT, label RIGHT — natural left-to-right read */}
                    <span className="lnav-dot" />
                    <span className="lnav-label">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* ── Mobile: floating pill bottom-left ─────────────────────────── */}
      <button
        className="lnav-mobilePill"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label="Navigate page sections"
      >
        <span className={`lnav-pillDot ${mobileOpen ? "lnav-pillDot--open" : ""}`} />
        <span className="lnav-pillLabel">
          {LANDING_NAV_SECTIONS[activeIdx]?.label ?? "Navigate"}
        </span>
        <span className={`lnav-pillChevron ${mobileOpen ? "lnav-pillChevron--open" : ""}`}>▾</span>
      </button>

      {mobileOpen && (
        <div className="lnav-mobileDrawer" role="dialog" aria-label="Page navigation">
          <ul className="lnav-mobileList">
            {LANDING_NAV_SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <li key={s.id}>
                  <button
                    className={`lnav-mobileItem ${isActive ? "lnav-mobileItem--active" : ""}`}
                    onClick={() => scrollTo(s.id)}
                  >
                    <span className="lnav-mobileDot" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}