// src/pages/privacy.tsx
import React, { useState } from "react";
import FooterLogo from "../components/footerLogo";
import { Link } from "react-router-dom";

/* ─── Section data ───────────────────────────────────────── */
type Section = {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "collect",
    icon: "📡",
    title: "What we collect",
    content: (
      <>
        <p>
          Trench Sports collects only what's necessary to power your performance analytics.
          This includes account information (name, email, program affiliation), athlete profile
          data (position, physical attributes, date of birth), and session data captured through
          the sensor hardware (impact location, force readings, timing, and tempo).
        </p>
        <p>
          We also collect standard usage information — how you interact with the platform,
          device type, browser, and session duration — to improve reliability and performance.
          This data is processed in aggregate and cannot be used to identify you individually.
        </p>
        <p>
          We do <strong>not</strong> collect biometric identifiers, payment card data (handled
          directly by our payment processor), or any information unrelated to athletic performance.
        </p>
      </>
    ),
  },
  {
    id: "use",
    icon: "⚙️",
    title: "How we use your data",
    content: (
      <>
        <p>
          Your data powers your dashboard — session summaries, heatmaps, force trends, and
          historical comparisons. It is used to authenticate your account, sync sessions across
          devices, and deliver the real-time feedback loop the platform is built on.
        </p>
        <p>
          Coaches within the same program can access athlete data only when the athlete's account
          is enrolled in that program. Data is always scoped — no cross-program visibility, no
          anonymous pooling of individual records.
        </p>
        <p>
          We may use aggregated, de-identified usage data to improve platform performance,
          tune sensor firmware, and prioritize product features. This data is statistical in
          nature and cannot be traced back to any individual user.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    icon: "🔒",
    title: "No third-party sharing",
    content: (
      <>
        <div className="ts-privacyCallout">
          <span className="ts-privacyCalloutIcon">🛡</span>
          <p>
            <strong>Trench Sports does not sell, rent, license, or share your personal data
            with any third party</strong> — full stop. Your performance data belongs to you
            and your program. Period.
          </p>
        </div>
        <p>
          The only exceptions are narrow, operational, and non-commercial in nature:
        </p>
        <ul className="ts-privacyList">
          <li>
            <strong>Infrastructure providers</strong> — cloud hosting and database services
            that store your data under strict data processing agreements with no independent
            right to access or use your data.
          </li>
          <li>
            <strong>Payment processing</strong> — handled by a PCI-compliant processor.
            Trench Sports never sees or stores your full card details.
          </li>
          <li>
            <strong>Legal requirements</strong> — if required by law or valid legal process,
            we will notify you to the extent permitted before complying.
          </li>
        </ul>
        <p>
          We do not use advertising networks, data brokers, or tracking pixels that report
          your behavior to third parties. Trench Sports does not run ads and does not
          monetize user data.
        </p>
      </>
    ),
  },
  {
    id: "security",
    icon: "🔐",
    title: "How we secure your data",
    content: (
      <>
        <p>
          Security is not an afterthought at Trench Sports — it's built into the architecture.
          All data transmitted between your device and our servers is encrypted in transit
          using TLS 1.2 or higher. Data stored on our servers is encrypted at rest using
          AES-256.
        </p>
        <div className="ts-privacySecurityGrid">
          {[
            { icon: "🔑", label: "TLS 1.2+", sub: "Encryption in transit" },
            { icon: "🗄", label: "AES-256", sub: "Encryption at rest" },
            { icon: "🧱", label: "Row-level security", sub: "Per-account data isolation" },
            { icon: "🔍", label: "Access logging", sub: "Audit trails on all reads" },
          ].map((item) => (
            <div className="ts-privacySecCard" key={item.label}>
              <span className="ts-privacySecIcon">{item.icon}</span>
              <strong>{item.label}</strong>
              <span className="ts-muted" style={{ fontSize: 12 }}>{item.sub}</span>
            </div>
          ))}
        </div>
        <p>
          Access to production data is restricted to authorized personnel only, with
          role-based permissions and audit logging. We conduct periodic security reviews
          and keep dependencies up to date.
        </p>
        <p>
          If you believe you've discovered a security vulnerability, please report it
          directly to{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-privacyLink">
            jaylen@trenchsports.ai
          </a>{" "}
          with "SECURITY" in the subject line. We take all reports seriously and respond
          within 48 hours.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    icon: "🤖",
    title: "AI model training & your opt-out",
    content: (
      <>
        <p>
          Trench Sports is building personalized AI models to improve coaching
          recommendations, detect performance patterns, and surface insights specific to
          your sport and training style. To do this well, we may use anonymized and
          aggregated session data to train these models.
        </p>
        <div className="ts-privacyCallout ts-privacyCallout--purple">
          <span className="ts-privacyCalloutIcon">⚡</span>
          <p>
            <strong>Participation in AI model training is optional.</strong> You can opt out
            at any time from your account settings under{" "}
            <em>Privacy &amp; Data → AI Training Preferences</em>. Opting out has no effect
            on your access to the platform or the quality of your personal dashboard.
          </p>
        </div>
        <p>
          When AI training is enabled, only de-identified, aggregated data is used — never
          raw personal information or individually identifiable session records.
          Your data is never used to train models for or shared with external organizations.
        </p>
        <p>
          If you opt out, any previously contributed data is excluded from future training
          runs. You may opt back in at any time. We will notify you before any material
          change to how AI training data is collected or used.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    icon: "✋",
    title: "Your rights & controls",
    content: (
      <>
        <p>
          You are in control of your data. As a Trench Sports user you have the right to:
        </p>
        <ul className="ts-privacyList">
          <li><strong>Access</strong> — Request a copy of all data associated with your account.</li>
          <li><strong>Correction</strong> — Update or correct inaccurate profile or session data.</li>
          <li><strong>Deletion</strong> — Request full deletion of your account and associated data.
            Session data tied to a program may be retained in de-identified aggregate form.</li>
          <li><strong>Portability</strong> — Export your session history in a standard format (CSV/JSON)
            from the dashboard at any time.</li>
          <li><strong>Opt-out of AI training</strong> — Disable AI training data contribution in your
            account settings with immediate effect.</li>
          <li><strong>Withdraw consent</strong> — You may withdraw any previously granted consent
            at any time without affecting your access to the service.</li>
        </ul>
        <p>
          To exercise any of these rights, visit your account settings or contact us at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-privacyLink">
            jaylen@trenchsports.ai
          </a>
          . We will respond within 30 days. Requests are free of charge.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    icon: "🗓",
    title: "Data retention",
    content: (
      <>
        <p>
          We retain your data for as long as your account is active or as needed to provide
          the service. If you delete your account, personal data is purged within 30 days.
          Anonymized, aggregated session statistics may be retained indefinitely as they
          cannot be traced back to any individual.
        </p>
        <p>
          Backups are rotated on a rolling 90-day cycle. Legal hold obligations may require
          us to retain certain records for longer; we will inform you if this applies.
        </p>
      </>
    ),
  },
  {
    id: "updates",
    icon: "📋",
    title: "Policy updates",
    content: (
      <>
        <p>
          We may update this policy as the platform evolves. When we make material changes,
          we'll notify you via email and display a banner in the dashboard at least 14 days
          before the changes take effect.
        </p>
        <p>
          Continued use of the platform after a policy update constitutes acceptance of the
          revised terms. The effective date at the top of this page always reflects the
          most recent version.
        </p>
        <p>
          Questions about a specific change? Reach out at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-privacyLink">
            jaylen@trenchsports.ai
          </a>
          .
        </p>
      </>
    ),
  },
];

/* ─── Component ─────────────────────────────────────────── */
export default function Privacy() {
  const [openSection, setOpenSection] = useState<string | null>("collect");

  function toggle(id: string) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  return (
    <div className="ts-landing ts-privacy">

      {/* ── HERO ────────────────────────────────────────────── */}
      <section className="ts-hero ts-privacyHero">
        <div className="ts-heroInner ts-privacyHeroInner">
          <div className="ts-pill">
            <span className="ts-dot" />
            Privacy Policy
          </div>

          <h1 className="ts-h1" style={{ textAlign: "center" }}>
            Your data.&nbsp;
            <span className="ts-gradientText">Your rules.</span>
          </h1>

          <p className="ts-sub" style={{ textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
            Trench Sports is built on trust. We collect only what's needed, secure
            everything we hold, and never share your data with third parties — ever.
          </p>

          <div className="ts-privacyMetaRow">
            <div className="ts-privacyMetaPill">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
              Effective: January 1, 2025
            </div>
            <div className="ts-privacyMetaPill">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Last updated: March 2026
            </div>
          </div>
        </div>
      </section>

      {/* ── COMMITMENT CARDS ────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <h2 className="ts-h2">Our core commitments</h2>
            <p className="ts-muted">Three things we will never compromise on.</p>
          </div>

          <div className="ts-privacyCommitGrid">
            {[
              {
                icon: "🛡",
                title: "Zero third-party sharing",
                body: "Your performance data is never sold, licensed, or shared with advertisers, data brokers, or any external party.",
              },
              {
                icon: "🔐",
                title: "Enterprise-grade security",
                body: "AES-256 at rest, TLS in transit, row-level isolation, and access audit logs — protecting every byte we hold.",
              },
              {
                icon: "⚡",
                title: "AI training is opt-in",
                body: "Contributing your data to improve our AI models is always your choice. Opt out anytime from your account settings.",
              },
            ].map((c) => (
              <div key={c.title} className="ts-privacyCommitCard">
                <div className="ts-privacyCommitGlow" />
                <span className="ts-privacyCommitIcon">{c.icon}</span>
                <h3 className="ts-h3" style={{ margin: "10px 0 6px", fontSize: 16 }}>{c.title}</h3>
                <p className="ts-muted" style={{ fontSize: 13, margin: 0 }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACCORDION SECTIONS ──────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <h2 className="ts-h2">Full policy</h2>
            <p className="ts-muted">Click any section to expand.</p>
          </div>

          <div className="ts-privacyAccordion">
            {SECTIONS.map((sec) => {
              const isOpen = openSection === sec.id;
              return (
                <div
                  key={sec.id}
                  className={`ts-privacySection ${isOpen ? "open" : ""}`}
                >
                  <button
                    className="ts-privacySectionBtn"
                    onClick={() => toggle(sec.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="ts-privacySectionLeft">
                      <span className="ts-privacySectionEmoji">{sec.icon}</span>
                      <span className="ts-privacySectionTitle">{sec.title}</span>
                    </span>
                    <span className="ts-privacyChevron" aria-hidden>
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path d="M19 9l-7 7-7-7"/>
                      </svg>
                    </span>
                  </button>

                  <div className="ts-privacySectionBody">
                    <div className="ts-privacySectionBodyInner">
                      {sec.content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CONTACT CTA ─────────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-privacyCtaCard">
            <div className="ts-privacyCtaGlow" />
            <div className="ts-privacyCtaContent">
              <span style={{ fontSize: 32, lineHeight: 1 }}>✉️</span>
              <div>
                <h3 className="ts-h3" style={{ margin: "0 0 6px" }}>Questions about your privacy?</h3>
                <p className="ts-muted" style={{ margin: 0, fontSize: 14 }}>
                  We're a small team and we read every message. If anything in this policy is unclear
                  or you want to exercise your data rights, reach out directly.
                </p>
              </div>
            </div>
            <div className="ts-privacyCtaActions">
              <a href="mailto:jaylen@trenchsports.ai" className="ts-btnPrimary">
                Email us
              </a>
              <Link to="/contact" className="ts-btnSecondary">
                Contact page
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand"><FooterLogo /></div>
          <div className="ts-footerLinks">
            <Link to="/">Home</Link>
            <Link to="/signup">Signup</Link>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/contact">Contact</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>

      {/* ── PAGE-SCOPED STYLES ──────────────────────────────── */}
      <style>{`

        /* ── Hero ── */
        .ts-privacyHero {
          padding: 80px 20px 60px;
          text-align: center;
        }
        .ts-privacyHeroInner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          max-width: 680px;
          margin: 0 auto;
        }
        .ts-privacyMetaRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 4px;
        }
        .ts-privacyMetaPill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 99px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.10);
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
          letter-spacing: 0.2px;
        }

        /* ── Commitment cards ── */
        .ts-privacyCommitGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          margin-top: 28px;
        }
        .ts-privacyCommitCard {
          position: relative;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid rgba(180,0,255,0.22);
          border-radius: 20px;
          padding: 26px 22px;
          display: flex;
          flex-direction: column;
          transition: border-color 160ms ease, transform 160ms ease;
        }
        .ts-privacyCommitCard:hover {
          border-color: rgba(180,0,255,0.45);
          transform: translateY(-2px);
        }
        .ts-privacyCommitGlow {
          position: absolute;
          top: -30px; right: -30px;
          width: 120px; height: 120px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.16) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-privacyCommitIcon {
          font-size: 28px;
          line-height: 1;
        }

        /* ── Accordion ── */
        .ts-privacyAccordion {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 28px;
        }
        .ts-privacySection {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 18px;
          overflow: hidden;
          transition: border-color 160ms ease;
        }
        .ts-privacySection.open {
          border-color: rgba(180,0,255,0.36);
          box-shadow: 0 0 0 2px rgba(180,0,255,0.08);
        }
        .ts-privacySectionBtn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          color: var(--text);
          transition: background 160ms ease;
        }
        .ts-privacySectionBtn:hover {
          background: rgba(180,0,255,0.05);
        }
        .ts-privacySectionLeft {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ts-privacySectionEmoji {
          font-size: 20px;
          line-height: 1;
          flex-shrink: 0;
        }
        .ts-privacySectionTitle {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.1px;
        }
        .ts-privacyChevron {
          flex-shrink: 0;
          color: var(--muted);
          display: flex;
          transition: transform 240ms cubic-bezier(0.4,0,0.2,1), color 160ms;
        }
        .ts-privacySection.open .ts-privacyChevron {
          transform: rotate(180deg);
          color: var(--accent);
        }
        .ts-privacySectionBody {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1);
        }
        .ts-privacySection.open .ts-privacySectionBody {
          grid-template-rows: 1fr;
        }
        .ts-privacySectionBodyInner {
          overflow: hidden;
          min-height: 0;
        }
        .ts-privacySectionBodyInner p,
        .ts-privacySectionBodyInner ul {
          margin: 0 0 14px;
          padding: 0 22px;
          font-size: 14px;
          line-height: 1.7;
          color: var(--muted);
        }
        .ts-privacySectionBodyInner p:first-child {
          padding-top: 4px;
        }
        .ts-privacySectionBodyInner p:last-child,
        .ts-privacySectionBodyInner ul:last-child {
          padding-bottom: 22px;
          margin-bottom: 0;
        }
        .ts-privacySectionBodyInner strong {
          color: var(--text);
          font-weight: 800;
        }

        /* ── List inside accordion ── */
        .ts-privacyList {
          list-style: none !important;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-left: 22px !important;
          padding-right: 22px !important;
        }
        .ts-privacyList li {
          position: relative;
          padding-left: 18px;
          font-size: 14px;
          line-height: 1.65;
          color: var(--muted);
        }
        .ts-privacyList li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 9px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(180,0,255,0.6);
        }

        /* ── Callout block ── */
        .ts-privacyCallout {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px 18px;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          margin: 0 22px 14px !important;
        }
        .ts-privacyCallout--purple {
          background: rgba(180,0,255,0.07);
          border-color: rgba(180,0,255,0.28);
        }
        .ts-privacyCallout p {
          padding: 0 !important;
          margin: 0 !important;
          font-size: 13.5px !important;
        }
        .ts-privacyCalloutIcon {
          font-size: 18px;
          line-height: 1.4;
          flex-shrink: 0;
        }

        /* ── Security cards ── */
        .ts-privacySecurityGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin: 0 22px 14px !important;
          padding: 0 !important;
        }
        .ts-privacySecCard {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 10px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--panel-border);
          border-radius: 14px;
          text-align: center;
          font-size: 13px;
          font-weight: 800;
          color: var(--text);
          transition: border-color 160ms;
        }
        .ts-privacySecCard:hover {
          border-color: rgba(180,0,255,0.28);
        }
        .ts-privacySecIcon {
          font-size: 20px;
          line-height: 1;
          margin-bottom: 2px;
        }

        /* ── Link inside accordion ── */
        .ts-privacyLink {
          color: var(--accent);
          font-weight: 700;
          text-decoration: none;
          transition: opacity 160ms;
        }
        .ts-privacyLink:hover { opacity: 0.75; }

        /* ── CTA card ── */
        .ts-privacyCtaCard {
          position: relative;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid rgba(180,0,255,0.28);
          border-radius: 24px;
          padding: 32px 28px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        @media (min-width: 640px) {
          .ts-privacyCtaCard {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }
        .ts-privacyCtaGlow {
          position: absolute;
          top: -50px; left: -50px;
          width: 220px; height: 220px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.14) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-privacyCtaContent {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }
        .ts-privacyCtaActions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
      `}</style>
    </div>
  );
}