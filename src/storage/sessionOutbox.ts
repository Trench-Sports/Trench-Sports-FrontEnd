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
};

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
  tx.objectStore(STORE_SESSIONS).put({
    ...item,
    attempts: item.attempts + 1,
    last_error: errMsg,
  } satisfies OutboxItem);
  await txDone(tx);
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
