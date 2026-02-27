import React, { useEffect, useMemo, useState } from "react";
import ProfileHeader from "../components/profileHeader.jsx";

type Stat = { label: string; value: string; sub?: string };
type Insight = { title: string; body: string; tag: "Power" | "Accuracy" | "Tempo" | "Recovery" };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function Dashboard() {
  // ---------- profile header demo data (swap for real user/profile data) ----------
  const profile = useMemo(
    () => ({
      name: "Jaylen Coleman",
      title: "Analyst",
      team: "Trench SPORTS",
      avatarUrl: "", // put a URL here when available
    }),
    []
  );

  // ---------- lightweight "demo" state ----------
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [hits, setHits] = useState(0);

  const [lastForce, setLastForce] = useState(0);
  const [lastSpeed, setLastSpeed] = useState(0);
  const [lastZone, setLastZone] = useState("—");

  const [series, setSeries] = useState<number[]>(() => Array.from({ length: 32 }, () => 0));

  // Timer
  useEffect(() => {
    if (!sessionActive) return;
    const t = setInterval(() => setElapsedMs((p) => p + 250), 250);
    return () => clearInterval(t);
  }, [sessionActive]);

  // Simulated live feed (replace with your real data pipeline later)
  useEffect(() => {
    if (!connected || !listening) return;

    const t = setInterval(() => {
      // fake an "impact" sometimes when sessionActive
      const shouldHit = sessionActive && Math.random() < 0.28;
      if (!shouldHit) return;

      const f = clamp(18 + Math.random() * 20 + (Math.random() < 0.15 ? 12 : 0), 0, 65);
      const v = clamp(5.4 + Math.random() * 3.1 + (Math.random() < 0.15 ? 1.2 : 0), 0, 12);

      const col = 1 + Math.floor(Math.random() * 8);
      const row = 1 + Math.floor(Math.random() * 12);
      const zone = `C${col}-R${row}`;

      setHits((h) => h + 1);
      setLastForce(f);
      setLastSpeed(v);
      setLastZone(zone);

      setSeries((prev) => {
        const next = prev.slice(1);
        next.push(f);
        return next;
      });
    }, 380);

    return () => clearInterval(t);
  }, [connected, listening, sessionActive]);

  const stats: Stat[] = useMemo(() => {
    const peak = Math.max(0, ...series);
    const avg = series.reduce((a, b) => a + b, 0) / Math.max(1, series.length);
    return [
      { label: "Status", value: connected ? "Connected" : "Disconnected", sub: listening ? "Listening" : "Idle" },
      { label: "Session", value: sessionActive ? "Active" : "Ready", sub: `Elapsed ${formatTime(elapsedMs)}` },
      { label: "Hits", value: String(hits), sub: "This session" },
      { label: "Force", value: `${avg.toFixed(1)} lb`, sub: `Peak ${peak.toFixed(1)} lb` },
    ];
  }, [connected, listening, sessionActive, elapsedMs, hits, series]);

  const insights: Insight[] = useMemo(() => {
    const peak = Math.max(0, ...series);
    const trend =
      series.slice(-8).reduce((a, b) => a + b, 0) / 8 - series.slice(0, 8).reduce((a, b) => a + b, 0) / 8;

    return [
      {
        tag: "Power",
        title: peak > 45 ? "Peak power is strong" : "Build peak power",
        body:
          peak > 45
            ? "You’re hitting high peaks. Maintain form and focus on consistency between sets."
            : "Try shorter, snappier combinations and increase rest quality between bursts.",
      },
      {
        tag: "Accuracy",
        title: "Placement stability",
        body:
          lastZone === "—"
            ? "Start a session to generate zone distribution and heatmap trends."
            : `Most recent impact registered at ${lastZone}. Add more hits to build your heatmap.`,
      },
      {
        tag: "Tempo",
        title: trend > 2 ? "Output trending up" : trend < -2 ? "Output dropping" : "Output steady",
        body:
          trend > 2
            ? "You’re ramping intensity. Keep breathing controlled to avoid accuracy drop."
            : trend < -2
            ? "Power drop detected. Consider longer rest or switch to technique focus."
            : "Stable output. Good time to push precision and reduce wasted movement.",
      },
    ];
  }, [series, lastZone]);

  // ---------- UI handlers ----------
  function toggleConnect() {
    setConnected((c) => {
      const next = !c;
      if (!next) {
        setListening(false);
        setSessionActive(false);
      }
      return next;
    });
  }

  function startListen() {
    if (!connected) return;
    setListening(true);
  }
  function stopListen() {
    setListening(false);
    setSessionActive(false);
  }

  function startSession() {
    if (!connected) return;
    if (!listening) setListening(true);
    setSessionActive(true);
    setElapsedMs(0);
    setHits(0);
    setSeries(Array.from({ length: 32 }, () => 0));
    setLastZone("—");
    setLastForce(0);
    setLastSpeed(0);
  }

  function stopSession() {
    setSessionActive(false);
  }

  return (
    <div className="ts-dash">
      {/* NEW: Profile Header */}
      <ProfileHeader
        profile={profile}
        onEdit={() => alert("Edit profile (wire this up)")}
        onShare={() => alert("Share profile (wire this up)")}
      />

      <div className="ts-dashTop">
        <div className="ts-dashHead">
          <h1 className="ts-dashTitle">Dashboard</h1>
          <p className="ts-dashSub">Realtime training metrics + AI-ready analysis.</p>
        </div>

        <div className="ts-dashActions">
          <button className="ts-btn ts-btnGhost" onClick={toggleConnect}>
            {connected ? "Disconnect" : "Connect"}
          </button>

          <button className="ts-btn ts-btnSecondary" onClick={listening ? stopListen : startListen} disabled={!connected}>
            {listening ? "Stop Listen" : "Start Listen"}
          </button>

          <button
            className="ts-btn ts-btnPrimary"
            onClick={sessionActive ? stopSession : startSession}
            disabled={!connected}
          >
            {sessionActive ? "Stop Session" : "Start Session"}
          </button>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="ts-dashGrid ts-dashGrid4">
        {stats.map((s) => (
          <div key={s.label} className="ts-card ts-statCard">
            <div className="ts-statLabel">{s.label}</div>
            <div className="ts-statValue">{s.value}</div>
            {s.sub ? <div className="ts-statSub">{s.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* MAIN GRID */}
      <div className="ts-dashGrid ts-dashMain">
        {/* Live Readout */}
        <div className="ts-card ts-span2">
          <div className="ts-cardTop">
            <div className="ts-cardTitle">Live Readout</div>
            <div className={`ts-badge ${connected ? "on" : ""}`}>{connected ? "LIVE" : "OFFLINE"}</div>
          </div>

          <div className="ts-liveRow">
            <div className="ts-liveKpi">
              <div className="ts-liveLabel">Last Force</div>
              <div className="ts-liveValue">{lastForce ? `${lastForce.toFixed(1)} lb` : "—"}</div>
            </div>
            <div className="ts-liveKpi">
              <div className="ts-liveLabel">Last Speed</div>
              <div className="ts-liveValue">{lastSpeed ? `${lastSpeed.toFixed(1)} m/s` : "—"}</div>
            </div>
            <div className="ts-liveKpi">
              <div className="ts-liveLabel">Zone</div>
              <div className="ts-liveValue">{lastZone}</div>
            </div>
          </div>

          {/* Simple “chart” placeholder */}
          <div className="ts-miniChart" aria-label="Force chart placeholder">
            {series.map((v, i) => (
              <div
                key={i}
                className="ts-bar"
                style={{ height: `${clamp((v / 65) * 100, 2, 100)}%` }}
                title={`${v.toFixed(1)} lb`}
              />
            ))}
          </div>

          <div className="ts-cardHint">
            Replace this with your real charts (force over time, speed over time, zone frequency) when data is wired in.
          </div>
        </div>

        {/* Heatmap Placeholder */}
        <div className="ts-card">
          <div className="ts-cardTop">
            <div className="ts-cardTitle">Impact Heatmap</div>
            <div className="ts-cardMeta">12×8 grid</div>
          </div>

          <div className="ts-heatmap">
            {Array.from({ length: 96 }).map((_, i) => {
              const hot = sessionActive && (i + hits * 7) % 19 === 0;
              const warm = sessionActive && (i + hits * 11) % 29 === 0;
              return <div key={i} className={`ts-cell ${hot ? "hot" : warm ? "warm" : ""}`} />;
            })}
          </div>

          <div className="ts-cardHint">Placeholder — later you’ll map (row,col) frequencies and intensity to cell color.</div>
        </div>

        {/* AI Insights */}
        <div className="ts-card ts-span2">
          <div className="ts-cardTop">
            <div className="ts-cardTitle">AI Insights</div>
            <div className="ts-cardMeta">placeholders</div>
          </div>

          <div className="ts-insights">
            {insights.map((it) => (
              <div key={it.title} className="ts-insight">
                <div className="ts-insightTop">
                  <div className="ts-tag">{it.tag}</div>
                  <div className="ts-insightTitle">{it.title}</div>
                </div>
                <div className="ts-insightBody">{it.body}</div>
              </div>
            ))}
          </div>

          <div className="ts-cardHint">
            Next: wire in “session summary” generation (peak/avg, strike clusters, fatigue trend, recommended drills).
          </div>
        </div>

        {/* Analysis */}
        <div className="ts-card">
          <div className="ts-cardTop">
            <div className="ts-cardTitle">In-Depth Analysis</div>
            <div className="ts-cardMeta">coming soon</div>
          </div>

          <div className="ts-list">
            <div className="ts-listItem">
              <div className="ts-listTitle">Consistency Score</div>
              <div className="ts-listVal">{connected ? "—" : "Connect to compute"}</div>
            </div>
            <div className="ts-listItem">
              <div className="ts-listTitle">Fatigue Curve</div>
              <div className="ts-listVal">Placeholder</div>
            </div>
            <div className="ts-listItem">
              <div className="ts-listTitle">Accuracy Drift</div>
              <div className="ts-listVal">Placeholder</div>
            </div>
            <div className="ts-listItem">
              <div className="ts-listTitle">Tempo Breakdown</div>
              <div className="ts-listVal">Placeholder</div>
            </div>
          </div>

          <button className="ts-btn ts-btnGhostWide" type="button" onClick={() => alert("Open analysis view later")}>
            Open Analysis
          </button>
        </div>

        {/* Charts */}
        <div className="ts-card ts-span2">
          <div className="ts-cardTop">
            <div className="ts-cardTitle">Charts & Graphs</div>
            <div className="ts-cardMeta">placeholders</div>
          </div>

          <div className="ts-chartsGrid">
            <div className="ts-chartStub">
              <div className="ts-chartTitle">Force Distribution</div>
              <div className="ts-chartBox" />
            </div>
            <div className="ts-chartStub">
              <div className="ts-chartTitle">Speed Over Time</div>
              <div className="ts-chartBox" />
            </div>
            <div className="ts-chartStub">
              <div className="ts-chartTitle">Zone Frequency</div>
              <div className="ts-chartBox" />
            </div>
            <div className="ts-chartStub">
              <div className="ts-chartTitle">Session Comparisons</div>
              <div className="ts-chartBox" />
            </div>
          </div>

          <div className="ts-cardHint">If you want, we can add a chart library next (Recharts is a great pick for React).</div>
        </div>
      </div>
    </div>
  );
}