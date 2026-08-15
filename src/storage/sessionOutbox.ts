// src/storage/sessionOutbox.ts
//
// On-device outbox for completed sessions that could not be uploaded to
// Supabase (e.g. no wifi / cellular at the time of save). Each queued item is
// the *full* uploadSession payload for ONE bag — primary and every secondary
// multi-bag slot are queued independently, so one bag failing never blocks the
// others.
//
// Lifecycle:
//   1. saveSession() tries uploadSession() per bag.
//   2. On failure it calls enqueue(payload) — the recorded frames are now safe
//      on the device (survives app restart, since IndexedDB persists).
//   3. flush(uploader) replays every queued payload when connectivity returns
//      (window "online" event, app mount, or a periodic safety interval) and
//      removes each one only after a successful upload.
//
// Mirrors the IndexedDB conventions already used by rawRecorder.ts.

import * as ev from "../lib/telemetryEvents";

const DB_NAME = "trench_outbox";
const DB_VERSION = 1;
const STORE_SESSIONS = "sessions";

// A queued session = the uploadSession() argument object plus bookkeeping.
// Kept structurally loose (`payload: any`) so this module stays decoupled from
// home.tsx's inline upload-opts type; the replay uploader is strongly typed by
// the caller.
export type OutboxItem = {
  session_id: string;   // primary key — the bag's sessionId (unique per bag/session)
  payload: any;         // exact uploadSession(opts) argument, structured-cloned
  enqueued_at: number;  // wall-clock ms when first queued
  attempts: number;     // how many flush attempts have been made
  last_error?: string;  // message from the most recent failed attempt
  // ── Parking (subscription-limit failures) ────────────────────────────────
  // Set when an upload failed for a reason retrying cannot fix — today that
  // means the program hit its monthly session cap, or the session's mode is
  // not on its plan and rejection is switched on
  // (supabase/entitlements_enforcement.sql).
  //
  // This exists because before those caps, every upload failure was transient
  // (no wifi), so retrying forever was correct. A plan-limit failure is not
  // transient: without parking, every online event, app mount and safety
  // interval would replay a payload that is guaranteed to fail, draining
  // battery and bandwidth and never clearing.
  //
  // Parked items are NOT deleted. The recorded session stays on the device and
  // is retried on a slow cadence, so it uploads by itself when the calendar
  // month rolls over or the program upgrades.
  blocked_reason?: string;
  blocked_at?: number;
};

/**
 * Does this upload error mean "retrying will never help"?
 *
 * Deliberately narrow: it matches only the two messages the entitlement
 * triggers raise. Anything else — network, RLS, timeout, 5xx — keeps the old
 * retry-forever behaviour, because misclassifying a transient failure as
 * permanent would silently stop syncing real sessions.
 */
export function isPlanLimitFailure(message: string): boolean {
  const m = String(message ?? "");
  return m.includes("Plan limit reached") || m.includes("is not included in this plan");
}

// How long a parked item waits before one retry. A monthly cap clears at the
// start of the next month and an upgrade can land any time, so checking twice a
// day drains nothing and needs no push signal.
const PARKED_RETRY_MS = 12 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: "session_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open outbox IndexedDB"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Outbox transaction error"));
    tx.onabort = () => reject(tx.error ?? new Error("Outbox transaction abort"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

/**
 * Persist a single bag's upload payload to the device. `sessionId` must be the
 * payload's own (per-bag) session id so primary + secondary slots never collide.
 * Safe to call repeatedly with the same id (put = upsert).
 */
export async function enqueue(sessionId: string, payload: any): Promise<void> {
  const d = await db();
  const tx = d.transaction([STORE_SESSIONS], "readwrite");
  const store = tx.objectStore(STORE_SESSIONS);
  // Preserve enqueued_at/attempts if this id is already queued.
  const existing: OutboxItem | undefined = await new Promise((resolve) => {
    const r = store.get(sessionId);
    r.onsuccess = () => resolve(r.result as OutboxItem | undefined);
    r.onerror = () => resolve(undefined);
  });
  const item: OutboxItem = {
    session_id: sessionId,
    payload,
    enqueued_at: existing?.enqueued_at ?? Date.now(),
    attempts: existing?.attempts ?? 0,
    last_error: existing?.last_error,
  };
  store.put(item);
  await txDone(tx);
  // Telemetry: outbox depth is a reliability signal (finding D/§1.1).
  try { ev.outboxEnqueued(await safeCount()); } catch { /* never break enqueue */ }
}

/** All currently-queued items, oldest first. */
export async function list(): Promise<OutboxItem[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction([STORE_SESSIONS], "readonly");
    const store = tx.objectStore(STORE_SESSIONS);
    const items: OutboxItem[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        items.sort((a, b) => a.enqueued_at - b.enqueued_at);
        resolve(items);
        return;
      }
      items.push(cursor.value as OutboxItem);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to read outbox"));
  });
}

