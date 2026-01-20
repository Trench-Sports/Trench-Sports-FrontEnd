// src/bluetooth/router.ts
// Mirrors the NDJSONRouter logic from BLE_client.py, but routes into in-memory arrays
// instead of writing to disk. You can later download the buffers as .ndjson files.

export type RoutedBuffers = {
  live: string[];    // JSON lines
  impacts: string[]; // JSON lines
};

export type RouterState = {
  current: "live" | "impacts" | null;
};

export function createNdjsonRouter() {
  const state: RouterState = { current: null };
  const out: RoutedBuffers = { live: [], impacts: [] };

  function append(which: "live" | "impacts", obj: any) {
    out[which].push(JSON.stringify(obj));
  }

  function routeObj(obj: any) {
    const t = obj?.type;

    // --- Export framing (preferred path) ---
    if (t === "export_begin") {
      const file = obj?.file;
      state.current = file === "live" || file === "impacts" ? file : null;
      return;
    }
    if (t === "export_end") {
      state.current = null;
      return;
    }

    // --- Inside an export: trust sender's file hint ---
    if (state.current === "live") {
      append("live", obj);
      return;
    }
    if (state.current === "impacts") {
      append("impacts", obj);
      return;
    }

    // --- Realtime or non-framed lines: infer destination (same as Python) ---
    // LIVE: real-time telemetry & control/breadcrumbs
    if (t === "hit" || t === "cmd_rx" || t === "session_report_appended") {
      append("live", obj);
      return;
    }

    // IMPACTS: impact events + session-level reports/starts
    if (
      t === "impact_start" ||
      t === "impact_frame" ||
      t === "impact_end" ||
      t === "session_start" ||
      t === "session_report"
    ) {
      append("impacts", obj);
      return;
    }

    // No explicit 'type': infer by structure
    if (obj && typeof obj === "object" && "impact" in obj) {
      append("impacts", obj);
      return;
    }

    if (obj && typeof obj === "object" && ("ack" in obj || "cmd" in obj)) {
      append("live", obj);
      return;
    }

    // Fallback: lean toward impacts (safer for analysis)
    append("impacts", obj);
  }

  function feedLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const obj = JSON.parse(trimmed);
      routeObj(obj);
    } catch {
      // store raw line (diagnostic) to impacts file, same spirit as Python
      append("impacts", { type: "ndjson_raw", line: trimmed });
    }
  }

  function reset() {
    state.current = null;
    out.live.length = 0;
    out.impacts.length = 0;
  }

  return { out, state, feedLine, reset };
}
