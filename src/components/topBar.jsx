// topBar.jsx
import React from "react";
import ThemeToggle from "./themeToggle.jsx";

export default function TopBar({ theme, onToggleTheme, logoSrc }) {
  return (
    <div className="topBar">
      <div className="topBarLeft">
        {logoSrc ? (
          <img className="topBarLogo" src={logoSrc} alt="Trench Sports logo" />
        ) : (
          <div className="topBarLogoFallback" aria-hidden="true" />
        )}

        <div className="topBarTitle">Trench Sports</div>
      </div>

      <div className="topBarRight">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </div>
  );
}
