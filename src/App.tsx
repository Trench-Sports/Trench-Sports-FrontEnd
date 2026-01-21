import { useEffect, useMemo, useRef, useState } from "react";
import {
  connectToAdapter,
  disconnect,
  getBleConfig,
  startNotifications,
  writeUtf8,
  type AdapterConnection,
} from "./bluetooth/adapter";

import { ContactGrid, type MetricMode } from "./components/ContactGrid";
import {
  makeGrid,
  popNdjsonLines,
  tryParseJson,
  extractGridSize,
  isHit,
  applyHit,
  type GridSize,
  type Cell,
} from "./visualization/contacts";

import { supabase } from "./supabaseClient";
import { pressureKpaFromVoltage, forceNFromPressureKpa } from "./processing/calibration";
import type { CalibrationConfig } from "./processing/calibration";

type DataSource = "live" | "supabase";

type SessionRow = {
  id: string;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  grid_rows: number | null;
  grid_cols: number | null;
  device_model: string | null;
  sampling_hz: number | null;
};

type SessionSummaryRow = {
  session_id: string;
  num_events: number | null;
  session_duration_ms: number | null;
  cadence_hz_avg: number | null;
  cadence_hz_median: number | null;
  peak_force_stats: any | null; // jsonb
  impulse_stats: any | null; // jsonb
  longest_pause_ms: number | null;
  Date_Of_Record: string | null;
};

const DEFAULT_CAL: CalibrationConfig = {
  cell_pitch_mm_x: 10,
  cell_pitch_mm_y: 10,
  v_to_p: { model: "linear", a: 100, b: 0, clamp_kpa: [0, 1000] },
  units: { voltage: "V", pressure: "kPa", force: "N" },
};

function cloneGridWithHits(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ voltage: 0, lastHitAt: 0 }))
  );
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return Number(x).toFixed(digits);
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: 12,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function LegendBar({
  title,
  minLabel,
  maxLabel,
}: {
  title: string;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>{title}</div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "linear-gradient(90deg, rgba(0,255,120,0.10), rgba(0,255,120,0.95))",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 12,
          opacity: 0.8,
        }}
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Environment Variables (Production + Preview)."
    );
  }
  return supabase;
}