/** How many sessions are waiting to sync. */
export async function count(): Promise<number> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction([STORE_SESSIONS], "readonly");
    const req = tx.objectStore(STORE_SESSIONS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to count outbox"));
  });
}

/** Remove one item after a confirmed successful upload. */
export async function remove(sessionId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([STORE_SESSIONS], "readwrite");
  tx.objectStore(STORE_SESSIONS).delete(sessionId);
  await txDone(tx);
}

async function bumpAttempt(item: OutboxItem, errMsg: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([STORE_SESSIONS], "readwrite");
  const permanent = isPlanLimitFailure(errMsg);
  tx.objectStore(STORE_SESSIONS).put({
    ...item,
    attempts: item.attempts + 1,
    last_error: errMsg,
    // Park on a plan-limit failure; clear the park if this attempt failed for
    // some other (transient) reason, so an item never stays parked on a
    // stale classification.
    ...(permanent
      ? { blocked_reason: errMsg, blocked_at: Date.now() }
      : { blocked_reason: undefined, blocked_at: undefined }),
  } satisfies OutboxItem);
  await txDone(tx);
}

/**
 * Items parked on a plan limit. The data is safe on the device — this is what
 * the UI should report so a coach knows a session did not sync and why, rather
 * than assuming it uploaded.
 */
export async function parked(): Promise<OutboxItem[]> {
  return (await list()).filter((i) => Boolean(i.blocked_reason));
}

/**
 * Clear every park so the next flush retries immediately. Call this after the
 * program's plan changes — an upgrade should not wait out PARKED_RETRY_MS.
 */
export async function unparkAll(): Promise<number> {
  const items = await parked();
  if (items.length === 0) return 0;
  const d = await db();
  const tx = d.transaction([STORE_SESSIONS], "readwrite");
  const store = tx.objectStore(STORE_SESSIONS);
  for (const item of items) {
    store.put({ ...item, blocked_reason: undefined, blocked_at: undefined } satisfies OutboxItem);
  }
  await txDone(tx);
  return items.length;
}

export type FlushResult = { uploaded: number; failed: number; remaining: number };

// Module-level guard so overlapping triggers (online event + interval + mount)
// don't replay the same item twice concurrently.
let flushing = false;

/**
 * Replay every queued payload through `uploader`. Removes items that upload
 * successfully; leaves the rest queued (with attempt count bumped) for the next
 * trigger. Re-entrant calls are no-ops while a flush is in progress.
 */
export async function flush(
  uploader: (payload: any) => Promise<void>,
): Promise<FlushResult> {
  if (flushing) return { uploaded: 0, failed: 0, remaining: await safeCount() };
  flushing = true;
  let uploaded = 0;
  let failed = 0;
  try {
    const items = await list();
    let remaining = items.length;
    for (const item of items) {
      // Bail out the moment we go offline mid-drain — keep the rest queued.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        failed += 1;
        continue;
      }
      // Parked on a plan limit: skip until the retry window elapses. Retrying
      // now would fail for exactly the same reason it failed last time.
      if (item.blocked_reason && item.blocked_at &&
          Date.now() - item.blocked_at < PARKED_RETRY_MS) {
        failed += 1;
        continue;
      }
      const ageMs = Date.now() - item.enqueued_at;
      try {
        await uploader(item.payload);
        await remove(item.session_id);
        uploaded += 1;
        remaining -= 1;
        try { ev.outboxFlushSucceeded({ attempt_n: item.attempts + 1, age_ms: ageMs, queue_depth: remaining }); } catch { /* noop */ }
      } catch (err: any) {
        failed += 1;
        const msg = err?.message ?? String(err);
        await bumpAttempt(item, msg);
        try {
          ev.outboxFlushFailed({ attempt_n: item.attempts + 1, age_ms: ageMs, queue_depth: remaining, error_code: String(msg).slice(0, 64) });
        } catch { /* noop */ }
      }
    }
  } finally {
    flushing = false;
  }
  return { uploaded, failed, remaining: await safeCount() };
}

async function safeCount(): Promise<number> {
  try {
    return await count();
  } catch {
    return 0;
  }
}
