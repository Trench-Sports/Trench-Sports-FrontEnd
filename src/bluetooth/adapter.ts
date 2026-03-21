// src/bluetooth/adapter.ts
import { connectToAdapterWeb, disconnectWeb, startNotificationsWeb, writeUtf8Web, type WebAdapterConnection } from "./adapter_web";
import {
  connectToAdapterNative,
  disconnectNative,
  startNotificationsNative,
  writeUtf8Native,
  type NativeAdapterConnection,
} from "./adapter_native";

export type AdapterConnection = WebAdapterConnection | NativeAdapterConnection;

function normalizeUuid(u?: string) {
  const s = (u ?? "").trim();
  return s ? s.toLowerCase() : undefined;
}

function isLocalhost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  // Capacitor injects window.Capacitor in native builds
  return !!cap?.isNativePlatform?.() || (typeof cap?.getPlatform === "function" && cap.getPlatform() !== "web");
}

export function getBleConfig() {
  return {
    SERVICE_UUID: normalizeUuid(import.meta.env.VITE_BLE_SERVICE_UUID as string | undefined),
    CHAR_UUID_RX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_RX as string | undefined),
    CHAR_UUID_TX: normalizeUuid(import.meta.env.VITE_BLE_CHAR_UUID_TX as string | undefined),
    // Default changed from "MPY" → "TS" to match the device name set by boot.py
    // (e.g. "TS-001", "TS-002"). Override via VITE_BLE_NAME_PREFIX in .env.
    NAME_PREFIX: ((import.meta.env.VITE_BLE_NAME_PREFIX as string | undefined) ?? "TS").trim(),
  };
}

export function getBluetoothDiagnostics() {
  const navAny = navigator as any;
  return {
    platform: isNativeApp() ? "native" : "web",
    url: location.href,
    protocol: location.protocol,
    secureContext: window.isSecureContext,
    localhost: isLocalhost(),
    hasBluetooth: typeof navAny.bluetooth !== "undefined",
    hasRequestDevice: !!navAny.bluetooth?.requestDevice,
    userAgent: navigator.userAgent,
  };
}

export async function connectToAdapter(opts?: {
  onDisconnect?: () => void;
  // Callers can supply these directly so the adapter always has correct values
  // regardless of whether VITE_BLE_* env vars are configured. session.tsx
  // passes both explicitly; getBleConfig() values are used as fallbacks only.
  serviceUuid?: string;
  namePrefix?: string;
}): Promise<AdapterConnection> {
  const cfg = getBleConfig();

  // Caller-supplied values take precedence over .env / getBleConfig() defaults.
  const resolvedServiceUuid = normalizeUuid(opts?.serviceUuid) ?? cfg.SERVICE_UUID;
  if (!resolvedServiceUuid) {
    throw new Error("Missing BLE service UUID. Set VITE_BLE_SERVICE_UUID or pass serviceUuid to connectToAdapter.");
  }

  const args = {
    serviceUuid: resolvedServiceUuid,
    namePrefix:  (opts?.namePrefix?.trim()) ?? cfg.NAME_PREFIX,
    onDisconnect: opts?.onDisconnect,
  };

  if (isNativeApp()) {
    return await connectToAdapterNative(args);
  }

  // Web Bluetooth path
  const navAny = navigator as any;
  if (!window.isSecureContext && !isLocalhost()) {
    throw new Error("Web Bluetooth requires HTTPS (secure context).");
  }
  if (!navAny.bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth not supported in this browser/context.");
  }

  return await connectToAdapterWeb(args);
}

export async function disconnect(conn: AdapterConnection | null) {
  if (!conn) return;
  if (conn.kind === "native") return disconnectNative(conn);
  return disconnectWeb(conn);
}

export async function startNotifications(
  conn: AdapterConnection,
  characteristicUuid: string,
  onValue: (dv: DataView) => void
) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing notify characteristic UUID (VITE_BLE_CHAR_UUID_TX).");

  if (conn.kind === "native") return startNotificationsNative(conn, uuid, onValue);
  return startNotificationsWeb(conn, uuid, onValue);
}

export async function writeUtf8(conn: AdapterConnection, characteristicUuid: string, text: string) {
  const uuid = normalizeUuid(characteristicUuid);
  if (!uuid) throw new Error("Missing write characteristic UUID (VITE_BLE_CHAR_UUID_RX).");

  if (conn.kind === "native") return writeUtf8Native(conn, uuid, text);
  return writeUtf8Web(conn, uuid, text);
}