// /src/components/themeToggle.jsx

import type { ThemeMode } from "../lib/themeManager"; // adjust path if yours differs

type IconProps = {
  size?: number;
};

function SunIcon({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4 19 19M5 19l-1.4 1.4M20.4 3.6 19 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 13.2A8.5 8.5 0 1 1 10.8 3 6.5 6.5 0 0 0 21 13.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type ThemeToggleProps = {
  theme: ThemeMode | string; // allow string to avoid breaking callers
  onToggle: () => void;
};

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps): JSX.Element {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="iconButton"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}