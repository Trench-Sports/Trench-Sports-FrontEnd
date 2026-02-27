import React from "react";
import { Outlet } from "react-router-dom";
import TopBar from "./topBar.js"; // if this errors: import { TopBar } from "./topBar.jsx";

export default function MobileLayout() {
  return (
    <div className="mShell">
      <header className="mHeader">
        <TopBar />
      </header>

      <main className="mMain">
        <Outlet />
      </main>

      {/* Optional future bottom nav placeholder */}
      <nav className="mBottomNav">
        <button type="button">Home</button>
        <button type="button">Train</button>
        <button type="button">Insights</button>
      </nav>
    </div>
  );
}