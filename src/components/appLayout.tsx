// src/components/appLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Root layout for all routes. Branches between:
//   • Native iOS/Android (Capacitor) → slim header + bottom tab nav
//   • Web / desktop                  → existing TopBar + mobileShell layout
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import TopBar from "./topBar.js";
import { initTheme, toggleTheme } from "../lib/themeManager.tsx";
import { usePlatform } from "../hooks/usePlatform";

import logoDark from "../images/TS.png";
import logoLight from "../images/Trench Sports Logo Power Purple.png";

// ── Bottom nav tabs — edit labels/icons/routes to match your app ─────────────
const NAV_TABS = [
  { label: "Dashboard", to: "/dashboard", icon: "⚡" },
  { label: "Sessions",  to: "/session",  icon: "📋" },
];

export default function AppLayout() {
  const { isNative } = usePlatform();
  const loc = useLocation();

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
        <header className="mHeader" style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src={logoDark} alt="Trench Sports" style={{ height: 36, borderRadius: 8, objectFit: "contain" }} />
          <span style={{ fontWeight: 950, fontSize: 17, letterSpacing: "-0.01em" }}>Trench Sports</span>
          {/* Theme toggle still accessible on native if desired */}
          <button
            onClick={onToggleTheme}
            className="iconButton"
            aria-label="Toggle theme"
            style={{ width: 36, height: 36 }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </header>

        {/* Page content — padding-bottom leaves room for the fixed nav */}
        <main className="mMain">
          <Outlet />
        </main>

        {/* Fixed bottom tab bar */}
        <nav className="mBottomNav">
          {NAV_TABS.map((tab) => {
            const active = loc.pathname.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  padding: "8px 4px",
                  borderRadius: 14,
                  border: `1px solid ${active ? "rgba(180,0,255,0.38)" : "rgba(255,255,255,0.12)"}`,
                  background: active ? "rgba(180,0,255,0.14)" : "rgba(255,255,255,0.05)",
                  color: active ? "#b400ff" : "inherit",
                  textDecoration: "none",
                  fontSize: 11,
                  fontWeight: 900,
                  WebkitUserSelect: "none",
                  userSelect: "none",
                }}
              >
                <span style={{ fontSize: 20 }}>{tab.icon}</span>
                {tab.label}
              </Link>
            );
          })}
        </nav>
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