// src/lib/themeManager.tsx
const STORAGE_KEY = "trench_theme"; // "light" | "dark"

export type ThemeMode = "light" | "dark";

export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function getSavedTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function initTheme(): ThemeMode {
  const saved = getSavedTheme();
  const theme = saved || getSystemTheme();
  applyTheme(theme);
  return theme;
}

export function setTheme(theme: ThemeMode): ThemeMode {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  applyTheme(theme);
  return theme;
}

export function toggleTheme(currentTheme: ThemeMode): ThemeMode {
  const next: ThemeMode = currentTheme === "dark" ? "light" : "dark";
  return setTheme(next);
}