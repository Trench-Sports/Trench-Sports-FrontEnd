// src/pages/landing.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import HitSimulator from "../components/hitSimulator";

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

  // Auto-rotate showcase tabs
  useEffect(() => {
    const t = setInterval(() => setActive((p) => ((p + 1) % 3) as 0 | 1 | 2), 5500);
    return () => clearInterval(t);
  }, []);

  const showcases = [
    {
      title: "AI-Driven. Data Dominance.",
      body: "Turn every rep into measurable performance. Trench Sports captures impact location, force, and tempo — then converts it into actionable insights.",
      bullets: ["Force + speed analytics", "Heatmaps & trend tracking", "Session summaries"],
    },
    {
      title: "Built for the grind.",
      body: "Designed for athletes and coaches: fast setup, consistent reads, and clean UI. The system stays out of the way — and shows up when it matters.",
      bullets: ["Fast connect workflow", "Reliable logging", "Coach-friendly outputs"],
    },
    {
      title: "Realtime feedback loop.",
      body: "Listen mode stays efficient. Burst mode spikes sampling when impact is detected, capturing the full hit profile in high resolution.",
      bullets: ["Trigger-based burst capture", "High-frequency scanning", "Low overhead idle"],
    },
  ] as const;

  return (
    <div className="ts-landing">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="ts-hero">
        <div className="ts-heroInner">

          {/* Left: copy + CTAs */}
          <div className="ts-heroLeft">
            <div className="ts-pill">
              <span className="ts-dot" />
              Trench Sports
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

          {/* Right: interactive simulator */}
          <div className="ts-heroRight">
            <HitSimulator />
          </div>

        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────── */}
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

      {/* ── SHOWCASE ──────────────────────────────────────────── */}
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

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand">Trench Sports</div>
          <div className="ts-footerLinks">
            <Link to="/signup">Signup</Link>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>
    </div>
  );
}