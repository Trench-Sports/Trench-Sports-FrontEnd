// src/pages/useCasePage.tsx
// One reusable template for every audience use-case page. Reads a content object
// by slug and renders Andrew's seven-section layout: hero → problem → workflow →
// outcomes (the alternating device rows) → proof → objections → closing CTA.
// Adding a new audience is a content entry + a route — never a new component.
import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import FooterLogo from "../components/footerLogo";
import { LaptopFrame, PhoneFrame } from "../components/deviceFrame";
import { VISUALS } from "../components/useCaseVisuals";
import { getUseCase, type OutcomeRow } from "../content/useCases";
import { getTestimonials } from "../content/testimonials";
import { useSeo } from "../hooks/useSeo";

function OutcomeVisual({ row }: { row: OutcomeRow }) {
  // A real screenshot wins over the coded fallback — same slot either way.
  if (row.image) {
    const img = (
      <img className="ts-uc-shot" src={row.image} alt={row.imageAlt ?? row.title} loading="lazy" />
    );
    return row.device === "phone" ? (
      <PhoneFrame flush label="LIVE">{img}</PhoneFrame>
    ) : (
      <LaptopFrame flush label="LIVE">{img}</LaptopFrame>
    );
  }
  const Visual = VISUALS[row.visual];
  const inner = Visual ? <Visual /> : null;
  return row.device === "phone" ? (
    <PhoneFrame label="LIVE">{inner}</PhoneFrame>
  ) : (
    <LaptopFrame label="LIVE">{inner}</LaptopFrame>
  );
}

