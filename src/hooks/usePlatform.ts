// src/hooks/usePlatform.ts
// ─────────────────────────────────────────────────────────────────────────────
// React hook wrapping the platform utility.
// Returns the same shape as `platform` but is React-friendly.
//
// Usage:
//   const { isNative, isIos, isWeb } = usePlatform();
// ─────────────────────────────────────────────────────────────────────────────

import { platform } from "../platform";

export function usePlatform() {
  return platform; // static — won't change during a session
}