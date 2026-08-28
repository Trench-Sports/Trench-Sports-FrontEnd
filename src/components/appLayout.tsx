// src/components/appLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Root layout for all routes. Branches between:
//   • Native iOS/Android (Capacitor) → slim header + bottom tab nav
//   • Web / desktop                  → existing TopBar + mobileShell layout
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import TopBar from "./topBar.js";
import { initTheme, toggleTheme } from "../lib/themeManager";
import { usePlatform } from "../hooks/usePlatform";
import { useScrollToTop } from "../hooks/useScrollToTop";

import logoDark from "../images/NEW Master TS Logo Enhancement Set 1-03.png";
import logoLight from "../images/NEW Master TS Logo Enhancement Set 1-01.png";
import { IconSun, IconMoon } from "./icons";

// ── Bottom nav tabs — point at the /m/* routes so native taps stay on the
//    mobile pages even if the shell ever falls through to AppLayout.

export default function AppLayout() {
  const { isNative } = usePlatform();

  // Land every pushed route at the top — called before the native branch so it
  // covers both shells.
  useScrollToTop();

  // ── Theme (web only — native doesn't need a toggle) ──────────────────────
  const [theme, setTheme] = useState(() => initTheme());

  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      const t = (root.getAttribute("data-theme") || "dark").toLowerCase();
      if (t === "light" || t === "dark") setTheme(t);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const onToggleTheme = () => setTheme((t) => toggleTheme(t));
  const logoSrc = theme === "dark" ? logoDark : logoLight;

  // ── Native shell (iOS / Android) ─────────────────────────────────────────
  if (isNative) {
    return (
      <div className="mShell">
        {/* Slim native header — just the logo/title, no sidebar links */}
        <header className="mHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src={logoDark} alt="Trench Sports" style={{ height: 36, borderRadius: 8, objectFit: "contain" }} />
          <span style={{ fontWeight: 950, fontSize: 17, letterSpacing: "-0.01em" }}>Trench Sports</span>
          {/* Theme toggle still accessible on native if desired */}
          <button
            onClick={onToggleTheme}
            className="iconButton"
            aria-label="Toggle theme"
            style={{ width: 36, height: 36 }}
          >
            {theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
        </header>

        {/* Page content — padding-bottom leaves room for the fixed nav */}
        <main className="mMain">
          <Outlet />
        </main>


      </div>
    );
  }

  // ── Web / desktop shell (unchanged from your original) ───────────────────
  return (
    <div className="mobileShell">
      <header className="mobileHeader">
        <TopBar theme={theme} onToggleTheme={onToggleTheme} logoSrc={logoSrc} />
      </header>

      <main className="mobileMain">
        <div className="pageContainer">
          <Outlet />
        </div>
      </main>
    </div>
  );
}