// src/pages/landing.tsx
import React, { useEffect, useRef, useState } from "react";
import FooterLogo from "../components/footerLogo";
import { Link } from "react-router-dom";
import HitSimulator from "../components/hitSimulator";
import LandingNav, { LANDING_NAV_SECTIONS } from "../components/landingNav";
import { IconBarChart, IconCrosshair, IconDumbbell, IconFlask, IconGraduationCap, IconTrophy, IconZap } from "../components/icons";
import { AIInsightVisual, DataCaptureVisual, ImpactPropagationVisual } from "../components/platformVisuals";

// ── Request Demo Modal ────────────────────────────────────────────────────────
function RequestDemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", organisation: "",
    role: "", orgType: "", sport: "", product: "", country: "", marketing: false,
  });
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    const required = ["firstName", "lastName", "email", "organisation", "role", "orgType", "sport", "product", "country"];
    const missing = required.filter((k) => !(form as Record<string, string | boolean>)[k]);
    if (missing.length) { alert("Please complete all required fields."); return; }

    setStatus("sending");
    try {
      await fetch("https://formsubmit.co/ajax/calvin@trenchsports.ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: `Demo Request — ${form.firstName} ${form.lastName} (${form.organisation})`,
          "First Name": form.firstName,
          "Last Name": form.lastName,
          Email: form.email,
          Phone: form.phone,
          Organisation: form.organisation,
          Role: form.role,
          "Organisation Type": form.orgType,
          Sport: form.sport,
          "Product Interest": form.product,
          Country: form.country,
          "Marketing Consent": form.marketing ? "Yes" : "No",
        }),
      });
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  const handleClose = () => { setStatus("idle"); onClose(); };

  if (!open) return null;

  const roles = ["Academic / Research","Athlete / Individual","Coach","Content Licensing","Director / Head of Department","Executive","Head Coach","Medical","Sport Science","Strength & Conditioning","Video / Performance Analysis"];
  const orgTypes = ["Professional Team","Academy/Junior/Youth","Advertising/Content/Media","Amateur Team","High School","Individual","League/Association/Conference","Medical/Research","Military","National Team","Other","Semi-Professional Team","Sports Institute","University/College"];
  const sports = ["American Football","Australian Rules Football","Baseball","Basketball","Cricket","Field Hockey","Football/Soccer","Futsal","GAA","Gymnastics","Handball","Ice Hockey","Lacrosse","Military","Motorsport","Netball","Not Applicable","Paddle Sports","Polo","Research","Rugby League","Rugby Union","Skiing","Softball","Strength & Conditioning/Performance","Tennis","Volleyball","Water Polo","Wrestling","Hurling","Other"];
  const products = ["Vector Pro","Vector Core","Catapult One","Catapult Pro Video","Thunder","RaceWatch For Teams","RaceWatch Circuit Manager","Recruiting","Content Licensing","Perch","IMPECT"];
  const countries = ["Afghanistan","Albania","Algeria","American Samoa","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bermuda","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","British Virgin Islands","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Cayman Islands","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Cook Islands","Costa Rica","Cote d'Ivoire","Croatia","Cuba","Cyprus","Czech Republic","Democratic Republic of the Congo","Denmark","Djibouti","Dominica","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Ethiopia","Faroe Islands","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Gibraltar","Greece","Grenada","Guam","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Macedonia (FYROM)","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Myanmar (Burma)","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","Norway","Oman","Pakistan","Palau","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Puerto Rico","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Swaziland","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];

  return (
    <div className="ts-demoOverlay" onClick={handleClose}>
      <div className="ts-demoModal" onClick={(e) => e.stopPropagation()}>
        <button className="ts-demoClose" onClick={handleClose} aria-label="Close">✕</button>

        {status === "success" ? (
          <div className="ts-demoSuccess">
            <div className="ts-demoSuccessIcon">✓</div>
            <h2 className="ts-h2" style={{ marginBottom: 8 }}>Request Received</h2>
            <p className="ts-muted">Our team will be in touch shortly to schedule your demo.</p>
            <button className="ts-btnPrimary" style={{ marginTop: 24 }} onClick={handleClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="ts-demoHeader">
              <div className="ts-kicker">Get in Touch</div>
              <h2 className="ts-h2" style={{ marginBottom: 4 }}>Request a Demo</h2>
              <p className="ts-muted" style={{ fontSize: 14 }}>Fill in the details below and we'll be in touch to set up your personalised demo.</p>
            </div>

            <div className="ts-demoBody">
              <div className="ts-demoGrid2">
                <div className="ts-demoField">
                  <label className="ts-demoLabel">First Name <span className="ts-req">*</span></label>
                  <input className="ts-demoInput" placeholder="First name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
                </div>
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Last Name <span className="ts-req">*</span></label>
                  <input className="ts-demoInput" placeholder="Last name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
                </div>
              </div>
              <div className="ts-demoGrid2">
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Email <span className="ts-req">*</span></label>
                  <input className="ts-demoInput" type="email" placeholder="you@org.com" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Phone</label>
                  <input className="ts-demoInput" type="tel" placeholder="+1 000 000 0000" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
              </div>
              <div className="ts-demoField">
                <label className="ts-demoLabel">Organisation <span className="ts-req">*</span></label>
                <input className="ts-demoInput" placeholder="Your team or organisation" value={form.organisation} onChange={(e) => set("organisation", e.target.value)} />
              </div>
              <div className="ts-demoGrid2">
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Role <span className="ts-req">*</span></label>
                  <select className="ts-demoSelect" value={form.role} onChange={(e) => set("role", e.target.value)}>
                    <option value="">Select role…</option>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Type of Organisation <span className="ts-req">*</span></label>
                  <select className="ts-demoSelect" value={form.orgType} onChange={(e) => set("orgType", e.target.value)}>
                    <option value="">Select type…</option>
                    {orgTypes.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="ts-demoGrid2">
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Sport <span className="ts-req">*</span></label>
                  <select className="ts-demoSelect" value={form.sport} onChange={(e) => set("sport", e.target.value)}>
                    <option value="">Select sport…</option>
                    {sports.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="ts-demoField">
                  <label className="ts-demoLabel">Product Selection <span className="ts-req">*</span></label>
                  <select className="ts-demoSelect" value={form.product} onChange={(e) => set("product", e.target.value)}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="ts-demoField">
                <label className="ts-demoLabel">Country <span className="ts-req">*</span></label>
                <select className="ts-demoSelect" value={form.country} onChange={(e) => set("country", e.target.value)}>
                  <option value="">Select country…</option>
                  {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <label className="ts-demoCheckRow">
                <input type="checkbox" checked={form.marketing} onChange={(e) => set("marketing", e.target.checked)} />
                <span className="ts-demoCheckLabel">
                  Yes, I would like to receive marketing communications regarding Trench Sports solutions, services and events. I know I can unsubscribe at any time.
                </span>
              </label>
              {status === "error" && (
                <p style={{ color: "#ff4444", fontSize: 13, marginTop: 8 }}>Something went wrong. Please try again.</p>
              )}
              <button
                className="ts-btnPrimary"
                style={{ width: "100%", marginTop: 8, padding: "14px", fontSize: 15, justifyContent: "center" }}
                onClick={handleSubmit}
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending…" : "Submit Request →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
function ImpactCounter({ value, prefix = "", suffix = "", label, started }: {
  value: number; prefix?: string; suffix?: string; label: string; started: boolean;
}) {
  const count = useCountUp(value, 1800, started);
  return (
    <div className="ts-impactCard">
      <div className="ts-impactValue">
        {prefix}{count.toLocaleString()}{suffix}
      </div>
      <div className="ts-impactLabel">{label}</div>
    </div>
  );
}

export default function Landing() {
  const { ref: impactRef, inView: impactInView } = useInView();
  const { ref: navRef, inView: _navInView } = useInView(0);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
  const [demoOpen, setDemoOpen] = useState(false);

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
      Icon: IconZap,
    },
    {
      step: "02",
      title: "Train Normally",
      body: "Athletes train at full intensity. Listen mode idles in the background and triggers Burst mode automatically on every significant impact.",
      Icon: IconDumbbell,
    },
    {
      step: "03",
      title: "See the Data Instantly",
      body: "Force maps, velocity trends, and placement heatmaps appear live on the coach dashboard — no post-processing, no waiting.",
      Icon: IconBarChart,
    },
  ];

  const features = [
    {
      num: "01",
      kicker: "Hardware",
      title: "Sensor tech that disappears into the workflow.",
      body: "A 12×8 matrix pad — 96 pressure cells, burst sampling at 3,600 events/second, and sub-100ms feedback. Battery-powered, rack-mountable, and built for daily abuse in the weight room.",
      tags: ["3600 events/sec", "96 cells", "Battery-powered"],
      Visual: DataCaptureVisual,
    },
    {
      num: "02",
      kicker: "Software",
      title: "Live dashboards. Clean data. Zero friction.",
      body: "Trench Sports software delivers realtime force maps, velocity curves, and placement heatmaps the moment a rep finishes. Session history, athlete profiles, and trend analytics — all in one view.",
      tags: ["Live force maps", "Trend analytics", "Athlete profiles"],
      Visual: ImpactPropagationVisual,
    },
    {
      num: "03",
      kicker: "Intelligence",
      title: "Patterns coaches couldn't see before.",
      body: "AI flags load asymmetry, tempo drift, and fatigue signatures across sessions. Get auto-generated session summaries and weekly performance reports your staff can act on immediately.",
      tags: ["Fatigue detection", "Load asymmetry", "Auto summaries"],
      Visual: AIInsightVisual,
    },
  ];

  const testimonials = [
    {
      quote: "Trench Sports is the new and improved way for athletes, especially football players, to train. The pad helps me learn and track how much force I'm applying and how accurate my punch is. Especially being a Defensive Lineman, this pad will help and elevate my game to the next level!",
      name: "VJ",
      title: "Professional Football Player",
      org: "",
    },
    {
      quote: "Trench Sports' new pad is honestly really cool. What stood out to me most was being able to see where I hit and how hard I hit in real time — it adds a whole new level to training. It's not just reps anymore, it's feedback you can actually use. Definitely a game changer.",
      name: "Tyshon Reed",
      title: "D1 Football Player",
      org: "",
    },
  ];

  const useCases = [
    {
      Icon: IconGraduationCap,
      title: "College Athletics",
      body: "Scale across your entire roster. Coach-ready dashboards, athlete profiles, and compliance tracking built for athletic departments.",
    },
    {
      Icon: IconTrophy,
      title: "Professional Teams",
      body: "Elite-grade data for elite programs. Integrate with your existing AMS stack or run Trench standalone — your call.",
    },
    {
      Icon: IconFlask,
      title: "Sports Science Staff",
      body: "Validated metrics for return-to-play, load management, and fatigue monitoring. Data you can take into the training room.",
    },
    {
      Icon: IconCrosshair,
      title: "Performance Facilities",
      body: "Offer your clients something no other facility has. Stand-alone sessions or integrated athlete management — fully flexible.",
    },
  ];

  return (
    <div className="ts-landing">
      <RequestDemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
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
              <button className="ts-btnSecondary" onClick={() => setDemoOpen(true)}>
                Request Demo
              </button>
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
      {/*
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
      */}

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
                <div className="ts-howIcon"><step.Icon size={22} /></div>
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
                      <f.Visual />
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
            <ImpactCounter value={100} prefix="<" suffix="ms" label="Feedback Latency" started={impactInView} />
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
                <div className="ts-useCaseIcon"><uc.Icon size={22} /></div>
                <h3 className="ts-h3">{uc.title}</h3>
                <p className="ts-muted">{uc.body}</p>
                <Link className="ts-useCaseLink" to="/contact">Learn more →</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────────────────────────── */}
      <section className="ts-section" id="testimonials">
        <div className="ts-container">
          <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center", marginBottom: 32 }}>
            <div className="ts-kicker">What Athletes Say</div>
            <h2 className="ts-h2">Real feedback, from real athletes.</h2>
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
                    {t.org && <div className="ts-quoteOrg">{t.org}</div>}
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
            <button className="ts-btnSecondary" style={{ padding: "14px 28px", fontSize: 16 }} onClick={() => setDemoOpen(true)}>
              Request Demo
            </button>
            <Link className="ts-btnSecondary" to="/dashboard" style={{ padding: "14px 28px", fontSize: 16 }}>
              View Demo Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand"><FooterLogo /></div>
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