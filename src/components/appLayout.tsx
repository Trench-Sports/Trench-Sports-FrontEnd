import React, { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import TopBar from "./topBar.js";
import { initTheme, toggleTheme } from "../lib/themeManager.tsx";

import logoDark from "../images/TS.png";
import logoLight from "../images/Trench Sports Logo Power Purple.png";

export default function AppLayout() {
  const [theme, setTheme] = useState(() => initTheme());

  // If theme changes elsewhere (rare), keep UI in sync
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