export default function App() {
  const [conn, setConn] = useState<AdapterConnection | null>(null);
  const [status, setStatus] = useState<string>("Disconnected");
  const [logLines, setLogLines] = useState<string[]>([]);

  // Live grid state (BLE)
  const [gridSize, setGridSize] = useState<GridSize>({ cols: 8, rows: 12 });
  const [gridLive, setGridLive] = useState<Cell[][]>(() => makeGrid(12, 8));

  // Supabase-loaded grid state (latest processed event)
  const [gridDb, setGridDb] = useState<Cell[][]>(() => cloneGridWithHits(12, 8));
  const [dbSessionId, setDbSessionId] = useState<string>("");
  const [dbEventId, setDbEventId] = useState<string>("");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string>("");

  // Recent sessions list + details
  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<SessionSummaryRow | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");

  // UI toggles
  const [dataSource, setDataSource] = useState<DataSource>("live");
  const [metricMode, setMetricMode] = useState<MetricMode>("voltage");

  // Live readout + session max
  const [liveLast, setLiveLast] = useState<{
    r0: number; // 0-based
    c0: number; // 0-based
    voltage: number;
    forceN: number;
    atMs: number; // Date.now()
  } | null>(null);
  const [liveMaxVoltage, setLiveMaxVoltage] = useState<number>(0);
  const [liveMaxForce, setLiveMaxForce] = useState<number>(0);

  // Buffer for newline-delimited messages coming in over notifications
  const rxBufferRef = useRef<string>("");

  // Tick so the grid "fades" even without new hits
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forceTick((t) => (t + 1) % 1_000_000), 80);
    return () => window.clearInterval(id);
  }, []);

  const cfg = useMemo(() => getBleConfig(), []);

  function appendLine(line: string) {
    setLogLines((prev) => {
      const next = [...prev, line];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }

  function clearLog() {
    setLogLines([]);
  }

  // -------- Force calc for display --------
  function getForceN(r0: number, c0: number, voltage: number): number {
    const pKpa = pressureKpaFromVoltage(voltage, DEFAULT_CAL, { r: r0, c: c0 });
    return forceNFromPressureKpa(pKpa, DEFAULT_CAL);
  }

  function resetLiveSessionStats() {
    setLiveLast(null);
    setLiveMaxVoltage(0);
    setLiveMaxForce(0);
  }

  function handleIncomingText(chunkText: string) {
    rxBufferRef.current += chunkText;

    const popped = popNdjsonLines(rxBufferRef.current);
    rxBufferRef.current = popped.buffer;

    for (const line of popped.lines) {
      appendLine(`RECEIVED > ${line}`);

      const msg = tryParseJson(line);
      if (!msg) continue;

      const gs = extractGridSize(msg);
      if (gs) {
        setGridSize(gs);
        setGridLive(makeGrid(gs.rows, gs.cols));
        setGridDb(cloneGridWithHits(gs.rows, gs.cols));
        resetLiveSessionStats();
        appendLine(`[info] grid_size set to ${gs.rows}x${gs.cols}`);
        continue;
      }

      if (isHit(msg)) {
        setGridLive((prev) => applyHit(prev, msg));

        const r0 = Number(msg.row) - 1;
        const c0 = Number(msg.col) - 1;
        const v = Number(msg.voltage ?? 0);

        if (Number.isFinite(r0) && Number.isFinite(c0) && Number.isFinite(v)) {
          const f = getForceN(r0, c0, v);

          setLiveLast({
            r0,
            c0,
            voltage: v,
            forceN: f,
            atMs: Date.now(),
          });

          setLiveMaxVoltage((m) => Math.max(m, v));
          setLiveMaxForce((m) => Math.max(m, f));
        }
      }
    }
  }

  async function onConnect() {
    try {
      setStatus("Opening Bluetooth picker…");
      const c = await connectToAdapter();
      setConn(c);

      setStatus(`Connected to ${c.device.name ?? "device"}`);
      appendLine(`[info] Connected to ${c.device.name ?? "device"}`);

      resetLiveSessionStats();
      setDataSource("live");

      c.device.addEventListener("gattserverdisconnected", () => {
        setConn(null);
        setStatus("Disconnected");
        appendLine("[event] gattserverdisconnected");
      });

      if (cfg.CHAR_UUID_TX) {
        await startNotifications(c, cfg.CHAR_UUID_TX, (dv) => {
          const dec = new TextDecoder();
          const txt = dec.decode(dv.buffer);
          handleIncomingText(txt);
        });
        appendLine(`[info] Notifications started on ${cfg.CHAR_UUID_TX}`);
      } else {
        appendLine("[warn] No VITE_BLE_CHAR_UUID_TX set (cannot receive notifications).");
      }
    } catch (e: any) {
      setStatus("Disconnected");
      appendLine(`[error] ${e?.message ?? String(e)}`);
    }
  }

  async function onDisconnect() {
    await disconnect(conn);
    setConn(null);
    setStatus("Disconnected");
    appendLine("[info] Disconnected");
  }

  async function sendCommand(cmd: string) {
    try {
      if (!conn) throw new Error("Not connected.");
      if (!cfg.CHAR_UUID_RX) throw new Error("Missing VITE_BLE_CHAR_UUID_RX.");

      const sanitized = cmd.trim().replaceAll("\\n", "").replaceAll("\\r", "");
      const toSend = sanitized.endsWith("\n") ? sanitized : sanitized + "\n";

      await writeUtf8(conn, cfg.CHAR_UUID_RX, toSend);
      appendLine(`SENT > ${sanitized}`);
    } catch (e: any) {
      appendLine(`[error] ${e?.message ?? String(e)}`);
    }
  }

  // -------- Supabase: Load latest processed event for current dbSessionId --------
  async function loadLatestFromSupabase() {
    setDbLoading(true);
    setDbError("");
    try {
      const sb = requireSupabase();

      let sessionId = dbSessionId.trim();

      if (!sessionId) {
        const { data: sess, error: sessErr } = await sb
          .from("sessions")
          .select("id, started_at_ms, grid_rows, grid_cols")
          .order("started_at_ms", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sessErr) throw sessErr;
        if (!sess?.id) throw new Error("No sessions found in Supabase.");

        sessionId = sess.id;
        setDbSessionId(sessionId);

        const rows = Number(sess.grid_rows ?? gridSize.rows);
        const cols = Number(sess.grid_cols ?? gridSize.cols);
        setGridSize({ rows, cols });
        setGridDb(cloneGridWithHits(rows, cols));
      }

      const { data: evt, error: evtErr } = await sb
        .from("events")
        .select("event_id, t_start_ms")
        .eq("session_id", sessionId)
        .order("t_start_ms", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (evtErr) throw evtErr;
      if (!evt?.event_id) throw new Error("No events found for that session.");

      setDbEventId(evt.event_id);

      const { data: cells, error: cellsErr } = await sb
        .from("event_cells")
        .select("r, c, v_min, p_max_kpa, t_last_ms")
        .eq("event_id", evt.event_id);

      if (cellsErr) throw cellsErr;

      const rows = gridSize.rows;
      const cols = gridSize.cols;
      const next = cloneGridWithHits(rows, cols);

      for (const cell of cells ?? []) {
        const r0 = Number((cell as any).r);
        const c0 = Number((cell as any).c);
        if (!Number.isFinite(r0) || !Number.isFinite(c0)) continue;
        if (r0 < 0 || c0 < 0 || r0 >= rows || c0 >= cols) continue;

        const v = Number((cell as any).v_min ?? 0);
        next[r0][c0] = { voltage: v, lastHitAt: Date.now() };
      }

      setGridDb(next);
      appendLine(`[info] Loaded session=${sessionId} latest event=${evt.event_id} from Supabase`);
      setDataSource("supabase");
    } catch (e: any) {
      setDbError(e?.message ?? String(e));
    } finally {
      setDbLoading(false);
    }
  }

  // -------- Supabase: recent sessions list + summaries --------
  async function selectSession(session: SessionRow, opts?: { autoLoadLatestEvent?: boolean }) {
    setSelectedSession(session);
    setDbSessionId(session.id);
    setDbEventId("");
    setDbError("");
    setDataSource("supabase");

    const rows = Number(session.grid_rows ?? gridSize.rows);
    const cols = Number(session.grid_cols ?? gridSize.cols);
    setGridSize({ rows, cols });
    setGridDb(cloneGridWithHits(rows, cols));

    try {
      const sb = requireSupabase();

      const { data: sum, error: sumErr } = await sb
        .from("session_summaries")
        .select(
          "session_id, num_events, session_duration_ms, cadence_hz_avg, cadence_hz_median, peak_force_stats, impulse_stats, longest_pause_ms, Date_Of_Record"
        )
        .eq("session_id", session.id)
        .maybeSingle();

      if (sumErr) {
        appendLine(`[warn] Failed to load session_summaries for ${session.id}: ${sumErr.message}`);
        setSelectedSummary(null);
      } else {
        setSelectedSummary((sum ?? null) as SessionSummaryRow | null);
      }
    } catch (e: any) {
      setSelectedSummary(null);
      appendLine(`[warn] ${e?.message ?? String(e)}`);
    }

    if (opts?.autoLoadLatestEvent) {
      await loadLatestFromSupabase();
    }
  }

  async function fetchRecentSessions() {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const sb = requireSupabase();

      const { data: sess, error: sessErr } = await sb
        .from("sessions")
        .select("id, started_at_ms, ended_at_ms, grid_rows, grid_cols, device_model, sampling_hz")
        .order("started_at_ms", { ascending: false })
        .limit(5);

      if (sessErr) throw sessErr;

      const sessions = (sess ?? []) as SessionRow[];
      setRecentSessions(sessions);

      if (!selectedSession && sessions.length) {
        await selectSession(sessions[0], { autoLoadLatestEvent: false });
      }
    } catch (e: any) {
      setSessionsError(e?.message ?? String(e));
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    // If Supabase isn't configured, still render the page (don’t blank screen)
    if (!supabase) {
      setSessionsError(
        "Supabase not configured on this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel."
      );
      return;
    }
    fetchRecentSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gridToShow = dataSource === "live" ? gridLive : gridDb;

  const supaMaxForce =
    selectedSummary?.peak_force_stats?.max ??
    selectedSummary?.peak_force_stats?.p99 ??
    selectedSummary?.peak_force_stats?.p95 ??
    null;

  const legendForceMax =
    dataSource === "live"
      ? Math.max(1, liveMaxForce)
      : typeof supaMaxForce === "number" && Number.isFinite(supaMaxForce)
      ? Math.max(1, supaMaxForce)
      : 1;

  return (
    <div className="container">
      <h1>Trench Sports FrontEnd</h1>

      <div className="card">
        <div className="row">
          <button onClick={onConnect} disabled={!!conn}>
            Connect Bluetooth
          </button>
          <button onClick={onDisconnect} disabled={!conn}>
            Disconnect
          </button>
          <button onClick={clearLog}>Clear Logs</button>
        </div>

        <p style={{ marginTop: 12 }}>
          <strong>Status:</strong> {status}
        </p>

        <details style={{ marginTop: 12 }}>
          <summary>BLE Config (from VITE_ env vars)</summary>
          <div style={{ marginTop: 8 }}>
            <div>
              Service UUID: <code>{cfg.SERVICE_UUID ?? "NOT SET"}</code>
            </div>
            <div>
              Notify (TX) UUID: <code>{cfg.CHAR_UUID_TX ?? "NOT SET"}</code>
            </div>
            <div>
              Write (RX) UUID: <code>{cfg.CHAR_UUID_RX ?? "NOT SET"}</code>
            </div>
          </div>
        </details>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Contacts</h3>

        <div className="contactsLayout">
          <div className="contactsColGrid">
            <div className="gridWrap">
              <ContactGrid
                grid={gridToShow}
                gridSize={gridSize}
                hitGlowMs={450}
                flipY={true}
                flipX={true}
                mode={metricMode}
                getForceN={getForceN}
              />
            </div>
          </div>

          <div className="contactsColControls" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionCard title="Display Controls">
              <div style={{ marginBottom: 10 }}>
                <div style={{ opacity: 0.8, marginBottom: 6, fontSize: 12 }}>
                  Data Source{" "}
                  <span style={{ marginLeft: 8, opacity: 0.9 }}>
                    • Active: <strong>{dataSource === "live" ? "Live" : "Supabase"}</strong>
                  </span>
                </div>

                <div className="row">
                  <button
                    onClick={() => setDataSource("live")}
                    aria-pressed={dataSource === "live"}
                    style={{
                      border:
                        dataSource === "live"
                          ? "1px solid rgba(0,255,120,0.70)"
                          : "1px solid rgba(255,255,255,0.12)",
                      background: dataSource === "live" ? "rgba(0,255,120,0.12)" : "transparent",
                      fontWeight: dataSource === "live" ? 800 : 600,
                    }}
                  >
                    {dataSource === "live" ? "✓ Live" : "Live"}
                  </button>

                  <button
                    onClick={() => setDataSource("supabase")}
                    aria-pressed={dataSource === "supabase"}
                    style={{
                      border:
                        dataSource === "supabase"
                          ? "1px solid rgba(0,255,120,0.70)"
                          : "1px solid rgba(255,255,255,0.12)",
                      background: dataSource === "supabase" ? "rgba(0,255,120,0.12)" : "transparent",
                      fontWeight: dataSource === "supabase" ? 800 : 600,
                    }}
                  >
                    {dataSource === "supabase" ? "✓ Supabase" : "Supabase"}
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Live Readout">
              <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>
                <div>
                  <span style={{ opacity: 0.75 }}>Last cell:</span>{" "}
                  {liveLast ? `x=${liveLast.c0 + 1}, y=${liveLast.r0 + 1}` : "—"}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Last voltage:</span>{" "}
                  {liveLast ? `${fmtNum(liveLast.voltage, 3)} V` : "—"}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Last force:</span>{" "}
                  {liveLast ? `${fmtNum(liveLast.forceN, 2)} N` : "—"}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Session max voltage:</span> {fmtNum(liveMaxVoltage, 3)} V
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Session max force:</span> {fmtNum(liveMaxForce, 2)} N
                </div>
              </div>

              <LegendBar title="Voltage legend" minLabel="0.0 V" maxLabel="3.3 V" />
              <LegendBar title="Force legend" minLabel="0 N" maxLabel={`500 N`} />

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                Tip: Force uses your current calibration defaults (until you load session calibration from Supabase).
              </div>
            </SectionCard>
          </div>

          <div className="contactsColSessions" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionCard title="Supabase Sessions">
              <div className="row" style={{ marginBottom: 10 }}>
                <button onClick={fetchRecentSessions} disabled={sessionsLoading || !supabase} style={{ width: "100%" }}>
                  {sessionsLoading ? "Refreshing…" : !supabase ? "Supabase not configured" : "Refresh (latest 5)"}
                </button>
              </div>

              {sessionsError ? (
                <div style={{ marginBottom: 10, color: "#ff8080", fontSize: 12 }}>{sessionsError}</div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recentSessions.map((s) => {
                  const active = selectedSession?.id === s.id;
                  const started = s.started_at_ms ? new Date(s.started_at_ms).toLocaleString() : "—";
                  return (
                    <button
                      key={s.id}
                      onClick={() => selectSession(s, { autoLoadLatestEvent: false })}
                      disabled={!supabase}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderRadius: 12,
                        border: active
                          ? "1px solid rgba(0,255,120,0.65)"
                          : "1px solid rgba(255,255,255,0.12)",
                        background: active ? "rgba(0,255,120,0.08)" : "transparent",
                        cursor: "pointer",
                        opacity: supabase ? 1 : 0.6,
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{s.id}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        {started} • {s.device_model ?? "Unknown device"} • {s.grid_rows ?? "?"}×{s.grid_cols ?? "?"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </SectionCard>

            {selectedSession ? (
              <SectionCard title="Session Details">
                <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
                  <div>
                    <span style={{ opacity: 0.75 }}>Session ID:</span> <code>{selectedSession.id}</code>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Device:</span> {selectedSession.device_model ?? "—"}
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Sampling:</span> {selectedSession.sampling_hz ?? "—"} Hz
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Grid:</span> {selectedSession.grid_rows ?? "?"} rows ×{" "}
                    {selectedSession.grid_cols ?? "?"} cols
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Started:</span>{" "}
                    {selectedSession.started_at_ms ? new Date(selectedSession.started_at_ms).toLocaleString() : "—"}
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Ended:</span>{" "}
                    {selectedSession.ended_at_ms ? new Date(selectedSession.ended_at_ms).toLocaleString() : "—"}
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Duration:</span>{" "}
                    {selectedSummary?.session_duration_ms != null
                      ? fmtMs(selectedSummary.session_duration_ms)
                      : selectedSession.started_at_ms && selectedSession.ended_at_ms
                      ? fmtMs(selectedSession.ended_at_ms - selectedSession.started_at_ms)
                      : "—"}
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Events:</span> {selectedSummary?.num_events ?? "—"}
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Cadence avg:</span> {selectedSummary?.cadence_hz_avg ?? "—"} Hz
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Cadence median:</span>{" "}
                    {selectedSummary?.cadence_hz_median ?? "—"} Hz
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <span style={{ opacity: 0.75 }}>Peak Force Stats:</span>
                    <code style={{ display: "block", whiteSpace: "pre-wrap" }}>
                      {selectedSummary?.peak_force_stats ? JSON.stringify(selectedSummary.peak_force_stats, null, 2) : "—"}
                    </code>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <span style={{ opacity: 0.75 }}>Impulse Stats:</span>
                    <code style={{ display: "block", whiteSpace: "pre-wrap" }}>
                      {selectedSummary?.impulse_stats ? JSON.stringify(selectedSummary.impulse_stats, null, 2) : "—"}
                    </code>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <button onClick={loadLatestFromSupabase} disabled={dbLoading || !supabase} style={{ width: "100%" }}>
                    {dbLoading ? "Loading…" : !supabase ? "Supabase not configured" : "Load latest event grid"}
                  </button>
                </div>

                {dbEventId ? (
                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                    Loaded event: <code>{dbEventId}</code>
                  </div>
                ) : null}

                {dbError ? <div style={{ marginTop: 10, color: "#ff8080", fontSize: 12 }}>{dbError}</div> : null}

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Note: <code>event_cells</code> currently stores <code>v_min</code> (not peak). For a better Voltage view
                  from Supabase, add <code>v_max</code> or <code>v_peak</code>.
                </div>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Commands</h3>
        <div className="row">
          <button disabled={!conn} onClick={() => sendCommand("START_LISTEN")}>
            START_LISTEN
          </button>
          <button disabled={!conn} onClick={() => sendCommand("STOP_LISTEN")}>
            STOP_LISTEN
          </button>
          <button disabled={!conn} onClick={() => sendCommand("REQUEST_LOG")}>
            REQUEST_LOG
          </button>
          <button disabled={!conn} onClick={() => sendCommand("CLEAR_LOG")}>
            CLEAR_LOG
          </button>
          <button disabled={!conn} onClick={() => sendCommand("ping")}>
            ping
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Logs</h3>
        <div className="log">{logLines.length ? logLines.join("\n") : "—"}</div>
      </div>
    </div>
  );
}