export default function UseCasePage({ slug }: { slug: string }) {
  const content = getUseCase(slug);
  const [openObj, setOpenObj] = useState<number | null>(0);

  // Hooks must run unconditionally, so seo runs on a safe fallback when the slug
  // is unknown; the redirect below still short-circuits the render.
  useSeo({
    title: content?.seo.title ?? "Trench Sports",
    description: content?.seo.description ?? "",
    canonical: content?.seo.canonical,
    ogImage: content?.seo.ogImage,
  });

  if (!content) return <Navigate to="/" replace />;

  const { hero, problem, workflow, outcomes, proof, objections, closing } = content;
  const testimonials = getTestimonials(proof.testimonialNames);

  return (
    <div className="ts-landing ts-uc">

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="ts-hero ts-uc-hero">
        <div className="ts-uc-heroInner">
          <div className="ts-pill"><span className="ts-dot" />{hero.kicker}</div>
          <h1 className="ts-h1 ts-uc-heroH1">{hero.headline}</h1>
          <p className="ts-sub ts-uc-heroSub">{hero.sub}</p>
          <div className="ts-ctaRow ts-uc-heroCtas">
            <Link className="ts-btnPrimary" to={hero.primaryCta.to}>{hero.primaryCta.label}</Link>
            <Link className="ts-btnSecondary" to={hero.secondaryCta.to}>{hero.secondaryCta.label}</Link>
          </div>
          {hero.stats && hero.stats.length > 0 && (
            <div className="ts-uc-statStrip">
              {hero.stats.map((s) => (
                <div key={s.label} className="ts-uc-stat">
                  <span className="ts-uc-statVal">{s.value}</span>
                  <span className="ts-uc-statLbl">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── PROBLEM ───────────────────────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container ts-uc-narrow">
          <div className="ts-sectionTitleRow">
            <div className="ts-kicker">{problem.kicker}</div>
            <h2 className="ts-h2">{problem.title}</h2>
          </div>
          <p className="ts-muted ts-uc-problemBody">{problem.body}</p>
          <ul className="ts-uc-bullets">
            {problem.bullets.map((b) => (
              <li key={b} className="ts-uc-bullet"><span className="ts-uc-bulletDot" />{b}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── WORKFLOW ──────────────────────────────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center" }}>
            <div className="ts-kicker">{workflow.kicker}</div>
            <h2 className="ts-h2">{workflow.title}</h2>
          </div>
          <div className="ts-howGrid">
            {workflow.steps.map((step, i) => (
              <div key={step.title} className="ts-howCard">
                <div className="ts-howStep">{String(i + 1).padStart(2, "0")}</div>
                <h3 className="ts-h3">{step.title}</h3>
                <p className="ts-muted">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OUTCOMES (alternating device rows) ────────────────────────── */}
      <section className="ts-section">
        <div className="ts-container">
          <div className="ts-sectionTitleRow">
            <div className="ts-kicker">{outcomes.kicker}</div>
            <h2 className="ts-h2">{outcomes.title}</h2>
          </div>
          <div className="ts-featureList">
            {outcomes.rows.map((row) => (
              <div key={row.num} className="ts-featureRow ts-uc-row">
                <div className="ts-featureLeft">
                  <div className="ts-featureNum">{row.num}</div>
                  <div>
                    <div className="ts-featureKicker">{row.kicker}</div>
                    <h3 className="ts-featureTitle">{row.title}</h3>
                    <p className="ts-muted">{row.body}</p>
                    <div className="ts-tagRow">
                      {row.tags.map((t) => <span key={t} className="ts-tag">{t}</span>)}
                    </div>
                  </div>
                </div>
                <div className="ts-featureRight">
                  <OutcomeVisual row={row} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROOF ─────────────────────────────────────────────────────── */}
      {testimonials.length > 0 && (
        <section className="ts-section">
          <div className="ts-container">
            <div className="ts-sectionTitleRow" style={{ textAlign: "center", justifyItems: "center", marginBottom: 32 }}>
              <div className="ts-kicker">{proof.kicker}</div>
              <h2 className="ts-h2">{proof.title}</h2>
              {proof.note && <p className="ts-muted" style={{ maxWidth: "52ch" }}>{proof.note}</p>}
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
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── OBJECTIONS ────────────────────────────────────────────────── */}
      {objections.length > 0 && (
        <section className="ts-section">
          <div className="ts-container ts-uc-narrow">
            <div className="ts-sectionTitleRow">
              <div className="ts-kicker">Questions</div>
              <h2 className="ts-h2">Straight answers.</h2>
            </div>
            <div className="ts-uc-objList">
              {objections.map((o, idx) => {
                const isOpen = openObj === idx;
                return (
                  <div key={o.q} className={`ts-uc-objItem ${isOpen ? "open" : ""}`}>
                    <button
                      className="ts-uc-objQ"
                      onClick={() => setOpenObj((p) => (p === idx ? null : idx))}
                      aria-expanded={isOpen}
                    >
                      <span>{o.q}</span>
                      <span className="ts-uc-objChevron" aria-hidden>
                        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path d="M19 9l-7 7-7-7" />
                        </svg>
                      </span>
                    </button>
                    <div className="ts-uc-objA"><div className="ts-uc-objAInner"><p>{o.a}</p></div></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── CLOSING CTA ───────────────────────────────────────────────── */}
      <section className="ts-ctaBanner">
        <div className="ts-ctaBannerGlow" />
        <div className="ts-ctaBannerInner">
          <div className="ts-kicker" style={{ color: "rgba(180,0,255,0.9)" }}>Get Started</div>
          <h2 className="ts-ctaBannerTitle">{closing.title}</h2>
          <p className="ts-muted" style={{ maxWidth: "48ch", margin: "0 auto 28px" }}>{closing.body}</p>
          <div className="ts-ctaRow" style={{ justifyContent: "center" }}>
            <Link className="ts-btnPrimary" to={hero.primaryCta.to} style={{ padding: "14px 28px", fontSize: 16 }}>
              {closing.ctaLabel}
            </Link>
            <Link className="ts-btnSecondary" to={hero.secondaryCta.to} style={{ padding: "14px 28px", fontSize: 16 }}>
              {hero.secondaryCta.label}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="ts-footer">
        <div className="ts-container ts-footerRow">
          <div className="ts-footerBrand"><FooterLogo /></div>
          <div className="ts-footerLinks">
            <Link to="/">Home</Link>
            <Link to="/signup">Signup</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
          <div className="ts-footerCopy">© {new Date().getFullYear()} Trench Sports</div>
        </div>
      </footer>
    </div>
  );
}
