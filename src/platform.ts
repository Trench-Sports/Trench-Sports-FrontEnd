// src/platform.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for "where are we running?"
//
//  • isNative   → true  inside the Capacitor iOS/Android shell
//  • isIos      → true  on iPhone / iPad (native only)
//  • isAndroid  → true  on Android (native only)
//  • isWeb      → true  on desktop/mobile browser (Vercel)
//  • isMobileBrowser → true if running in a phone browser (not native)
//
// Usage:
//   import { platform } from "@/platform";
//   if (platform.isNative) { /* Capacitor-specific code */ }
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor } from "@capacitor/core";

function detectPlatform() {
  const nativePlatform = Capacitor.getPlatform(); // "ios" | "android" | "web"
  const isNative = Capacitor.isNativePlatform();
  const isIos = nativePlatform === "ios";
  const isAndroid = nativePlatform === "android";
  const isWeb = !isNative;

  // Detects a phone-sized browser (not the native shell)
  const isMobileBrowser =
    isWeb &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  return { isNative, isIos, isAndroid, isWeb, isMobileBrowser, nativePlatform };
}

export const platform = detectPlatform();

// ─── Apply a data-attribute to <html> so CSS can target it globally ───────────
//
//  data-platform="native-ios"      → Capacitor on iPhone/iPad
//  data-platform="native-android"  → Capacitor on Android
//  data-platform="mobile-browser"  → phone browser (no native shell)
//  data-platform="web"             → desktop browser
//
function applyPlatformAttribute() {
  let value: string;
  if (platform.isIos) value = "native-ios";
  else if (platform.isAndroid) value = "native-android";
  else if (platform.isMobileBrowser) value = "mobile-browser";
  else value = "web";

  document.documentElement.setAttribute("data-platform", value);

  // Also add a convenience class for broad "native" targeting
  if (platform.isNative) {
    document.documentElement.classList.add("is-native");
  }
}

applyPlatformAttribute();