// src/components/mobileLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Layout for /m/* routes (mobile pages). Used by both the Capacitor iOS shell
// and anyone hitting /m/* in a browser.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { initTheme, toggleTheme } from "../lib/themeManager.tsx";
import logoDark from "../images/TS.png";
import logoLight from "../images/Trench Sports Logo Power Purple.png";

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

  return (
    <div className="mShell">
      <header
        className="mHeader"
        style={{
          // Top padding includes the device safe-area inset so the header's
          // blurred background fills the notch / Dynamic Island region while
          // its contents sit just below it.
          padding: "calc(env(safe-area-inset-top) + 10px) 16px 10px",
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
    </div>
  );
}