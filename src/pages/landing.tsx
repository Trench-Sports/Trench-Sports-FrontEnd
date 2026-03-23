// src/pages/landing.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import HitSimulator from "../components/hitSimulator";
import LandingNav, { LANDING_NAV_SECTIONS } from "../components/landingNav";

type Stat = { label: string; value: string; sub?: string };

// ── Animated counter hook ─────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1800, started = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!started) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setVal(Math.floor(ease * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, started]);
  return val;
}

// ── Intersection observer hook ────────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// ── Impact counter card ───────────────────────────────────────────────────────
function ImpactCounter({ value, suffix = "", label, started }: {
  value: number; suffix?: string; label: string; started: boolean;
}) {
  const count = useCountUp(value, 1800, started);
  return (
    <div className="ts-impactCard">
      <div className="ts-impactValue">
        {count.toLocaleString()}{suffix}
      </div>
      <div className="ts-impactLabel">{label}</div>
    </div>
  );
}

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

  const { ref: impactRef, inView: impactInView } = useInView();
  const { ref: navRef, inView: _navInView } = useInView(0);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");

  // Scroll-tracking: pick whichever section is closest to top of viewport
  useEffect(() => {
    const ids = LANDING_NAV_SECTIONS.map((s) => s.id);
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) {
          current = id;
        }
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // run once on mount
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const howItWorks = [
    {
      step: "01",
      title: "Set Up in Seconds",
      body: "Mount the 96-cell sensor pad to any standard training surface. Battery-powered, no wires, no calibration — just connect and go.",
      icon: "⚡",
    },
    {
      step: "02",
      title: "Train Normally",
      body: "Athletes train at full intensity. Listen mode idles in the background and triggers Burst mode automatically on every significant impact.",
      icon: "🏋️",
    },
    {
      step: "03",
      title: "See the Data Instantly",
      body: "Force maps, velocity trends, and placement heatmaps appear live on the coach dashboard — no post-processing, no waiting.",
      icon: "📊",
    },
  ];

  const features = [
    {
      num: "01",
      kicker: "Hardware",
      title: "Sensor tech that disappears into the workflow.",
      body: "A 12×8 matrix pad — 96 pressure cells, burst sampling at 3,600 events/second, and sub-100ms feedback. Battery-powered, rack-mountable, and built for daily abuse in the weight room.",
      tags: ["3600 events/sec", "96 cells", "Battery-powered"],
    },
    {
      num: "02",
      kicker: "Software",
      title: "Live dashboards. Clean data. Zero friction.",
      body: "Trench Sports software delivers realtime force maps, velocity curves, and placement heatmaps the moment a rep finishes. Session history, athlete profiles, and trend analytics — all in one view.",
      tags: ["Live force maps", "Trend analytics", "Athlete profiles"],
    },
    {
      num: "03",
      kicker: "Intelligence",
      title: "Patterns coaches couldn't see before.",
      body: "AI flags load asymmetry, tempo drift, and fatigue signatures across sessions. Get auto-generated session summaries and weekly performance reports your staff can act on immediately.",
      tags: ["Fatigue detection", "Load asymmetry", "Auto summaries"],
    },
  ];

  const testimonials = [
    {
      quote: "We've never had this level of objectivity in the weight room. Trench tells us things we couldn't see before — and does it without slowing anyone down.",
      name: "Coach D. Harmon",
      title: "Director of Strength & Conditioning",
      org: "Division I Football Program",
    },
    {
      quote: "Setup is 30 seconds. Athletes forget it's there. And the data we pull out of every session has completely changed how we program.",
      name: "Marcus T.",
      title: "Head S&C Coach",
      org: "Professional Soccer Club",
    },
    {
      quote: "The heatmaps alone are worth it. Seeing load distribution across every rep — that's a conversation-changer with medical staff and position coaches.",
      name: "Dr. S. Okafor",
      title: "Sports Science Lead",
      org: "Elite Performance Facility",
    },
  ];

  const useCases = [
    {
      icon: "🏈",
      title: "College Athletics",
      body: "Scale across your entire roster. Coach-ready dashboards, athlete profiles, and compliance tracking built for athletic departments.",
    },
    {
      icon: "🏆",
      title: "Professional Teams",
      body: "Elite-grade data for elite programs. Integrate with your existing AMS stack or run Trench standalone — your call.",
    },
    {
      icon: "🔬",
      title: "Sports Science Staff",
      body: "Validated metrics for return-to-play, load management, and fatigue monitoring. Data you can take into the training room.",
    },
    {
      icon: "🎯",
      title: "Performance Facilities",
      body: "Offer your clients something no other facility has. Stand-alone sessions or integrated athlete management — fully flexible.",
    },
  ];

  return (
    <div className="ts-landing">
      <LandingNav activeSection={activeSection} />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="ts-hero" id="hero">
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

      {/* ── LOGO MARQUEE ─────────────────────────────────────────────── */}
      <section className="ts-marqueeSection">
        <div className="ts-marqueeLabel">Trusted by programs at every level</div>
        <div className="ts-marqueeTrack">
          <div className="ts-marqueeInner">
            {[
              "D1 Football", "Power 5 S&C", "MLS Clubs", "NBA G-League",
              "NCAA Basketball", "Elite Performance Centers", "Pro Soccer",
              "Military Programs", "D1 Football", "Power 5 S&C", "MLS Clubs", "NBA G-League",
              "NCAA Basketball", "Elite Performance Centers", "Pro Soccer", "Military Programs",
            ].map((name, i) => (
              <div key={i} className="ts-marqueeItem">
                <span className="ts-marqueeDot" />
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────────────── */}
      <section className="ts-section" id="stats">
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

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section className="ts-section" id="how-it-works">
        <div className="ts-container">
          <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center" }}>
            <div className="ts-kicker">How It Works</div>
            <h2 className="ts-h2">Live data & reports.</h2>
            <p className="ts-muted" style={{ maxWidth: "52ch" }}>
              No labs. No wearables. No disruption. Just mount, train, and read the data.
            </p>
          </div>

          <div className="ts-howGrid">
            {howItWorks.map((step) => (
              <div key={step.step} className="ts-howCard">
                <div className="ts-howStep">{step.step}</div>
                <div className="ts-howIcon">{step.icon}</div>
                <h3 className="ts-h3">{step.title}</h3>
                <p className="ts-muted">{step.body}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
            <Link className="ts-btnPrimary" to="/signup">See It In Action →</Link>
          </div>
        </div>
      </section>

      {/* ── PLATFORM FEATURES ─────────────────────────────────────────── */}
      <section className="ts-section" id="platform">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <div className="ts-kicker">The Platform</div>
            <h2 className="ts-h2">Everything in one system.</h2>
          </div>

          <div className="ts-featureList">
            {features.map((f) => (
              <div key={f.num} className="ts-featureRow">
                <div className="ts-featureLeft">
                  <div className="ts-featureNum">{f.num}</div>
                  <div>
                    <div className="ts-featureKicker">{f.kicker}</div>
                    <h3 className="ts-featureTitle">{f.title}</h3>
                    <p className="ts-muted">{f.body}</p>
                    <div className="ts-tagRow">
                      {f.tags.map((t) => (
                        <span key={t} className="ts-tag">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="ts-featureRight">
                  <div className="ts-featureMockup">
                    <div className="ts-featureMockupGlow" />
                    <div className="ts-featureMockupInner">
                      <div className="ts-featureMockupBar">
                        <div className="ts-featureMockupTitle">{f.kicker} View</div>
                        <div className="ts-glassBadge">LIVE</div>
                      </div>
                      {/* Decorative grid visualization */}
                      <div className="ts-mockupGrid">
                        {Array.from({ length: 24 }).map((_, i) => (
                          <div
                            key={i}
                            className={`ts-mockupCell ${Math.random() > 0.6 ? "ts-mockupCell--hot" : ""}`}
                            style={{ opacity: 0.4 + Math.random() * 0.6 }}
                          />
                        ))}
                      </div>
                      <div className="ts-mockupBars">
                        {[65, 82, 54, 90, 72, 88, 61].map((h, i) => (
                          <div key={i} className="ts-mockupBar" style={{ height: `${h}%` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── IMPACT NUMBERS ────────────────────────────────────────────── */}
      <section className="ts-section ts-impactSection" id="proof" ref={impactRef}>
        <div className="ts-container">
          <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center", marginBottom: 32 }}>
            <div className="ts-kicker">By the Numbers</div>
            <h2 className="ts-h2">Built for the demands of elite sport.</h2>
          </div>
          <div className="ts-impactGrid">
            <ImpactCounter value={2400000} suffix="+" label="Impact Events Logged" started={impactInView} />
            <ImpactCounter value={96} label="Sensor Cells Per Pad" started={impactInView} />
            <ImpactCounter value={3600} suffix="/sec" label="Max Sampling Rate" started={impactInView} />
            <ImpactCounter value={120} suffix="+" label="Teams & Programs" started={impactInView} />
          </div>
        </div>
      </section>

      {/* ── USE CASES ─────────────────────────────────────────────────── */}
      <section className="ts-section" id="use-cases">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <div className="ts-kicker">Who It's For</div>
            <h2 className="ts-h2">Built for every level of competition.</h2>
            <p className="ts-muted">From D1 programs to pro teams, Trench fits into any performance environment.</p>
          </div>

          <div className="ts-useCaseGrid">
            {useCases.map((uc) => (
              <div key={uc.title} className="ts-useCaseCard">
                <div className="ts-useCaseIcon">{uc.icon}</div>
                <h3 className="ts-h3">{uc.title}</h3>
                <p className="ts-muted">{uc.body}</p>
                <Link className="ts-useCaseLink" to="/signup">Learn more →</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────────────────────────── */}
      <section className="ts-section" id="testimonials">
        <div className="ts-container">
          <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center", marginBottom: 32 }}>
            <div className="ts-kicker">What Coaches Say</div>
            <h2 className="ts-h2">Real results, from real programs.</h2>
          </div>

          <div className="ts-testimonialGrid">
            {testimonials.map((t) => (
              <div key={t.name} className="ts-testimonialCard">
                <div className="ts-quoteMarks">"</div>
                <p className="ts-quoteBody">{t.quote}</p>
                <div className="ts-quoteMeta">
                  <div className="ts-quoteAvatar">
                    {t.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <div className="ts-quoteName">{t.name}</div>
                    <div className="ts-quoteTitle">{t.title}</div>
                    <div className="ts-quoteOrg">{t.org}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
      <section className="ts-ctaBanner">
        <div className="ts-ctaBannerGlow" />
        <div className="ts-ctaBannerInner">
          <div className="ts-kicker" style={{ color: "rgba(180,0,255,0.9)" }}>Ready to Dominate?</div>
          <h2 className="ts-ctaBannerTitle">
            Start capturing data that<br />
            <span className="ts-gradientText">changes how you train.</span>
          </h2>
          <p className="ts-muted" style={{ maxWidth: "48ch", margin: "0 auto 28px" }}>
            Set up in minutes. Powerful enough for the pros. Accessible enough for every program.
          </p>
          <div className="ts-ctaRow" style={{ justifyContent: "center" }}>
            <Link className="ts-btnPrimary" to="/signup" style={{ padding: "14px 28px", fontSize: 16 }}>
              Get Started Free
            </Link>
            <Link className="ts-btnSecondary" to="/dashboard" style={{ padding: "14px 28px", fontSize: 16 }}>
              View Demo Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
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