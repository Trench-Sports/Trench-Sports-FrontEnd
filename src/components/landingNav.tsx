// src/components/landingNav.tsx
// Small-screen section nav — a floating pill bottom-left that opens a drawer.
// On wider screens the same sections live in the TopBar instead (see
// SectionNav in topBar.tsx), so this renders nothing there.

import React, { useState } from "react";
import { LANDING_NAV_SECTIONS, scrollToSection } from "../lib/landingSections";
import { useActiveSection } from "../hooks/useActiveSection";

export default function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeSection = useActiveSection(LANDING_NAV_SECTIONS.map((s) => s.id));

  const scrollTo = (id: string) => {
    scrollToSection(id);
    setMobileOpen(false);
  };

  const activeIdx = LANDING_NAV_SECTIONS.findIndex((s) => s.id === activeSection);

  return (
    <>
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