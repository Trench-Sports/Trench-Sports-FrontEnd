// src/pages/dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import ProfileHeader, { Profile } from "../components/profileHeader";
import { supabase } from "../supabaseClient";

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

type TabKey = "recent" | "insights" | "athletes";
type MetricKey = "strength" | "reaction" | "accuracy";

type LeaderRow =
  | {
      name: string;
      metric: "strength";
      peakStrength: number; // lb
      avgStrength: number; // lb
      sessions: number;
    }
  | {
      name: string;
      metric: "reaction";
      avgReactionMs: number; // ms (lower is better)
      bestReactionMs: number; // ms
      attempts: number;
    }
  | {
      name: string;
      metric: "accuracy";
      accuracyPct: number; // %
      avgOffsetCm: number; // cm (lower is better)
      onTargetHits: number;
      totalHits: number;
    };

export default function Dashboard() {
  // ---------- tabs ----------
  const [activeTab, setActiveTab] = useState<TabKey>("recent");

  // ---------- profile ----------
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return;

    async function fetchProfile() {
      const { data: userData } = await supabase!.auth.getUser();
      const user = userData?.user;
      if (!user) return;

      // Single round-trip: join programs table to get the program name
      const { data, error } = await supabase!
        .from("profiles")
        .select("first_name, last_name, role, city, state, programs(name)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !data) return;

      setProfile({
        name: [data.first_name, data.last_name].filter(Boolean).join(" ") || "—",
        role: data.role ?? "",
        location: [data.city, data.state].filter(Boolean).join(", "),
        program: (data.programs as any)?.name ?? "",
      });
    }

    fetchProfile();
  }, []);

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
    const avg = series.reduce((a, b) => a + b, 0) / Math.max(1, series.length);
    const trend = series.slice(-8).reduce((a, b) => a + b, 0) / 8 - series.slice(0, 8).reduce((a, b) => a + b, 0) / 8;

    return [
      {
        tag: "Power",
        title: peak > 45 ? "Peak power is strong" : "Build peak power",
        body:
          peak > 45
            ? "You're hitting high peaks. Maintain form and focus on consistency between sets."
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
            ? "You're ramping intensity. Keep breathing controlled to avoid accuracy drop."
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

  // ---------- Leaderboard ----------
  const [leaderMetric, setLeaderMetric] = useState<MetricKey>("strength");

  // Sample current + previous values so we can compute "Most Improved"
  const sampleBoards = useMemo(() => {
    // Current values
    const strengthNow: Array<Extract<LeaderRow, { metric: "strength" }>> = [
      { metric: "strength", name: "Jordan Lee", peakStrength: 61.4, avgStrength: 42.8, sessions: 12 },
      { metric: "strength", name: "Maya Patel", peakStrength: 58.9, avgStrength: 44.1, sessions: 10 },
      { metric: "strength", name: "Chris Nguyen", peakStrength: 55.2, avgStrength: 40.3, sessions: 9 },
      { metric: "strength", name: "Sam Rivera", peakStrength: 53.0, avgStrength: 39.7, sessions: 8 },
      { metric: "strength", name: "Avery Kim", peakStrength: 49.6, avgStrength: 37.9, sessions: 7 },
    ];

    // Previous snapshot (same players)
    const strengthPrev = [
      { name: "Jordan Lee", peakStrength: 58.0, avgStrength: 40.9 },
      { name: "Maya Patel", peakStrength: 55.8, avgStrength: 42.0 },
      { name: "Chris Nguyen", peakStrength: 50.5, avgStrength: 37.6 },
      { name: "Sam Rivera", peakStrength: 51.7, avgStrength: 38.9 },
      { name: "Avery Kim", peakStrength: 46.2, avgStrength: 36.8 },
    ];

    const reactionNow: Array<Extract<LeaderRow, { metric: "reaction" }>> = [
      { metric: "reaction", name: "Maya Patel", avgReactionMs: 238, bestReactionMs: 205, attempts: 42 },
      { metric: "reaction", name: "Jordan Lee", avgReactionMs: 246, bestReactionMs: 212, attempts: 39 },
      { metric: "reaction", name: "Avery Kim", avgReactionMs: 259, bestReactionMs: 221, attempts: 35 },
      { metric: "reaction", name: "Chris Nguyen", avgReactionMs: 271, bestReactionMs: 233, attempts: 31 },
      { metric: "reaction", name: "Sam Rivera", avgReactionMs: 284, bestReactionMs: 245, attempts: 28 },
    ];

    const reactionPrev = [
      { name: "Maya Patel", avgReactionMs: 255, bestReactionMs: 220 },
      { name: "Jordan Lee", avgReactionMs: 262, bestReactionMs: 226 },
      { name: "Avery Kim", avgReactionMs: 279, bestReactionMs: 239 },
      { name: "Chris Nguyen", avgReactionMs: 290, bestReactionMs: 248 },
      { name: "Sam Rivera", avgReactionMs: 295, bestReactionMs: 255 },
    ];

    const accuracyNow: Array<Extract<LeaderRow, { metric: "accuracy" }>> = [
      { metric: "accuracy", name: "Avery Kim", accuracyPct: 91.2, avgOffsetCm: 2.8, onTargetHits: 228, totalHits: 250 },
      { metric: "accuracy", name: "Chris Nguyen", accuracyPct: 88.5, avgOffsetCm: 3.1, onTargetHits: 177, totalHits: 200 },
      { metric: "accuracy", name: "Maya Patel", accuracyPct: 86.0, avgOffsetCm: 3.4, onTargetHits: 215, totalHits: 250 },
      { metric: "accuracy", name: "Jordan Lee", accuracyPct: 83.6, avgOffsetCm: 3.9, onTargetHits: 209, totalHits: 250 },
      { metric: "accuracy", name: "Sam Rivera", accuracyPct: 81.0, avgOffsetCm: 4.2, onTargetHits: 162, totalHits: 200 },
    ];

    const accuracyPrev = [
      { name: "Avery Kim", accuracyPct: 86.7, avgOffsetCm: 3.3 },
      { name: "Chris Nguyen", accuracyPct: 85.9, avgOffsetCm: 3.6 },
      { name: "Maya Patel", accuracyPct: 82.4, avgOffsetCm: 3.9 },
      { name: "Jordan Lee", accuracyPct: 81.1, avgOffsetCm: 4.1 },
      { name: "Sam Rivera", accuracyPct: 79.2, avgOffsetCm: 4.5 },
    ];

    return {
      strengthNow,
      strengthPrev,
      reactionNow,
      reactionPrev,
      accuracyNow,
      accuracyPrev,
    };
  }, []);

  const leaderboardData = useMemo<LeaderRow[]>(() => {
    const { strengthNow, reactionNow, accuracyNow } = sampleBoards;

    if (leaderMetric === "strength") {
      return strengthNow.slice().sort((a, b) => b.peakStrength - a.peakStrength);
    }
    if (leaderMetric === "reaction") {
      return reactionNow.slice().sort((a, b) => a.avgReactionMs - b.avgReactionMs);
    }
    return accuracyNow.slice().sort((a, b) => b.accuracyPct - a.accuracyPct);
  }, [leaderMetric, sampleBoards]);

  // Compute Most Improved with deltas for both metrics per category
  const mostImproved = useMemo(() => {
    const {
      strengthNow,
      strengthPrev,
      reactionNow,
      reactionPrev,
      accuracyNow,
      accuracyPrev,
    } = sampleBoards;

    const prevStrMap = new Map(strengthPrev.map((x) => [x.name, x]));
    const prevReactMap = new Map(reactionPrev.map((x) => [x.name, x]));
    const prevAccMap = new Map(accuracyPrev.map((x) => [x.name, x]));

    // Strength: find largest improvements for peak & avg separately, but pick top combined scorer for display
    let bestStrengthCombined = { name: "—", deltaPeak: 0, deltaAvg: 0, combinedScore: 0 };
    for (const cur of strengthNow) {
      const prev = prevStrMap.get(cur.name);
      if (!prev) continue;
      const deltaPeak = cur.peakStrength - (prev.peakStrength ?? 0);
      const deltaAvg = cur.avgStrength - (prev.avgStrength ?? 0);
      // Weighted combined: give peak more weight
      const combinedScore = deltaPeak * 1.2 + deltaAvg * 0.8;
      if (combinedScore > bestStrengthCombined.combinedScore) {
        bestStrengthCombined = { name: cur.name, deltaPeak, deltaAvg, combinedScore };
      }
    }

    // Reaction: improvement is a reduction in ms (positive = faster). We'll compute avg & best improvements.
    let bestReactionCombined = { name: "—", deltaAvgMs: 0, deltaBestMs: 0, combinedScore: 0 };
    for (const cur of reactionNow) {
      const prev = prevReactMap.get(cur.name);
      if (!prev) continue;
      const deltaAvgMs = (prev.avgReactionMs ?? 0) - cur.avgReactionMs; // positive is improvement
      const deltaBestMs = (prev.bestReactionMs ?? 0) - cur.bestReactionMs; // positive is improvement
      // Combine with slightly more weight to avg reaction improvement
      const combinedScore = deltaAvgMs * 1.1 + deltaBestMs * 0.9;
      if (combinedScore > bestReactionCombined.combinedScore) {
        bestReactionCombined = { name: cur.name, deltaAvgMs, deltaBestMs, combinedScore };
      }
    }

    // Accuracy: improvement in pct and offset (offset decrease is improvement)
    let bestAccuracyCombined = { name: "—", deltaPct: 0, deltaOffsetCm: 0, combinedScore: 0 };
    for (const cur of accuracyNow) {
      const prev = prevAccMap.get(cur.name);
      if (!prev) continue;
      const deltaPct = cur.accuracyPct - (prev.accuracyPct ?? 0); // positive is improvement
      const deltaOffsetCm = (prev.avgOffsetCm ?? 0) - cur.avgOffsetCm; // positive if closer
      const combinedScore = deltaPct * 1.0 + deltaOffsetCm * 0.6; // weight accuracy more
      if (combinedScore > bestAccuracyCombined.combinedScore) {
        bestAccuracyCombined = { name: cur.name, deltaPct, deltaOffsetCm, combinedScore };
      }
    }

    return {
      strength: bestStrengthCombined,
      reaction: bestReactionCombined,
      accuracy: bestAccuracyCombined,
    };
  }, [sampleBoards]);

  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      className={`ts-tabBtn ${activeTab === key ? "isActive" : ""}`}
      onClick={() => setActiveTab(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="ts-dash">
      {/* PROFILE HEADER — null while fetching, populates once Supabase responds */}
      <ProfileHeader profile={profile} onEdit={() => alert("Open edit profile")} onShare={() => alert("Open share sheet")} />

      <div className="ts-dashTop">
        <div className="ts-dashHead">
          <h1 className="ts-dashTitle">Dashboard</h1>

          {/* TABS (under heading) */}
          <div className="ts-tabs" role="tablist" aria-label="Dashboard sections">
            {tabBtn("recent", "Recent Session")}
            {tabBtn("insights", "Insights and Analysis")}
            {tabBtn("athletes", "Individual Athletes")}
          </div>

          <p className="ts-dashSub">Realtime training metrics + AI-ready analysis.</p>
        </div>

        <div className="ts-dashActions">
          <button className="ts-btn ts-btnGhost" onClick={toggleConnect}>
            {connected ? "Disconnect" : "Connect"}
          </button>

          <button className="ts-btn ts-btnSecondary" onClick={listening ? stopListen : startListen} disabled={!connected}>
            {listening ? "Stop Listen" : "Start Listen"}
          </button>

          <button className="ts-btn ts-btnPrimary" onClick={sessionActive ? stopSession : startSession} disabled={!connected}>
            {sessionActive ? "Stop Session" : "Start Session"}
          </button>
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === "recent" ? (
        <>
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

              <div className="ts-cardHint">Placeholder — later you'll map (row,col) frequencies and intensity to cell color.</div>
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
                Next: wire in "session summary" generation (peak/avg, strike clusters, fatigue trend, recommended drills).
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
        </>
      ) : activeTab === "insights" ? (
        <div className="ts-dashGrid ts-dashMain">
          {/* Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Leaderboard</div>
              <div className="ts-cardMeta">sample data</div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                View top performers by metric. Accuracy highlights: <b>Accuracy %</b> + <b>Avg Offset</b> (distance from center).
              </div>

              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="leaderMetric">
                  Metric
                </label>
                <select
                  id="leaderMetric"
                  className="ts-select"
                  value={leaderMetric}
                  onChange={(e) => setLeaderMetric(e.target.value as MetricKey)}
                >
                  <option value="strength">Strength</option>
                  <option value="reaction">Reaction Time</option>
                  <option value="accuracy">Accuracy</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">
                  #
                </div>
                <div className="ts-leaderCell name" role="columnheader">
                  Athlete
                </div>

                {leaderMetric === "strength" ? (
                  <>
                    <div className="ts-leaderCell" role="columnheader">
                      Peak Strength
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      Avg Strength
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      Sessions
                    </div>
                  </>
                ) : leaderMetric === "reaction" ? (
                  <>
                    <div className="ts-leaderCell" role="columnheader">
                      Avg Reaction
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      Best
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      Attempts
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ts-leaderCell" role="columnheader">
                      Accuracy
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      Avg Offset
                    </div>
                    <div className="ts-leaderCell" role="columnheader">
                      On Target
                    </div>
                  </>
                )}
              </div>

              {leaderboardData.map((row, idx) => (
                <div key={`${row.name}-${idx}`} className="ts-leaderRow" role="row">
                  <div className="ts-leaderCell rank" role="cell">
                    {idx + 1}
                  </div>
                  <div className="ts-leaderCell name" role="cell">
                    <div className="ts-leaderName">{row.name}</div>
                    <div className="ts-leaderSub">
                      {leaderMetric === "strength"
                        ? "Power profile"
                        : leaderMetric === "reaction"
                        ? "Reflex profile"
                        : "Precision profile"}
                    </div>
                  </div>

                  {row.metric === "strength" ? (
                    <>
                      <div className="ts-leaderCell" role="cell">
                        {row.peakStrength.toFixed(1)} lb
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {row.avgStrength.toFixed(1)} lb
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {row.sessions}
                      </div>
                    </>
                  ) : row.metric === "reaction" ? (
                    <>
                      <div className="ts-leaderCell" role="cell">
                        {Math.round(row.avgReactionMs)} ms
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {Math.round(row.bestReactionMs)} ms
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {row.attempts}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ts-leaderCell" role="cell">
                        {row.accuracyPct.toFixed(1)}%
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {row.avgOffsetCm.toFixed(1)} cm
                      </div>
                      <div className="ts-leaderCell" role="cell">
                        {row.onTargetHits}/{row.totalHits}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="ts-cardHint">Next upgrades: add time range (Last session / 7d / 30d / All-time) and filters (program/team), then wire this to Supabase.</div>
          </div>

          {/* Most Improved (replaces Notes) */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">top movers (previous → now)</div>
            </div>

            <div className="ts-mostImproved">
              {/* Strength */}
              <div className="ts-mostRow">
                <div className="ts-miLabel">
                  <div className="ts-miTitle">Strength</div>
                  <div className="ts-miSubtitle">largest combined jump (peak & avg)</div>
                </div>
                <div className="ts-miBody">
                  <div className="ts-miName">{mostImproved.strength.name}</div>
                  <div className="ts-miPills">
                    <div className="ts-improvePill">Peak: +{mostImproved.strength.deltaPeak.toFixed(1)} lb</div>
                    <div className="ts-improvePill">Avg: +{mostImproved.strength.deltaAvg.toFixed(1)} lb</div>
                  </div>
                </div>
              </div>

              {/* Reaction */}
              <div className="ts-mostRow">
                <div className="ts-miLabel">
                  <div className="ts-miTitle">Reaction Time</div>
                  <div className="ts-miSubtitle">avg & best (ms) — reduction = improvement</div>
                </div>
                <div className="ts-miBody">
                  <div className="ts-miName">{mostImproved.reaction.name}</div>
                  <div className="ts-miPills">
                    <div className="ts-improvePill">{Math.round(mostImproved.reaction.deltaAvgMs)} ms faster (avg)</div>
                    <div className="ts-improvePill">{Math.round(mostImproved.reaction.deltaBestMs)} ms faster (best)</div>
                  </div>
                </div>
              </div>

              {/* Accuracy */}
              <div className="ts-mostRow">
                <div className="ts-miLabel">
                  <div className="ts-miTitle">Accuracy</div>
                  <div className="ts-miSubtitle">accuracy % & avg offset (cm)</div>
                </div>
                <div className="ts-miBody">
                  <div className="ts-miName">{mostImproved.accuracy.name}</div>
                  <div className="ts-miPills">
                    <div className="ts-improvePill">+{mostImproved.accuracy.deltaPct.toFixed(1)} pp (accuracy)</div>
                    <div className="ts-improvePill">
                      {mostImproved.accuracy.deltaOffsetCm > 0
                        ? `${mostImproved.accuracy.deltaOffsetCm.toFixed(1)} cm closer`
                        : `${Math.abs(mostImproved.accuracy.deltaOffsetCm).toFixed(1)} cm wider`}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ts-cardHint">
              “Most Improved” shows deltas between two sample snapshots (previous → current). When wired to real data, we’ll compute deltas over a selectable time range.
            </div>
          </div>
        </div>
      ) : (
        <div className="ts-dashGrid ts-dashMain">
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Individual Athletes</div>
              <div className="ts-cardMeta">tab view</div>
            </div>

            <div className="ts-cardHint">Placeholder tab. Next step could be an athletes table + athlete profile drill-down.</div>

            <button className="ts-btn ts-btnGhostWide" type="button" onClick={() => alert("Build individual athletes view")}>
              Manage Athletes
            </button>
          </div>
        </div>
      )}

      {/* Tiny scoped styles so we don't disturb your existing design system */}
      <style>{`
        .ts-tabs{
          display:flex;
          gap:10px;
          margin-top:12px;
          margin-bottom:4px;
          flex-wrap:wrap;
        }
        .ts-tabBtn{
          appearance:none;
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: inherit;
          padding: 8px 12px;
          border-radius: 999px;
          cursor:pointer;
          font: inherit;
          line-height: 1;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        }
        .ts-tabBtn:hover{
          background: rgba(255,255,255,0.07);
          transform: translateY(-1px);
        }
        .ts-tabBtn.isActive{
          border-color: rgba(255,255,255,0.22);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        }
        .ts-tabBtn:active{
          transform: translateY(1px);
        }

        /* Leaderboard */
        .ts-leaderTop{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:14px;
          margin-top:8px;
          margin-bottom:14px;
          flex-wrap:wrap;
        }
        .ts-leaderNote{
          opacity:0.95;
          font-size:14px;
          max-width: 740px;
        }
        .ts-leaderControls{
          display:flex;
          align-items:center;
          gap:10px;
        }
        .ts-leaderLabel{
          font-size:12px;
          opacity:0.85;
        }
        .ts-select{
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: inherit;
          padding: 8px 12px;
          border-radius: 12px;
          font: inherit;
          outline:none;
        }
        .ts-leaderTable{
          display:flex;
          flex-direction:column;
          gap:10px;
        }
        .ts-leaderRow{
          display:grid;
          grid-template-columns: 44px 1.6fr 1fr 1fr 0.8fr;
          gap:10px;
          padding: 12px;
          border:1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          align-items:center;
        }
        .ts-leaderHead{
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.12);
          font-size:12px;
          letter-spacing:0.02em;
          text-transform:uppercase;
          opacity:0.95;
        }
        .ts-leaderCell{
          display:flex;
          align-items:center;
          min-width:0;
        }
        .ts-leaderCell.rank{
          justify-content:center;
          font-variant-numeric: tabular-nums;
          opacity:0.85;
        }
        .ts-leaderCell.name{
          flex-direction:column;
          align-items:flex-start;
          gap:2px;
        }
        .ts-leaderName{
          font-weight:600;
        }
        .ts-leaderSub{
          font-size:12px;
          opacity:0.75;
        }
        @media (max-width: 880px){
          .ts-leaderRow{
            grid-template-columns: 40px 1.6fr 1fr 1fr;
          }
          .ts-leaderRow .ts-leaderCell:last-child{
            display:none;
          }
        }

        /* Most Improved */
        .ts-mostImproved{
          display:flex;
          flex-direction:column;
          gap:12px;
          margin-top:8px;
        }
        .ts-mostRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .ts-miLabel{
          min-width: 180px;
        }
        .ts-miTitle{
          font-weight:600;
          font-size:15px;
        }
        .ts-miSubtitle{
          font-size:12px;
          opacity:0.7;
          margin-top:4px;
        }
        .ts-miBody{
          display:flex;
          align-items:center;
          gap:16px;
          min-width:220px;
        }
        .ts-miName{
          font-weight:600;
          min-width:120px;
        }
        .ts-miPills{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .ts-improvePill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding: 6px 10px;
          border-radius: 999px;
          border:1px solid rgba(255,255,255,0.10);
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          font-size: 13px;
          white-space: nowrap;
        }
        .ts-cardMeta{
          opacity:0.85;
        }
        .ts-cardHint{
          margin-top:10px;
          opacity:0.85;
          font-size:13px;
        }

        @media (max-width: 720px) {
          .ts-miBody{
            flex-direction:column;
            align-items:flex-start;
            gap:6px;
          }
          .ts-miLabel{
            min-width: auto;
          }
        }
      `}</style>
    </div>
  );
}