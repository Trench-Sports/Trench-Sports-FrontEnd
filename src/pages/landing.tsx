// src/pages/Landing.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type Stat = { label: string; value: string; sub?: string };

export default function Landing() {
  const stats: Stat[] = useMemo(
    () => [
      { label: "Impact Events", value: "3600/sec", sub: "Burst-mode capture" },
      { label: "Matrix Cells", value: "96", sub: "12×8 sensor grid" },
      { label: "Latency", value: "<100ms", sub: "Realtime feedback loop" },
      { label: "Modes", value: "Listen + Burst", sub: "Smart trigger switching" },
    ],
    []
  );

  const [active, setActive] = useState<0 | 1 | 2>(0);

  // Simple “auto-rotate” showcase
  useEffect(() => {
    const t = setInterval(() => setActive((p) => ((p + 1) % 3) as 0 | 1 | 2), 5500);
    return () => clearInterval(t);
  }, []);

  const showcases = [
    {
      title: "AI-Driven. Data Dominance.",
      body:
        "Turn every rep into measurable performance. Trench Sports captures impact location, force, and tempo — then converts it into actionable insights.",
      bullets: ["Force + speed analytics", "Heatmaps & trend tracking", "Session summaries"],
    },
    {
      title: "Built for the grind.",
      body:
        "Designed for athletes and coaches: fast setup, consistent reads, and clean UI. The system stays out of the way — and shows up when it matters.",
      bullets: ["Fast connect workflow", "Reliable logging", "Coach-friendly outputs"],
    },
    {
      title: "Realtime feedback loop.",
      body:
        "Listen mode stays efficient. Burst mode spikes sampling when impact is detected, capturing the full hit profile in high resolution.",
      bullets: ["Trigger-based burst capture", "High-frequency scanning", "Low overhead idle"],
    },
  ] as const;

  return (
    <div className="ts-landing">

      {/* HERO */}
      <section className="ts-hero">
        <div className="ts-heroInner">
          <div className="ts-heroLeft">
            <div className="ts-pill">
              <span className="ts-dot" />
              Trench Sports Platform
            </div>

            <h1 className="ts-h1">
              AI Driven,
              <br />
              <span className="ts-gradientText">Data Dominance.</span>
            </h1>

            <p className="ts-sub">
              Measure strike force, speed, and placement — instantly. Built for training sessions where data needs to be
              fast, clean, and useful.
            </p>

            <div className="ts-ctaRow">
              <Link className="ts-btnPrimary" to="/signup">
                Get Started
              </Link>
              <Link className="ts-btnSecondary" to="/dashboard">
                Open Dashboard
              </Link>
            </div>

            <div className="ts-miniRow">
              <div className="ts-miniItem">
                <span className="ts-miniKicker">Realtime</span>
                <span className="ts-miniText">Live metrics + session logs</span>
              </div>
              <div className="ts-miniItem">
                <span className="ts-miniKicker">Portable</span>
                <span className="ts-miniText">Battery-powered training</span>
              </div>
              <div className="ts-miniItem">
                <span className="ts-miniKicker">Coach-ready</span>
                <span className="ts-miniText">Insights you can act on</span>
              </div>
            </div>
          </div>

          {/* Right visual: “interactive” cards */}
          <div className="ts-heroRight">
            <div className="ts-glass">
              <div className="ts-glassTop">
                <div className="ts-glassTitle">Live Impact Snapshot</div>
                <div className="ts-glassBadge">SIM</div>
              </div>

              <div className="ts-gridViz">
                {Array.from({ length: 96 }).map((_, i) => {
                  // deterministic “pulse hotspot”
                  const hotspot = (i + active * 7) % 23 === 0 || (i + active * 11) % 41 === 0;
                  return <div key={i} className={`ts-cell ${hotspot ? "hot" : ""}`} />;
                })}
              </div>

              <div className="ts-glassFooter">
                <div className="ts-kpi">
                  <span className="ts-kpiLabel">Force</span>
                  <span className="ts-kpiVal">{active === 0 ? "28.4 lb" : active === 1 ? "31.7 lb" : "24.9 lb"}</span>
                </div>
                <div className="ts-kpi">
                  <span className="ts-kpiLabel">Speed</span>
                  <span className="ts-kpiVal">{active === 0 ? "7.2 m/s" : active === 1 ? "8.1 m/s" : "6.6 m/s"}</span>
                </div>
                <div className="ts-kpi">
                  <span className="ts-kpiLabel">Zone</span>
                  <span className="ts-kpiVal">{active === 0 ? "C4-R7" : active === 1 ? "C6-R5" : "C3-R9"}</span>
                </div>
              </div>
            </div>

            <div className="ts-floatCard">
              <div className="ts-floatTitle">Session Insight</div>
              <div className="ts-floatBody">
                {active === 0 && "Power trending up — keep tempo consistent for 3 more sets."}
                {active === 1 && "Strike placement drifting right — adjust stance alignment."}
                {active === 2 && "Peak force stable — push speed focus to improve snap."}
              </div>
              <div className="ts-floatBar">
                <div className={`ts-floatDot ${active === 0 ? "on" : ""}`} />
                <div className={`ts-floatDot ${active === 1 ? "on" : ""}`} />
                <div className={`ts-floatDot ${active === 2 ? "on" : ""}`} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <h2 className="ts-h2">Performance-grade capture</h2>
            <p className="ts-muted">Fast sampling + clean outputs. Built to scale from individual training to team use.</p>
          </div>

          <div className="ts-statGrid">
            {stats.map((s) => (
              <div key={s.label} className="ts-statCard">
                <div className="ts-statLabel">{s.label}</div>
                <div className="ts-statValue">{s.value}</div>
                {s.sub ? <div className="ts-statSub">{s.sub}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SHOWCASE */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-showcase">
            <div className="ts-tabs">
              {(["Analytics", "Workflow", "Realtime"] as const).map((t, idx) => (
                <button
                  key={t}
                  className={`ts-tab ${active === idx ? "active" : ""}`}
                  onClick={() => setActive(idx as 0 | 1 | 2)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="ts-showcaseCard">
              <h3 className="ts-h3">{showcases[active].title}</h3>
              <p className="ts-muted">{showcases[active].body}</p>
              <ul className="ts-bullets">
                {showcases[active].bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>

              <div className="ts-showcaseCtas">
                <Link className="ts-btnPrimary" to="/signup">
                  Start Free
                </Link>
                <Link className="ts-btnGhost" to="/dashboard">
                  View Demo Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand">Trench Sports</div>
          <div className="ts-footerLinks">
            <Link to="/signup">Signup</Link>
            <Link to="/dashboard">Dashboard</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>
    </div>
  );
}