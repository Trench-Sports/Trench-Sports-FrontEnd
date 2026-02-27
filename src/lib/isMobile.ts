// src/lib/isMobile.ts
export default function isMobile() {
  // Treat Capacitor native as “mobile app”
  const w = window as any;
  const isCapacitorNative = !!w?.Capacitor?.isNativePlatform?.();

  // Fallback: small screens
  const isSmallScreen = window.matchMedia?.("(max-width: 820px)")?.matches ?? false;

  return isCapacitorNative || isSmallScreen;
}