// src/pages/mobile/layout.tsx
import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import TopBar from "../../components/topBar.js";

import darkLogo from "../../images/TS.png";
import lightLogo from "../../images/Trench Sports Logo Power Purple.png";

export default function MobileLayout({
  theme,
  onToggleTheme,
}: {
  theme: string;
  onToggleTheme: () => void;
}) {
  const logoSrc = theme === "light" ? lightLogo : darkLogo;

  return (
    <div className="mobileShell">
      <div className="mobileHeader">
        <TopBar theme={theme} onToggleTheme={onToggleTheme} logoSrc={logoSrc} />
      </div>

      <main className="mobileMain">
        <Outlet />
      </main>

      <nav className="mobileTabs">
        <NavLink to="/m/dashboard" className={({ isActive }) => `mobileTab ${isActive ? "active" : ""}`}>
          Dashboard
        </NavLink>
        <NavLink to="/m/device" className={({ isActive }) => `mobileTab ${isActive ? "active" : ""}`}>
          Device
        </NavLink>
        <NavLink to="/m/settings" className={({ isActive }) => `mobileTab ${isActive ? "active" : ""}`}>
          Settings
        </NavLink>
      </nav>
    </div>
  );
}