// src/pages/contact.tsx
import React, { useState } from "react";
import FooterLogo from "../components/footerLogo";
import { Link } from "react-router-dom";
import {
  IconMessage, IconWrench, IconHandshake, IconNewspaper, IconZap,
  IconMail, IconCheck, type IconProps,
} from "../components/icons";

/* ─── Types ─────────────────────────────────────────────── */
type InquiryType = "general" | "support" | "partnership" | "press" | "feedback";

const INQUIRY_OPTIONS: { value: InquiryType; label: string; Icon: React.ComponentType<IconProps> }[] = [
  { value: "general",     label: "General Inquiry",   Icon: IconMessage },
  { value: "support",     label: "Technical Support", Icon: IconWrench },
  { value: "partnership", label: "Partnership",       Icon: IconHandshake },
  { value: "press",       label: "Press / Media",     Icon: IconNewspaper },
  { value: "feedback",    label: "Product Feedback",  Icon: IconZap },
];

type FAQ = { q: string; a: string };

const FAQS: FAQ[] = [
  {
    q: "What is Trench Sports and who is it for?",
    a: "Trench Sports is an AI-driven athletic performance platform that turns impact data into actionable coaching insights. It's built for athletes, coaches, and training programs who want precise, real-time metrics — from youth development teams to elite performance facilities.",
  },
  {
    q: "How does the sensor system capture impact data?",
    a: "Our 12×8 sensor grid captures up to 3,600 impact events per second using two intelligent modes: Listen mode for efficient idle scanning, and Burst mode that automatically spikes sampling rate when an impact is detected — capturing the full hit profile in high resolution without burning battery.",
  },
  {
    q: "What does the Trench Sports dashboard show?",
    a: "The dashboard surfaces force magnitude, strike location heatmaps, tempo and rhythm trends, session summaries, and historical comparisons. Everything is designed to be coach-friendly and immediately actionable — no data science degree required.",
  },
  {
    q: "How do I get started with a program?",
    a: "Create a free account, complete your athlete profile during onboarding, and connect your sensor pad. From there the dashboard begins logging sessions automatically. Reach out to support if you need help pairing hardware for the first time.",
  },
  {
    q: "Is my performance data private and secure?",
    a: "Yes. Each athlete's data is scoped to their account and program. Coaches within the same program can access athlete data only when permission is granted. We use industry-standard encryption at rest and in transit.",
  },
  {
    q: "What devices and platforms does Trench Sports run on?",
    a: "The web platform runs in any modern browser on desktop, tablet, or mobile. A dedicated native mobile app is on the roadmap. The sensor hardware connects via BLE and does not require a persistent internet connection to log locally.",
  },
  {
    q: "Can I cancel or change my subscription anytime?",
    a: "Absolutely. Plans can be upgraded, downgraded, or cancelled from your account settings at any time. There are no lock-in contracts. If you cancel, you retain access through the end of your current billing period.",
  },
  {
    q: "How do I report a bug or request a feature?",
    a: "Use the contact form on this page and select “Product Feedback” as the inquiry type. Our team reviews every submission. For urgent bugs, email calvin@trenchsports.ai directly with 'BUG' in the subject line for faster triage.",
  },
];

