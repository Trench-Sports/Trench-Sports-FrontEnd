// src/lib/sessionSettings.ts
//
// User-facing session settings persisted to localStorage. Phase 1 covers the
// three settings exposed by the hamburger popup in session.tsx:
//   • timerMs       — hard cap for a session (auto-stop fires here)
//   • defaultMetric — initial feed metric ("v" or "si") on page load
//   • autoSave      — when true, saveSession() is called automatically after
//                     stopSession resolves. When false, the existing manual
//                     Save / Discard buttons remain the only path.
//
// Future phases (intentionally NOT shipped in this round, per user request to
// "build and test first") will fold VOLUME_WINDOW_MS and the mV thresholds in
// mvToColor / mvToGlow into this same object so every tunable constant becomes
// derived from settings.

import { useCallback, useEffect, useState } from "react";

/** localStorage key. Bumping this string resets all users to defaults. */
export const SESSION_SETTINGS_KEY = "trench_session_settings_v1";

/**
 * Custom event fired on `window` whenever saveSessionSettings writes a new
 * payload. The native `storage` event ONLY fires in *other* tabs, so we need a
 * same-tab broadcast to keep every useSessionSettings() consumer in sync —
 * otherwise the modal updates its own React state and writes localStorage, but
 * sibling instances (session.tsx) never re-render.
 */
export const SESSION_SETTINGS_EVENT = "trench:session-settings-changed";

/** How far ahead of the cap the warning audio cue fires. */
export const SESSION_WARN_LEAD_MS = 5_000;

export type SessionTimerMs = 30_000 | 45_000 | 60_000;
export type DefaultMetric  = "v" | "si";

export type SessionSettings = {
  timerMs: SessionTimerMs;
  defaultMetric: DefaultMetric;
  autoSave: boolean;
  /**
   * When true, the mobile /m/home page captures the device's GPS coordinates at
   * session start and stores them on the saved session row. On by default; the
   * browser/OS still shows its own permission prompt the first time.
   */
  locationEnabled: boolean;
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  timerMs: 30_000,        // preserves current production behaviour
  defaultMetric: "v",     // V was the prior hard-coded default for feedMetric
  autoSave: false,        // manual save button is the current production flow
  locationEnabled: true,  // /m/home tracks where sessions are recorded
};

/**
 * Compute the warning threshold given a cap. Always 5 s before the cap, but
 * never negative — for a 30 s cap the warning fires at 25 s.
 */
export function warnMsFor(timerMs: number): number {
  return Math.max(0, timerMs - SESSION_WARN_LEAD_MS);
}

/**
 * Coerce a parsed-but-untrusted value into a valid SessionSettings object.
 * Anything missing or out of range falls back to the default — older payloads
 * persisted by future shapes of this module won't crash the app.
 */
export function normalizeSettings(raw: unknown): SessionSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SESSION_SETTINGS };
  const r = raw as Record<string, unknown>;
  const timer =
    r.timerMs === 30_000 || r.timerMs === 45_000 || r.timerMs === 60_000
      ? (r.timerMs as SessionTimerMs)
      : DEFAULT_SESSION_SETTINGS.timerMs;
  const metric =
    r.defaultMetric === "v" || r.defaultMetric === "si"
      ? (r.defaultMetric as DefaultMetric)
      : DEFAULT_SESSION_SETTINGS.defaultMetric;
  const autoSave = typeof r.autoSave === "boolean"
    ? r.autoSave
    : DEFAULT_SESSION_SETTINGS.autoSave;
  const locationEnabled = typeof r.locationEnabled === "boolean"
    ? r.locationEnabled
    : DEFAULT_SESSION_SETTINGS.locationEnabled;
  return { timerMs: timer, defaultMetric: metric, autoSave, locationEnabled };
}

/** Read settings from localStorage (SSR-safe). Returns defaults on any error. */
export function loadSessionSettings(): SessionSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SESSION_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SESSION_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SESSION_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
}

/**
 * Persist settings to localStorage AND broadcast a same-tab event so every
 * useSessionSettings() consumer re-syncs. Silent on quota / private-mode
 * errors (write may still succeed even if storage throws).
 */
export function saveSessionSettings(s: SessionSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore storage errors (private mode, quota exceeded, etc.)
  }
  // Fire AFTER the write so listeners can either read storage or use detail —
  // both will be consistent. Wrapped in try/catch so a missing CustomEvent
  // polyfill (very old browsers) doesn't break the update path.
  try {
    window.dispatchEvent(new CustomEvent(SESSION_SETTINGS_EVENT, { detail: s }));
  } catch {
    // ignore — fallback: any other tab still gets the change via `storage`
  }
}

/**
 * React hook returning the current settings + an updater. Persists every write
 * to localStorage. Also listens for cross-tab changes via the `storage` event
 * so a popup opened in another tab keeps both tabs consistent.
 */
export function useSessionSettings(): [
  SessionSettings,
  (patch: Partial<SessionSettings>) => void,
] {
  const [settings, setSettings] = useState<SessionSettings>(() => loadSessionSettings());

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Cross-tab: native `storage` event fires in OTHER tabs only.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_SETTINGS_KEY) return;
      setSettings(loadSessionSettings());
    };
    // Same-tab: our custom event fires in THIS tab on every save, so all
    // useSessionSettings() consumers (modal + session page) stay in sync.
    const onSameTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") {
        setSettings(normalizeSettings(detail));
      } else {
        setSettings(loadSessionSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SESSION_SETTINGS_EVENT, onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SESSION_SETTINGS_EVENT, onSameTab);
    };
  }, []);

  const update = useCallback((patch: Partial<SessionSettings>) => {
    setSettings(prev => {
      const next = normalizeSettings({ ...prev, ...patch });
      saveSessionSettings(next);
      return next;
    });
  }, []);

  return [settings, update];
}
