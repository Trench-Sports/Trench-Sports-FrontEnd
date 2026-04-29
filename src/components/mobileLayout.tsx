// src/components/mobileLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Layout for /m/* routes (mobile pages). Used by both the Capacitor iOS shell
// and anyone hitting /m/* in a browser. Includes a fixed bottom tab bar that
// keeps navigation inside the /m/* family of routes.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { initTheme, toggleTheme } from "../lib/themeManager.tsx";
import logoDark from "../images/TS.png";
import logoLight from "../images/Trench Sports Logo Power Purple.png";

const NAV_TABS = [
  { label: "Dashboard", to: "/m/dashboard", icon: "⚡" },
  { label: "Sessions",  to: "/m/session",   icon: "📋" },
];

export default function MobileLayout() {
  const loc = useLocation();
  const [theme, setTheme] = useState(() => initTheme());

  // /m/dashboard and /m/session live inside the swipe deck, which needs the
  // <main> to be a bounded box (overflow:hidden + zero padding) so each panel
  // can act as its own scroll container. Other /m/* routes (login, etc.) keep
  // the normal padded scrollable layout.
  const isDeckRoute =
    loc.pathname === "/m" ||
    loc.pathname.startsWith("/m/dashboard") ||
    loc.pathname.startsWith("/m/session");

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

  // Hide the bottom nav on the login screen — it's not useful pre-auth.
  const hideBottomNav = loc.pathname.startsWith("/m/login");

  return (
    <div className="mShell">
      <header
        className="mHeader"
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <img
          src={logoSrc}
          alt="Trench Sports"
          style={{ height: 36, borderRadius: 8, objectFit: "contain" }}
        />
        <span style={{ fontWeight: 950, fontSize: 17, letterSpacing: "-0.01em" }}>
          Trench Sports
        </span>
        <button
          onClick={onToggleTheme}
          className="iconButton"
          aria-label="Toggle theme"
          style={{ width: 36, height: 36 }}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </header>

      <main
        className="mMain"
        style={
          isDeckRoute
            ? {
                // Reset .mMain's gutters & bottom-nav padding so the deck can
                // span edge-to-edge. The panels inside the deck restore the
                // gutters internally.
                padding: 0,
                position: "relative",
                overflow: "hidden",
                // flex:1 + min-height:0 keeps mMain bounded by the shell —
                // critical so each panel can compute height:100% correctly.
                minHeight: 0,
              }
            : undefined
        }
      >
        <Outlet />
      </main>

      {!hideBottomNav && (
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
      )}
    </div>
  );
}