/* ─── Component ─────────────────────────────────────────── */
export default function Contact() {
  /* Contact form state */
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [inquiry, setInquiry]     = useState<InquiryType>("general");
  const [message, setMessage]     = useState("");
  const [sent, setSent]           = useState(false);

  /* Newsletter state */
  const [newsEmail, setNewsEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  /* FAQ open state */
  const [openFaq, setOpenFaq]     = useState<number | null>(null);

  /* ── Handlers ────────────────────────────── */
  function handleContact(e: React.FormEvent) {
    e.preventDefault();
    const sub  = encodeURIComponent(`[${inquiry.toUpperCase()}] Message from ${name}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nInquiry: ${inquiry}\n\n${message}`
    );
    window.location.href = `mailto:calvin@trenchsports.ai?subject=${sub}&body=${body}`;
    setSent(true);
  }

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    // Wire up to your email platform (Mailchimp, Resend, etc.) here
    setSubscribed(true);
  }

  function toggleFaq(idx: number) {
    setOpenFaq((prev) => (prev === idx ? null : idx));
  }

  return (
    <div className="ts-landing ts-contact">

      {/* ── HERO ──────────────────────────────────────────── */}
      <section className="ts-hero ts-contactHero">
        <div className="ts-heroInner ts-contactHeroInner">
          <div className="ts-pill">
            <span className="ts-dot" />
            Support &amp; Contact
          </div>

          <h1 className="ts-h1" style={{ textAlign: "center" }}>
            We're in your&nbsp;
            <span className="ts-gradientText">corner.</span>
          </h1>

          <p className="ts-sub" style={{ textAlign: "center", maxWidth: 520, margin: "0 auto 0" }}>
            Questions about the platform, partnership ideas, or just want to give feedback?
            Reach out — we read every message.
          </p>

          {/* Quick-contact pills */}
          <div className="ts-contactQuickRow">
            <a className="ts-contactQuickPill" href="mailto:calvin@trenchsports.ai">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              calvin@trenchsports.ai
            </a>
            <div className="ts-contactQuickPill ts-contactQuickPill--neutral">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/>
              </svg>
              Replies within 24 hrs
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTACT + NEWSLETTER SPLIT ────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-contactGrid">

            {/* ── Contact Form ── */}
            <div className="ts-contactCard">
              <div className="ts-contactCardHeader">
                <div className="ts-contactCardIcon">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z"/>
                  </svg>
                </div>
                <div>
                  <h2 className="ts-h3" style={{ margin: 0 }}>Send a message</h2>
                  <p className="ts-muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                    Goes straight to the Trench Sports team
                  </p>
                </div>
              </div>

              {sent ? (
                <div className="ts-contactSuccess">
                  <div className="ts-contactSuccessIcon"><IconCheck size={26} /></div>
                  <p className="ts-h3" style={{ margin: "0 0 6px" }}>Message launched.</p>
                  <p className="ts-muted" style={{ margin: 0, fontSize: 14 }}>
                    Your email client should open with the message pre-filled.
                    We'll get back to you within 24 hours.
                  </p>
                  <button
                    className="ts-btnSecondary"
                    style={{ marginTop: 18, fontSize: 13 }}
                    onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); }}
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form className="ts-contactForm" onSubmit={handleContact}>
                  {/* Inquiry type selector */}
                  <div className="ts-fieldGroup">
                    <label className="ts-label">Inquiry type</label>
                    <div className="ts-inquiryPills">
                      {INQUIRY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ts-inquiryPill ${inquiry === opt.value ? "active" : ""}`}
                          onClick={() => setInquiry(opt.value)}
                        >
                          <opt.Icon size={15} />{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ts-fieldRow">
                    <div className="ts-fieldGroup">
                      <label className="ts-label" htmlFor="contact-name">Name</label>
                      <input
                        id="contact-name"
                        className="ts-input"
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="ts-fieldGroup">
                      <label className="ts-label" htmlFor="contact-email">Email</label>
                      <input
                        id="contact-email"
                        className="ts-input"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="ts-fieldGroup">
                    <label className="ts-label" htmlFor="contact-msg">Message</label>
                    <textarea
                      id="contact-msg"
                      className="ts-input ts-textarea"
                      placeholder="Tell us what's on your mind…"
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                    />
                  </div>

                  <button type="submit" className="ts-btnPrimary ts-contactSubmit">
                    Send Message
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </button>
                </form>
              )}
            </div>

            {/* ── Right column: newsletter + info cards ── */}
            <div className="ts-contactSide">

              {/* Newsletter */}
              <div className="ts-newsCard">
                <div className="ts-newsGlow" />
                <div className="ts-newsTop">
                  <span className="ts-newsIcon"><IconZap size={22} /></span>
                  <div>
                    <p className="ts-newsTitle">Stay in the loop</p>
                    <p className="ts-muted" style={{ fontSize: 13, margin: 0 }}>
                      Platform updates, training insights, and early feature access.
                    </p>
                  </div>
                </div>

                {subscribed ? (
                  <div className="ts-newsSuccess">
                    <IconCheck size={16} /> You're subscribed — welcome to the grind.
                  </div>
                ) : (
                  <form className="ts-newsForm" onSubmit={handleSubscribe}>
                    <input
                      className="ts-input ts-newsInput"
                      type="email"
                      placeholder="Enter your email"
                      value={newsEmail}
                      onChange={(e) => setNewsEmail(e.target.value)}
                      required
                    />
                    <button type="submit" className="ts-btnSecondary ts-newsBtn">
                      Subscribe
                    </button>
                  </form>
                )}

                <p className="ts-newsFine">
                  No spam. Unsubscribe anytime.
                </p>
              </div>

              {/* Info cards */}
              <div className="ts-contactInfoCard">
                <div className="ts-contactInfoIcon"><IconWrench size={20} /></div>
                <div>
                  <p className="ts-contactInfoTitle">Technical Support</p>
                  <p className="ts-muted" style={{ fontSize: 13, margin: 0 }}>
                    Hardware pairing, sensor issues, or dashboard bugs — we've got you.
                  </p>
                </div>
              </div>

              <div className="ts-contactInfoCard">
                <div className="ts-contactInfoIcon"><IconHandshake size={20} /></div>
                <div>
                  <p className="ts-contactInfoTitle">Partnerships & Programs</p>
                  <p className="ts-muted" style={{ fontSize: 13, margin: 0 }}>
                    Interested in bringing Trench Sports to your facility or team?
                  </p>
                </div>
              </div>

              <div className="ts-contactInfoCard">
                <div className="ts-contactInfoIcon"><IconMail size={20} /></div>
                <div>
                  <p className="ts-contactInfoTitle">Direct line</p>
                  <a
                    href="mailto:calvin@trenchsports.ai"
                    className="ts-contactDirectEmail"
                  >
                    calvin@trenchsports.ai
                  </a>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <h2 className="ts-h2">Frequently asked questions</h2>
            <p className="ts-muted">
              Can't find the answer? Hit us at{" "}
              <a href="mailto:calvin@trenchsports.ai" style={{ color: "var(--accent)" }}>
                calvin@trenchsports.ai
              </a>
            </p>
          </div>

          <div className="ts-faqList">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className={`ts-faqItem ${isOpen ? "open" : ""}`}
                >
                  <button
                    className="ts-faqQuestion"
                    onClick={() => toggleFaq(idx)}
                    aria-expanded={isOpen}
                  >
                    <span>{faq.q}</span>
                    <span className="ts-faqChevron" aria-hidden>
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path d="M19 9l-7 7-7-7"/>
                      </svg>
                    </span>
                  </button>
                  <div className="ts-faqAnswer">
                    <div className="ts-faqAnswerInner">
                      <p>{faq.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────── */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand"><FooterLogo /></div>
          <div className="ts-footerLinks">
            <Link to="/">Home</Link>
            <Link to="/signup">Signup</Link>
            <Link to="/dashboard">Dashboard</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>

      {/* ── PAGE-SCOPED STYLES ────────────────────────────── */}
      <style>{`
        /* Hero */
        .ts-contactHero {
          padding: 80px 20px 60px;
          text-align: center;
        }
        .ts-contactHeroInner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          max-width: 680px;
          margin: 0 auto;
        }

        /* Quick row */
        .ts-contactQuickRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 4px;
        }
        .ts-contactQuickPill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 9px 16px;
          border-radius: 999px;
          border: 1px solid rgba(180,0,255,0.32);
          background: rgba(180,0,255,0.08);
          color: var(--text);
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
          transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
        }
        .ts-contactQuickPill:hover {
          background: rgba(180,0,255,0.16);
          border-color: rgba(180,0,255,0.55);
          transform: translateY(-1px);
        }
        .ts-contactQuickPill--neutral {
          border-color: var(--panel-border);
          background: var(--panel);
          color: var(--muted);
          cursor: default;
        }
        .ts-contactQuickPill--neutral:hover {
          transform: none;
          background: var(--panel);
          border-color: var(--panel-border);
        }

        /* Grid */
        .ts-contactGrid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .ts-contactGrid { grid-template-columns: 1fr; }
        }

        /* Contact card */
        .ts-contactCard {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 20px;
          padding: 28px;
        }
        .ts-contactCardHeader {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 24px;
        }
        .ts-contactCardIcon {
          width: 44px; height: 44px;
          border-radius: 12px;
          background: rgba(180,0,255,0.12);
          border: 1px solid rgba(180,0,255,0.28);
          display: grid; place-items: center;
          flex-shrink: 0;
          color: var(--accent);
        }

        /* Form */
        .ts-contactForm { display: flex; flex-direction: column; gap: 18px; }
        .ts-fieldRow {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 520px) { .ts-fieldRow { grid-template-columns: 1fr; } }
        .ts-fieldGroup { display: flex; flex-direction: column; gap: 6px; }
        .ts-label {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: var(--muted);
        }
        .ts-input {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--panel-border);
          border-radius: 12px;
          color: var(--text);
          padding: 11px 14px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease;
          width: 100%;
          box-sizing: border-box;
        }
        .ts-input:focus {
          border-color: rgba(180,0,255,0.50);
          box-shadow: 0 0 0 3px rgba(180,0,255,0.10);
        }
        .ts-input::placeholder { color: var(--muted); opacity: 0.6; }
        .ts-textarea { resize: vertical; min-height: 110px; }

        /* Inquiry pills */
        .ts-inquiryPills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .ts-inquiryPill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 13px;
          border-radius: 10px;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: border-color 160ms ease, color 160ms ease, background 160ms ease, transform 160ms ease;
          white-space: nowrap;
        }
        .ts-inquiryPill:hover {
          border-color: rgba(180,0,255,0.32);
          color: var(--text);
          transform: translateY(-1px);
        }
        .ts-inquiryPill.active {
          border-color: rgba(180,0,255,0.55);
          background: rgba(180,0,255,0.12);
          color: var(--text);
          box-shadow: 0 0 0 2px rgba(180,0,255,0.10);
        }

        /* Submit btn */
        .ts-contactSubmit {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          align-self: flex-start;
          padding: 12px 22px;
          font-weight: 800;
        }

        /* Success state */
        .ts-contactSuccess {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 32px 16px;
          gap: 4px;
        }
        .ts-contactSuccessIcon {
          width: 52px; height: 52px;
          border-radius: 50%;
          background: rgba(180,0,255,0.14);
          border: 1px solid rgba(180,0,255,0.40);
          display: grid; place-items: center;
          font-size: 22px;
          color: var(--accent);
          margin-bottom: 12px;
        }

        /* Right side cards */
        .ts-contactSide { display: flex; flex-direction: column; gap: 14px; }

        /* Newsletter */
        .ts-newsCard {
          position: relative;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid rgba(180,0,255,0.24);
          border-radius: 20px;
          padding: 22px;
        }
        .ts-newsGlow {
          position: absolute;
          top: -40px; right: -40px;
          width: 160px; height: 160px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,0,255,0.18) 0%, transparent 70%);
          pointer-events: none;
        }
        .ts-newsTop {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 16px;
        }
        .ts-newsIcon {
          display: inline-flex;
          align-items: center;
          color: var(--accent);
          line-height: 1;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .ts-newsTitle {
          font-weight: 900;
          font-size: 15px;
          margin: 0 0 2px;
          letter-spacing: 0.1px;
        }
        .ts-newsForm {
          display: flex;
          gap: 8px;
        }
        .ts-newsInput { flex: 1; font-size: 13px; padding: 10px 12px; }
        .ts-newsBtn { white-space: nowrap; font-size: 13px; padding: 10px 16px; }
        .ts-newsFine {
          font-size: 11px;
          color: var(--muted);
          margin: 10px 0 0;
          opacity: 0.65;
        }
        .ts-newsSuccess {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(180,0,255,0.10);
          border: 1px solid rgba(180,0,255,0.30);
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
        }

        /* Info cards */
        .ts-contactInfoCard {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 16px;
          padding: 16px 18px;
          transition: border-color 160ms ease, transform 160ms ease;
        }
        .ts-contactInfoCard:hover {
          border-color: rgba(180,0,255,0.28);
          transform: translateY(-1px);
        }
        .ts-contactInfoIcon { display: inline-flex; align-items: center; color: var(--accent); flex-shrink: 0; line-height: 1; margin-top: 2px; }
        .ts-contactInfoTitle { font-weight: 900; font-size: 14px; margin: 0 0 3px; }
        .ts-contactDirectEmail {
          font-size: 13px;
          font-weight: 700;
          color: var(--accent);
          text-decoration: none;
          transition: opacity 160ms;
        }
        .ts-contactDirectEmail:hover { opacity: 0.75; }

        /* FAQ */
        .ts-faqList {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 28px;
        }
        .ts-faqItem {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 16px;
          overflow: hidden;
          transition: border-color 160ms ease;
        }
        .ts-faqItem.open {
          border-color: rgba(180,0,255,0.36);
          box-shadow: 0 0 0 2px rgba(180,0,255,0.08);
        }
        .ts-faqQuestion {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 20px;
          background: transparent;
          border: none;
          border-radius: 0;
          cursor: pointer;
          text-align: left;
          font-size: 14px;
          font-weight: 800;
          color: var(--text);
          letter-spacing: 0.1px;
          transition: background 160ms ease;
        }
        .ts-faqQuestion:hover {
          background: rgba(180,0,255,0.05);
          transform: none;
          box-shadow: none;
          border-color: transparent;
        }
        .ts-faqQuestion:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .ts-faqChevron {
          flex-shrink: 0;
          color: var(--muted);
          transition: transform 240ms cubic-bezier(0.4,0,0.2,1), color 160ms;
          display: flex;
        }
        .ts-faqItem.open .ts-faqChevron {
          transform: rotate(180deg);
          color: var(--accent);
        }
        .ts-faqAnswer {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1);
        }
        .ts-faqItem.open .ts-faqAnswer {
          grid-template-rows: 1fr;
        }
        .ts-faqAnswerInner {
          overflow: hidden;
          min-height: 0;
        }
        .ts-faqAnswerInner > p {
          margin: 0;
          padding: 0 20px 18px;
          font-size: 14px;
          line-height: 1.65;
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}