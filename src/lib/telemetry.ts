// src/lib/telemetry.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client telemetry tracker. Part 1, Phase 1 of
// docs/observability-and-code-audit-plan.md (§1.5). Writes to the app_events
// table (supabase/telemetry_events.sql).
//
// Hard requirements this file exists to satisfy:
//   • track() NEVER throws and NEVER blocks the caller — telemetry must not be
//     able to break a session. The whole body is wrapped in try/catch.
//   • Batched: buffer in memory, flush every FLUSH_INTERVAL_MS or at
//     BATCH_SIZE events, whichever comes first. One insert per flush. Given the
//     event_cells write volume (finding C), we never write per user action.
//   • Flushes on visibilitychange→hidden (reliable on iOS, unlike beforeunload)
//     via a keepalive fetch that survives page teardown.
//   • Survives offline: on flush failure the buffer is persisted to IndexedDB
//     and retried on `online`. Mirrors sessionOutbox.ts conventions.
//   • Backoff (unlike the outbox — finding E): exponential to a 5-min cap, and
//     the buffer is capped at MAX_BUFFER events (newest kept).
//   • Auto-context: client_id / platform / app_version / user_id / program_id
//     attach automatically. Call sites pass only event-specific detail.
//   • Kill switch: VITE_TELEMETRY_ENABLED env flag + a runtime setter.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabaseClient";
import { platform } from "../platform";

// ── Config ───────────────────────────────────────────────────────────────────
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 10_000;
const MAX_BUFFER = 500;          // drop oldest past this (finding E: bounded)
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 5 * 60_000;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";
// Kill switch: disabled only if explicitly set to "false".
const ENV_ENABLED = String(import.meta.env.VITE_TELEMETRY_ENABLED ?? "true") !== "false";

// ── Event shape ────────────────────────────────────────────────────────────
// Reserved keys are promoted to real columns; everything else lands in props.
export type TrackDetail = {
  ok?: boolean;
  error_code?: string;
  duration_ms?: number;
  session_id?: string;
  device_id?: string;
  [k: string]: unknown;
};

type AppEvent = {
  name: string;
  client_id: string;
  client_ts: string;
  user_id: string | null;
  program_id: string | null;
  session_id: string | null;
  device_id: string | null;
  platform: "web" | "ios";
  app_version: string;
  ok: boolean | null;
  error_code: string | null;
  duration_ms: number | null;
  props: Record<string, unknown>;
};

const RESERVED = new Set(["ok", "error_code", "duration_ms", "session_id", "device_id"]);

// ── Module state ─────────────────────────────────────────────────────────────
let enabled = ENV_ENABLED && !!supabase && !!SUPABASE_URL && !!SUPABASE_ANON;
let buffer: AppEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 0;
let accessToken: string | null = null;
const ctx: { userId: string | null; programId: string | null } = { userId: null, programId: null };

const PLATFORM: "web" | "ios" = platform.isIos ? "ios" : "web";

// ── client_id — stable anon id that survives logout (finding I funnel) ───────
const CLIENT_ID_KEY = "ts_telemetry_client_id";
function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}
const CLIENT_ID = getClientId();

// ── IndexedDB persistence (mirrors sessionOutbox.ts) ─────────────────────────
const DB_NAME = "trench_telemetry";
const DB_VERSION = 1;
const STORE = "buffer";
const BUFFER_KEY = "pending";

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("telemetry IDB open failed"));
    });
  }
  return dbPromise;
}

async function persistBuffer(): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction([STORE], "readwrite");
      // Store a bounded snapshot; never let the persisted copy grow unbounded.
      tx.objectStore(STORE).put(buffer.slice(-MAX_BUFFER), BUFFER_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* persistence is best-effort */
  }
}

async function loadPersisted(): Promise<void> {
  try {
    const d = await db();
    const stored: AppEvent[] | undefined = await new Promise((resolve) => {
      const tx = d.transaction([STORE], "readonly");
      const r = tx.objectStore(STORE).get(BUFFER_KEY);
      r.onsuccess = () => resolve(r.result as AppEvent[] | undefined);
      r.onerror = () => resolve(undefined);
    });
    if (stored && stored.length) {
      buffer = [...stored, ...buffer].slice(-MAX_BUFFER);
      scheduleFlush();
    }
  } catch {
    /* ignore */
  }
}

