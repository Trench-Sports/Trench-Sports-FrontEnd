// src/storage/rawRecorder.ts

type ChunkRow = {
  session_id: string;
  idx: number;
  text: string; // ndjson chunk
  created_at: number;
};

type MetaRow = {
  session_id: string;
  created_at: number;
  updated_at: number;
  byte_count: number;
  chunk_count: number;
  info?: any;
};

const DB_NAME = "trench_raw";
const DB_VERSION = 1;

const STORE_CHUNKS = "chunks";
const STORE_META = "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        // keyPath as compound via "key" string for simplicity
        const s = db.createObjectStore(STORE_CHUNKS, { keyPath: "key" });
        s.createIndex("by_session", "session_id", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "session_id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction error"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction abort"));
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export class RawRecorder {
  private db: IDBDatabase | null = null;

  private sessionId: string | null = null;
  private chunkIdx = 0;

  private buffer = "";
  private byteCount = 0;

  // Tune chunk size for your device + browser
  private readonly maxChunkBytes: number;

  constructor(maxChunkBytes = 128 * 1024) {
    this.maxChunkBytes = maxChunkBytes;
  }

  async init() {
    if (!this.db) this.db = await openDb();
  }

  async startSession(sessionId: string, info?: any) {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    this.sessionId = sessionId;
    this.chunkIdx = 0;
    this.buffer = "";
    this.byteCount = 0;

    const now = Date.now();
    const meta: MetaRow = {
      session_id: sessionId,
      created_at: now,
      updated_at: now,
      byte_count: 0,
      chunk_count: 0,
      info,
    };

    const tx = this.db.transaction([STORE_META], "readwrite");
    tx.objectStore(STORE_META).put(meta);
    await txDone(tx);
  }

  /**
   * Append raw NDJSON lines (already newline-delimited or not).
   * You can call this on every BLE notification chunk.
   */
  async appendText(text: string) {
    if (!this.sessionId) throw new Error("No active session. Call startSession().");
    this.buffer += text;

    // flush in chunks
    while (this.estimatedBytes(this.buffer) >= this.maxChunkBytes) {
      const cut = this.cutAtNewline(this.buffer, this.maxChunkBytes);
      const part = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      await this.writeChunk(part);
    }
  }

  async flush() {
    if (!this.sessionId) return;
    if (this.buffer.length) {
      await this.writeChunk(this.buffer);
      this.buffer = "";
    }
  }

  async endSession() {
    await this.flush();
    // no-op beyond flush; metadata already updated per chunk
    this.sessionId = null;
  }

  async exportSessionNdjson(sessionId: string): Promise<Blob> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    // read all chunks for session (ordered by idx)
    const chunks = await this.readChunks(sessionId);
    const text = chunks.map((c) => c.text).join("");
    return new Blob([text], { type: "application/x-ndjson" });
  }

  async downloadSession(sessionId: string, filename = `${sessionId}.ndjson`) {
    const blob = await this.exportSessionNdjson(sessionId);
    downloadBlob(blob, filename);
  }

  // ------- internal helpers -------

  private estimatedBytes(s: string): number {
    // rough UTF-8 byte count; ok for chunking
    return new Blob([s]).size;
  }

  private cutAtNewline(s: string, approxBytes: number): number {
    // cut near approxBytes but ensure we end at newline if possible
    if (s.length === 0) return 0;

    // take a substring near the size estimate
    // (Blob sizing is expensive; this is heuristic)
    let cut = Math.min(s.length, Math.max(1, Math.floor((approxBytes / this.maxChunkBytes) * s.length)));
    cut = Math.min(s.length, Math.max(1, cut));

    // move forward to a newline if possible, else backward
    const forward = s.indexOf("\n", cut);
    if (forward !== -1 && forward < s.length) return forward + 1;

    const back = s.lastIndexOf("\n", cut);
    if (back !== -1) return back + 1;

    // worst case: no newline; just cut at end
    return s.length;
  }

  private async writeChunk(text: string) {
    if (!this.db || !this.sessionId) return;

    const row: ChunkRow & { key: string } = {
      key: `${this.sessionId}:${this.chunkIdx}`,
      session_id: this.sessionId,
      idx: this.chunkIdx,
      text,
      created_at: Date.now(),
    };

    const bytes = this.estimatedBytes(text);

    const tx = this.db.transaction([STORE_CHUNKS, STORE_META], "readwrite");
    tx.objectStore(STORE_CHUNKS).put(row);

    const metaStore = tx.objectStore(STORE_META);
    const metaReq = metaStore.get(this.sessionId);

    metaReq.onsuccess = () => {
      const meta = metaReq.result as MetaRow | undefined;
      const now = Date.now();
      const next: MetaRow = meta
        ? {
            ...meta,
            updated_at: now,
            byte_count: (meta.byte_count ?? 0) + bytes,
            chunk_count: (meta.chunk_count ?? 0) + 1,
          }
        : {
            session_id: this.sessionId!,
            created_at: now,
            updated_at: now,
            byte_count: bytes,
            chunk_count: 1,
          };

      metaStore.put(next);
    };

    await txDone(tx);

    this.byteCount += bytes;
    this.chunkIdx += 1;
  }

  private readChunks(sessionId: string): Promise<Array<ChunkRow>> {
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_CHUNKS], "readonly");
      const store = tx.objectStore(STORE_CHUNKS);

      // Walk all keys and filter; simplest without extra indexes constraints
      const chunks: ChunkRow[] = [];
      const req = store.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          // sort by idx
          chunks.sort((a, b) => a.idx - b.idx);
          resolve(chunks);
          return;
        }
        const val = cursor.value as any;
        if (val?.session_id === sessionId) {
          chunks.push({
            session_id: val.session_id,
            idx: val.idx,
            text: val.text,
            created_at: val.created_at,
          });
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error ?? new Error("Failed to read chunks"));
    });
  }
}
