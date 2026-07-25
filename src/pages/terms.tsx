// src/pages/terms.tsx
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
    id: "agreement",
    icon: "📄",
    title: "Agreement to terms",
    content: (
      <>
        <p>
          These Terms of Use (the "Terms") are a binding contract between you and Trench Sports AI,
          Inc. ("Trench Sports," "we," "us," or "our"). By creating an account, accessing the
          platform, or using any part of our Services, you agree to be fully bound by these Terms.
          If you do not agree, you may not use the Services.
        </p>
        <p>
          "Services" refers collectively to the Trench Sports web platform located at{" "}
          <a href="https://trenchsports.ai" className="ts-termsLink">trenchsports.ai</a>,
          the athlete dashboard, sensor hardware, mobile applications, and any related software,
          firmware, or features we make available to you.
        </p>
        <p>
          We may update these Terms from time to time. When we make material changes, we'll notify
          you via email and in-app notice at least 14 days before the changes take effect. Continued
          use of the Services after an update constitutes acceptance of the revised Terms.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    icon: "✅",
    title: "Eligibility",
    content: (
      <>
        <p>
          You must be at least 13 years old to use the Services. Users between the ages of 13 and
          17 may only use the Services as part of a program administered by an authorized Admin
          whose account is in good standing. Users under 13 are not permitted to create personal
          profiles or submit personal information.
        </p>
        <p>
          If you are signing up on behalf of a team, program, or organization (a "Participating
          Organization"), you represent that you have the authority to bind that organization to
          these Terms. You agree to contact us at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-termsLink">
            jaylen@trenchsports.ai
          </a>{" "}
          if you believe you've accepted these Terms in error.
        </p>
        <div className="ts-termsCallout">
          <span className="ts-termsCalloutIcon">⚠️</span>
          <p>
            <strong>Health disclaimer:</strong> You are solely responsible for ensuring you are
            physically fit to use the Services and any associated equipment. Trench Sports is a
            performance analytics platform — it does not provide medical advice, health assessments,
            or fitness recommendations. Consult a physician before beginning any training program.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "accounts",
    icon: "👤",
    title: "Accounts & user roles",
    content: (
      <>
        <p>
          The platform supports three user roles. Each role carries distinct permissions and
          responsibilities:
        </p>
        <ul className="ts-termsList">
          <li>
            <strong>Admin</strong> — The account owner for a Participating Organization. Admins can
            add coaches and athletes, manage program settings, access all program data, and appoint
            additional Admins. Admins are responsible for ensuring all users they add have given
            appropriate consent.
          </li>
          <li>
            <strong>Coach</strong> — Added by an Admin. Coaches can view aggregate and individual
            athlete performance data within their program, export session data, and manage
            session scheduling.
          </li>
          <li>
            <strong>Athlete</strong> — Individual performers whose accounts may be created by an
            Admin. Athletes can view their own metrics and session history. They cannot view data
            belonging to other athletes.
          </li>
        </ul>
        <p>
          You are responsible for maintaining the confidentiality of your login credentials and for
          all activity that occurs under your account. You agree to notify us immediately at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-termsLink">
            jaylen@trenchsports.ai
          </a>{" "}
          if you suspect unauthorized access.
        </p>
        <p>
          You agree to provide accurate, complete, and up-to-date information when creating your
          account and to keep that information current. Impersonation of another user or
          individual is strictly prohibited.
        </p>
      </>
    ),
  },
  {
    id: "use",
    icon: "📋",
    title: "Acceptable use",
    content: (
      <>
        <p>
          You agree to use the Services only for lawful purposes and in accordance with these Terms.
          You may not:
        </p>
        <ul className="ts-termsList">
          <li>Use the Services to harass, harm, or discriminate against any individual.</li>
          <li>Reverse engineer, decompile, or attempt to extract the source code of any part of the platform.</li>
          <li>Attempt to gain unauthorized access to any account, server, or network connected to the Services.</li>
          <li>Upload or transmit malicious code, viruses, or any software intended to disrupt the platform.</li>
          <li>Scrape, crawl, or systematically extract data from the platform without written permission.</li>
          <li>Use the Services to build a competing product or service.</li>
          <li>Misrepresent your identity, role, or affiliation when using the platform.</li>
          <li>Share your account credentials with others or allow unauthorized individuals to access your account.</li>
        </ul>
        <p>
          Trench Sports reserves the right to suspend or terminate any account that violates these
          terms at our sole discretion, with or without notice.
        </p>
      </>
    ),
  },
  {
    id: "hardware",
    icon: "🎛",
    title: "Hardware & sensor devices",
    content: (
      <>
        <p>
          Trench Sports sensor hardware — including the impact pad, sensor grid, and related
          firmware — is provided subject to these Terms and any separate hardware agreement entered
          into at purchase. Hardware remains the property of Trench Sports until fully purchased
          and paid for.
        </p>
        <p>
          You agree to:
        </p>
        <ul className="ts-termsList">
          <li>Use hardware only for its intended athletic performance monitoring purposes.</li>
          <li>Not modify, disassemble, or tamper with hardware components or firmware.</li>
          <li>Keep hardware in reasonable condition and report defects promptly.</li>
          <li>Not attempt to extract, copy, or reverse engineer firmware or embedded software.</li>
        </ul>
        <p>
          Trench Sports is not liable for injuries or damages arising from misuse of hardware,
          use outside of recommended parameters, or failure to follow installation and usage
          guidelines provided with the device.
        </p>
      </>
    ),
  },
  {
    id: "data",
    icon: "📊",
    title: "Your data & content",
    content: (
      <>
        <p>
          You retain ownership of all performance data and content you submit through the Services
          ("Submitted Data"). By using the Services, you grant Trench Sports a limited, non-exclusive,
          royalty-free license to process, store, and display your Submitted Data solely for the
          purpose of providing the Services to you and your program.
        </p>
        <p>
          We do not sell, share, or license your personal performance data to third parties.
          Our use of data for AI model improvement is always opt-in and governed by our{" "}
          <Link to="/privacy" className="ts-termsLink">Privacy Policy</Link>.
        </p>
        <p>
          You represent and warrant that any data you submit does not infringe on the rights of any
          third party and that you have obtained any necessary consents — particularly when submitting
          data on behalf of athlete users.
        </p>
        <div className="ts-termsCallout ts-termsCallout--purple">
          <span className="ts-termsCalloutIcon">🔒</span>
          <p>
            Data is encrypted in transit and at rest. Row-level security ensures no user can access
            another program's data. For full details on how we handle your data, see our{" "}
            <Link to="/privacy" className="ts-termsLink">Privacy Policy</Link>.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "ip",
    icon: "©️",
    title: "Intellectual property",
    content: (
      <>
        <p>
          All platform software, design, branding, algorithms, firmware, and documentation are the
          exclusive property of Trench Sports AI, Inc. and are protected by copyright, trade secret,
          and other applicable laws. These Terms do not grant you any rights to Trench Sports
          intellectual property except the limited license to use the Services as described herein.
        </p>
        <p>
          "Trench Sports," the Trench Sports logo, and all related product names are trademarks of
          Trench Sports AI, Inc. You may not use these marks in connection with any product or
          service without prior written consent.
        </p>
        <p>
          Any feedback, suggestions, or feature requests you submit to us may be used by Trench
          Sports without restriction or compensation. You waive any claim of ownership over
          feedback you voluntarily provide.
        </p>
      </>
    ),
  },
  {
    id: "subscriptions",
    icon: "💳",
    title: "Subscriptions & billing",
    content: (
      <>
        <p>
          Access to certain features of the Services requires a paid subscription. Subscription
          fees are billed in advance on a monthly or annual basis depending on the plan selected.
          All fees are in USD unless otherwise stated.
        </p>
        <ul className="ts-termsList">
          <li>
            <strong>Cancellation</strong> — You may cancel your subscription at any time from your
            account settings. Access continues through the end of the current billing period. No
            partial refunds are issued for unused time.
          </li>
          <li>
            <strong>Upgrades / Downgrades</strong> — Plan changes take effect at the start of the
            next billing cycle unless otherwise specified.
          </li>
          <li>
            <strong>Failed payments</strong> — If a payment fails, we will attempt to retry and
            notify you by email. Accounts with unresolved payment failures may be temporarily
            suspended.
          </li>
          <li>
            <strong>Price changes</strong> — We reserve the right to adjust pricing with at least
            30 days' notice. Continued use after a price change constitutes acceptance.
          </li>
        </ul>
        <p>
          Questions about billing? Contact us at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-termsLink">
            jaylen@trenchsports.ai
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    icon: "⚖️",
    title: "Disclaimers & limitation of liability",
    content: (
      <>
        <p>
          The Services are provided "as is" and "as available" without warranties of any kind,
          express or implied. Trench Sports does not warrant that the Services will be uninterrupted,
          error-free, or completely secure. We are not liable for any loss of data, lost profits,
          or indirect, incidental, or consequential damages arising from your use of the Services.
        </p>
        <p>
          Trench Sports' total liability to you for any claim arising out of or related to these
          Terms or the Services shall not exceed the amount you paid to Trench Sports in the
          twelve months preceding the claim.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of certain warranties or limitation of
          certain liabilities. In those jurisdictions, the limitations above apply to the maximum
          extent permitted by law.
        </p>
      </>
    ),
  },
  {
    id: "disputes",
    icon: "🤝",
    title: "Disputes & governing law",
    content: (
      <>
        <p>
          These Terms are governed by the laws of the State of Delaware, without regard to its
          conflict of law principles. You agree that any dispute arising out of or relating to
          these Terms or the Services will first be attempted to be resolved informally by
          contacting us at{" "}
          <a href="mailto:jaylen@trenchsports.ai" className="ts-termsLink">
            jaylen@trenchsports.ai
          </a>
          .
        </p>
        <div className="ts-termsCallout">
          <span className="ts-termsCalloutIcon">📌</span>
          <p>
            <strong>Arbitration:</strong> If informal resolution fails, disputes will be resolved
            through binding individual arbitration rather than in court. You have 30 days from first
            accepting these Terms to opt out of arbitration by notifying us in writing. Class action
            lawsuits and class-wide arbitration are not permitted under these Terms.
          </p>
        </div>
        <p>
          Nothing in these Terms prevents either party from seeking injunctive or other equitable
          relief in a court of competent jurisdiction to prevent irreparable harm.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    icon: "🚪",
    title: "Termination",
    content: (
      <>
        <p>
          You may terminate your account at any time by deleting it from your account settings
          or by contacting us. Upon termination, your right to access the Services ceases
          immediately. Data deletion follows the schedule described in our{" "}
          <Link to="/privacy" className="ts-termsLink">Privacy Policy</Link>.
        </p>
        <p>
          Trench Sports reserves the right to suspend or terminate your account at any time if
          you violate these Terms, engage in fraudulent activity, or if continued operation of
          your account poses a risk to the platform or other users. We will make reasonable
          efforts to notify you unless notification is prohibited by law or would compromise
          a security investigation.
        </p>
        <p>
          Sections of these Terms that by their nature should survive termination — including
          intellectual property, disclaimers, and dispute resolution — will remain in effect after
          your account is closed.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    icon: "✉️",
    title: "Contact & notices",
    content: (
      <>
        <p>
          For questions about these Terms, your account, or legal notices, contact us at:
        </p>
        <div className="ts-termsContactBlock">
          <div className="ts-termsContactRow">
            <span className="ts-termsContactLabel">Email</span>
            <a href="mailto:jaylen@trenchsports.ai" className="ts-termsLink">
              jaylen@trenchsports.ai
            </a>
          </div>
          <div className="ts-termsContactRow">
            <span className="ts-termsContactLabel">Platform</span>
            <Link to="/contact" className="ts-termsLink">trenchsports.ai/contact</Link>
          </div>
          <div className="ts-termsContactRow">
            <span className="ts-termsContactLabel">Response time</span>
            <span className="ts-muted" style={{ fontSize: 13 }}>Within 2 business days</span>
          </div>
        </div>
        <p>
          Legal notices to Trench Sports must be submitted in writing to the email above with
          "LEGAL NOTICE" in the subject line. We will acknowledge receipt within 5 business days.
        </p>
      </>
    ),
  },
];

/* ─── Component ─────────────────────────────────────────── */
export default function Terms() {
  const [openSection, setOpenSection] = useState<string | null>("agreement");

  function toggle(id: string) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  return (
    <div className="ts-landing ts-terms">

      {/* ── HERO ────────────────────────────────────────────── */}
      <section className="ts-hero ts-termsHero">
        <div className="ts-heroInner ts-termsHeroInner">
          <div className="ts-pill">
            <span className="ts-dot" />
            Terms &amp; Conditions
          </div>

          <h1 className="ts-h1" style={{ textAlign: "center" }}>
            Clear rules.&nbsp;
            <span className="ts-gradientText">No fine print.</span>
          </h1>

          <p className="ts-sub" style={{ textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
            These Terms govern your use of the Trench Sports platform, hardware, and services.
            We've written them to be readable — not buried in legalese.
          </p>

          <div className="ts-termsMetaRow">
            <div className="ts-termsMetaPill">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
              Effective: January 1, 2025
            </div>
            <div className="ts-termsMetaPill">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Last updated: March 2026
            </div>
            <div className="ts-termsMetaPill">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>
              </svg>
              Delaware, USA
            </div>
          </div>
        </div>
      </section>

      {/* ── SUMMARY CARDS ───────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <h2 className="ts-h2">The short version</h2>
            <p className="ts-muted">Key points before you dive into the full terms.</p>
          </div>

          <div className="ts-termsSummaryGrid">
            {[
              {
                icon: "🎯",
                title: "You own your data",
                body: "Performance data you generate is yours. We only use it to run your dashboard and — optionally — improve our AI.",
              },
              {
                icon: "🚫",
                title: "No selling your data",
                body: "We don't monetize user data. No ads, no data brokers, no third-party sharing. Ever.",
              },
              {
                icon: "🔑",
                title: "You control your account",
                body: "Cancel, export, or delete anytime. No lock-in contracts. Your access runs through the billing period.",
              },
              {
                icon: "📋",
                title: "Use it fairly",
                body: "The platform is for athletic performance. Don't reverse-engineer it, scrape it, or use it to build a competitor.",
              },
            ].map((c) => (
              <div key={c.title} className="ts-termsSummaryCard">
                <div className="ts-termsSummaryGlow" />
                <span className="ts-termsSummaryIcon">{c.icon}</span>
                <h3 className="ts-h3" style={{ margin: "10px 0 6px", fontSize: 15 }}>{c.title}</h3>
                <p className="ts-muted" style={{ fontSize: 13, margin: 0 }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TOC ─────────────────────────────────────────────── */}
      <section className="ts-section" style={{ paddingTop: 0 }}>
        <div className="ts-container">
          <div className="ts-termsToc">
            <div className="ts-termsTocGlow" />
            <p className="ts-termsTocLabel">Jump to section</p>
            <div className="ts-termsTocLinks">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className="ts-termsTocBtn"
                  onClick={() => {
                    setOpenSection(s.id);
                    document.getElementById(`ts-term-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <span>{s.icon}</span> {s.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ACCORDION SECTIONS ──────────────────────────────── */}
      <section className="ts-section" style={{ paddingTop: 0 }}>
        <div className="ts-container">
          <div className="ts-termsAccordion">
            {SECTIONS.map((sec, idx) => {
              const isOpen = openSection === sec.id;
              return (
                <div
                  key={sec.id}
                  id={`ts-term-${sec.id}`}
                  className={`ts-termsSection ${isOpen ? "open" : ""}`}
                >
                  <button
                    className="ts-termsSectionBtn"
                    onClick={() => toggle(sec.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="ts-termsSectionLeft">
                      <span className="ts-termsSectionNum">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="ts-termsSectionEmoji">{sec.icon}</span>
                      <span className="ts-termsSectionTitle">{sec.title}</span>
                    </span>
                    <span className="ts-termsChevron" aria-hidden>
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path d="M19 9l-7 7-7-7"/>
                      </svg>
                    </span>
                  </button>

                  <div className="ts-termsSectionBody">
                    <div className="ts-termsSectionBodyInner">
                      {sec.content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── BOTTOM CTA ──────────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-termsCtaCard">
            <div className="ts-termsCtaGlow" />
            <div className="ts-termsCtaContent">
              <span style={{ fontSize: 32, lineHeight: 1 }}>⚖️</span>
              <div>
                <h3 className="ts-h3" style={{ margin: "0 0 6px" }}>Questions about these terms?</h3>
                <p className="ts-muted" style={{ margin: 0, fontSize: 14 }}>
                  If anything is unclear or you want to discuss your account rights, reach out.
                  We're a real team and we respond.
                </p>
              </div>
            </div>
            <div className="ts-termsCtaActions">
              <a href="mailto:jaylen@trenchsports.ai" className="ts-btnPrimary">
                Email us
              </a>
              <Link to="/privacy" className="ts-btnSecondary">
                Privacy Policy
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
            <Link to="/privacy">Privacy</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>

      {/* ── PAGE-SCOPED STYLES ──────────────────────────────── */}
      <style>{`

        /* ── Hero ── */
        .ts-termsHero {
          padding: 80px 20px 60px;
          text-align: center;
        }
        .ts-termsHeroInner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          max-width: 680px;
          margin: 0 auto;
        }
        .ts-termsMetaRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 4px;
        }
        .ts-termsMetaPill {
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

        /* ── Summary cards ── */
        .ts-termsSummaryGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-top: 28px;
        }
        .ts-termsSummaryCard {
          position: relative;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid rgba(180,0,255,0.20);
          border-radius: 20px;
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          transition: border-color 160ms ease, transform 160ms ease;
        }
        .ts-termsSummaryCard:hover {
          border-color: rgba(180,0,255,0.44);
          transform: translateY(-2px);
        }
        .ts-termsSummaryGlow {
          position: absolute;
          top: -28px; right: -28px;
          width: 110px; height: 110px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.14) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-termsSummaryIcon { font-size: 26px; line-height: 1; }

        /* ── TOC ── */
        .ts-termsToc {
          position: relative;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 20px;
          padding: 22px 24px;
        }
        .ts-termsTocGlow {
          position: absolute;
          bottom: -40px; right: -40px;
          width: 180px; height: 180px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.10) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-termsTocLabel {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--muted);
          margin: 0 0 14px;
        }
        .ts-termsTocLinks {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .ts-termsTocBtn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 99px;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--panel-border);
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
          cursor: pointer;
          transition: border-color 160ms, color 160ms, background 160ms;
          white-space: nowrap;
        }
        .ts-termsTocBtn:hover {
          border-color: rgba(180,0,255,0.40);
          color: var(--text);
          background: rgba(180,0,255,0.08);
        }

        /* ── Accordion ── */
        .ts-termsAccordion {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ts-termsSection {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 18px;
          overflow: hidden;
          transition: border-color 160ms ease;
          scroll-margin-top: 80px;
        }
        .ts-termsSection.open {
          border-color: rgba(180,0,255,0.36);
          box-shadow: 0 0 0 2px rgba(180,0,255,0.08);
        }
        .ts-termsSectionBtn {
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
        .ts-termsSectionBtn:hover { background: rgba(180,0,255,0.05); }
        .ts-termsSectionLeft {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ts-termsSectionNum {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.5px;
          color: var(--accent);
          opacity: 0.7;
          min-width: 20px;
        }
        .ts-termsSectionEmoji { font-size: 18px; line-height: 1; flex-shrink: 0; }
        .ts-termsSectionTitle { font-size: 15px; font-weight: 800; letter-spacing: 0.1px; }
        .ts-termsChevron {
          flex-shrink: 0;
          color: var(--muted);
          display: flex;
          transition: transform 240ms cubic-bezier(0.4,0,0.2,1), color 160ms;
        }
        .ts-termsSection.open .ts-termsChevron {
          transform: rotate(180deg);
          color: var(--accent);
        }
        .ts-termsSectionBody {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1);
        }
        .ts-termsSection.open .ts-termsSectionBody { grid-template-rows: 1fr; }
        .ts-termsSectionBodyInner { overflow: hidden; min-height: 0; }

        /* Body text */
        .ts-termsSectionBodyInner p,
        .ts-termsSectionBodyInner ul {
          margin: 0 0 14px;
          padding: 0 22px;
          font-size: 14px;
          line-height: 1.7;
          color: var(--muted);
        }
        .ts-termsSectionBodyInner p:first-child { padding-top: 4px; }
        .ts-termsSectionBodyInner p:last-child,
        .ts-termsSectionBodyInner ul:last-child {
          padding-bottom: 22px;
          margin-bottom: 0;
        }
        .ts-termsSectionBodyInner strong { color: var(--text); font-weight: 800; }

        /* List */
        .ts-termsList {
          list-style: none !important;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-left: 22px !important;
          padding-right: 22px !important;
        }
        .ts-termsList li {
          position: relative;
          padding-left: 18px;
          font-size: 14px;
          line-height: 1.65;
          color: var(--muted);
        }
        .ts-termsList li::before {
          content: "";
          position: absolute;
          left: 0; top: 9px;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: rgba(180,0,255,0.6);
        }

        /* Callout */
        .ts-termsCallout {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px 18px;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          margin: 0 22px 14px !important;
        }
        .ts-termsCallout--purple {
          background: rgba(180,0,255,0.07);
          border-color: rgba(180,0,255,0.28);
        }
        .ts-termsCallout p {
          padding: 0 !important;
          margin: 0 !important;
          font-size: 13.5px !important;
        }
        .ts-termsCalloutIcon { font-size: 18px; line-height: 1.4; flex-shrink: 0; }

        /* Link */
        .ts-termsLink {
          color: var(--accent);
          font-weight: 700;
          text-decoration: none;
          transition: opacity 160ms;
        }
        .ts-termsLink:hover { opacity: 0.75; }

        /* Contact block */
        .ts-termsContactBlock {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0 22px 14px !important;
          padding: 18px 20px !important;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--panel-border);
          border-radius: 14px;
        }
        .ts-termsContactRow {
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 13px;
        }
        .ts-termsContactLabel {
          font-weight: 800;
          color: var(--text);
          min-width: 100px;
          font-size: 12px;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          opacity: 0.6;
        }

        /* CTA card */
        .ts-termsCtaCard {
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
          .ts-termsCtaCard {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }
        .ts-termsCtaGlow {
          position: absolute;
          top: -50px; right: -50px;
          width: 220px; height: 220px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.13) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-termsCtaContent {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }
        .ts-termsCtaActions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
      `}</style>
    </div>
  );
}