// ── Flush scheduling ─────────────────────────────────────────────────────────
function scheduleFlush(delay = FLUSH_INTERVAL_MS): void {
  if (flushTimer || !enabled) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

async function flush(): Promise<void> {
  try {
    if (!enabled || buffer.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Stay queued; the `online` listener will retry.
      await persistBuffer();
      return;
    }
    // Snapshot the batch; keep it in the buffer until the insert confirms.
    const batch = buffer.slice(0, Math.max(BATCH_SIZE, buffer.length));
    const { error } = await supabase!.from("app_events").insert(batch);
    if (error) throw error;

    // Success: drop the sent events, reset backoff, persist the remainder.
    buffer = buffer.slice(batch.length);
    backoffMs = 0;
    await persistBuffer();
    if (buffer.length > 0) scheduleFlush(0);
  } catch (err) {
    // Failure: back off exponentially (finding E — the outbox never did this).
    backoffMs = backoffMs === 0 ? BACKOFF_BASE_MS : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    await persistBuffer();
    scheduleFlush(backoffMs);
    if (import.meta.env.DEV) console.warn("[telemetry] flush failed, backing off", backoffMs, err);
  }
}

// Keepalive flush for page-hide — a plain fetch with keepalive:true survives
// teardown and (unlike sendBeacon) can set the apikey/Authorization headers the
// Supabase REST endpoint requires.
function flushOnHide(): void {
  try {
    if (!enabled || buffer.length === 0 || !SUPABASE_URL || !SUPABASE_ANON) return;
    const batch = buffer.slice(-MAX_BUFFER);
    buffer = [];
    void persistBuffer(); // in case the keepalive request is dropped, we retry next load
    fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${accessToken ?? SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(batch),
      keepalive: true,
    })
      .then(() => {
        // Sent — clear the persisted copy so we don't double-send on next load.
        buffer = [];
        void persistBuffer();
      })
      .catch(() => {
        /* keep the persisted copy for retry on next load */
      });
  } catch {
    /* never throw from an unload path */
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Record an event. Never throws, never blocks. */
export function track(name: string, detail?: TrackDetail): void {
  try {
    if (!enabled) return;

    let ok: boolean | null = null;
    let error_code: string | null = null;
    let duration_ms: number | null = null;
    let session_id: string | null = null;
    let device_id: string | null = null;
    const props: Record<string, unknown> = {};

    if (detail) {
      for (const [k, v] of Object.entries(detail)) {
        if (!RESERVED.has(k)) { props[k] = v; continue; }
        if (k === "ok") ok = v as boolean;
        else if (k === "error_code") error_code = v == null ? null : String(v);
        else if (k === "duration_ms") duration_ms = v == null ? null : Number(v);
        else if (k === "session_id") session_id = v == null ? null : String(v);
        else if (k === "device_id") device_id = v == null ? null : String(v);
      }
    }

    buffer.push({
      name: String(name).slice(0, 64),
      client_id: CLIENT_ID,
      client_ts: new Date().toISOString(),
      user_id: ctx.userId,
      program_id: ctx.programId,
      session_id,
      device_id,
      platform: PLATFORM,
      app_version: APP_VERSION,
      ok,
      error_code,
      duration_ms,
      props,
    });

    // Bound the buffer — drop the OLDEST past the cap (finding E).
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);

    if (buffer.length >= BATCH_SIZE) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      void flush();
    } else {
      scheduleFlush();
    }
  } catch {
    /* telemetry must never break the caller */
  }
}

/** Merge current user/program into the auto-context attached to every event. */
export function setTelemetryContext(partial: { userId?: string | null; programId?: string | null }): void {
  if ("userId" in partial) ctx.userId = partial.userId ?? null;
  if ("programId" in partial) ctx.programId = partial.programId ?? null;
}

/** Runtime kill switch (complements the VITE_TELEMETRY_ENABLED env flag). */
export function setTelemetryEnabled(on: boolean): void {
  enabled = on && ENV_ENABLED && !!supabase && !!SUPABASE_URL && !!SUPABASE_ANON;
}

export function isTelemetryEnabled(): boolean {
  return enabled;
}

export function getClientIdValue(): string {
  return CLIENT_ID;
}

// Resolve the signed-in user's program from their profile and attach it to the
// auto-context, so every subsequent event carries program_id (populates
// app_events_program_ts_idx / per-program telemetry). Best-effort and never
// throws — a failure just leaves program_id null, exactly as before.
async function resolveProgramContext(userId: string | null): Promise<void> {
  try {
    if (!supabase || !userId) {
      setTelemetryContext({ programId: null });
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("program_id")
      .eq("user_id", userId)
      .maybeSingle();
    setTelemetryContext({ programId: (data as { program_id?: string | null } | null)?.program_id ?? null });
  } catch {
    /* leave program_id as-is; telemetry must never throw */
  }
}

// ── Install listeners once ─────────────────────────────────────────────────
let installed = false;
export function initTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  void loadPersisted();

  // Keep the auth-derived context fresh without an async call on every track().
  try {
    supabase?.auth.getSession().then(({ data }) => {
      accessToken = data.session?.access_token ?? null;
      const uid = data.session?.user?.id ?? null;
      if (uid) setTelemetryContext({ userId: uid });
      void resolveProgramContext(uid);
    });
    supabase?.auth.onAuthStateChange((_evt, session) => {
      accessToken = session?.access_token ?? null;
      const uid = session?.user?.id ?? null;
      setTelemetryContext({ userId: uid });
      void resolveProgramContext(uid);
    });
  } catch {
    /* ignore */
  }

  window.addEventListener("online", () => {
    backoffMs = 0;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    void flush();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });
}
