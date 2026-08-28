// src/components/strengthIndexInfo.tsx
//
// Shared "ⓘ" info affordance that explains the Strength Index (SI) metric.
// Rendered identically on the mobile dashboard and the live session page so
// coaches get the same explanation wherever SI appears.
//
// Content is grounded in the internal metric-design reference
// (voltage_si_metric_design.docx): SI is a rate-of-force score (0–1000) derived
// from the hardware's raw millivolt readings — it rewards how *fast* an athlete
// reaches peak output, decays for held contact, and scales to each hardware
// model's scan resolution.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModeIcon } from "./modeIcon";

const ACCENT = "#b400ff";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
        textTransform: "uppercase", color: ACCENT, marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)", opacity: 0.92 }}>
        {children}
      </div>
    </div>
  );
}

export interface StrengthIndexInfoProps {
  /** Diameter of the icon button in px. Default 18. */
  size?: number;
  /** Optional override for the icon button's inline style. */
  style?: React.CSSProperties;
  /** Accessible label / tooltip. Default "About Strength Index". */
  label?: string;
}

export function StrengthIndexInfo({
  size = 18,
  style,
  label = "About Strength Index",
}: StrengthIndexInfoProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        style={{
          width: size, height: size, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          borderRadius: "50%", padding: 0,
          border: `1px solid ${ACCENT}66`,
          background: "rgba(180,0,255,0.10)",
          color: ACCENT,
          fontSize: Math.round(size * 0.62), fontWeight: 800, lineHeight: 1,
          fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif",
          cursor: "pointer",
          transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease",
          ...style,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(180,0,255,0.20)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(180,0,255,0.10)"; }}
      >
        i
      </button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Strength Index explained"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(460px, 100%)", maxHeight: "min(80vh, 680px)",
              display: "flex", flexDirection: "column",
              // Solid, theme-aware surface: --panel alone is a near-transparent
              // overlay tint meant to sit on the page, so over the modal backdrop
              // it would read dark in both themes. Layer the panel tint over the
              // opaque --bg token (#07070a dark / #f7f7fb light) so the modal is
              // solid and adapts to light/dark.
              background: "linear-gradient(var(--panel), var(--panel)), var(--bg)",
              border: "1px solid var(--panel-border)",
              borderRadius: 16,
              boxShadow: "0 24px 60px -12px rgba(0,0,0,0.55)",
              animation: "siInfoSlideUp 0.2s ease-out",
              overflow: "hidden",
            }}
          >
            <style>{`@keyframes siInfoSlideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              gap: 12, padding: "16px 16px 12px",
              borderBottom: "1px solid var(--panel-border)",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", letterSpacing: "0.01em", display: "flex", alignItems: "center", gap: 7 }}>
                  <ModeIcon mode="power" size={17} style={{ color: "#b400ff" }} />
                  Strength Index
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Rate-of-force score · 0–1000
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--muted)", fontSize: 18, lineHeight: 1, padding: 4, flexShrink: 0,
                }}
              >✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: 16, overflowY: "auto" }}>
              <Section title="What it measures">
                Strength Index captures <strong>how fast you reach peak output</strong> on a
                strike — not just how hard you push. Two contacts can hit the same voltage,
                but a sharp 8&nbsp;ms punch and a slow 200&nbsp;ms lean are athletically very
                different. SI separates them on a single 0–1000 scale.
              </Section>

              <Section title="How it works">
                The bag's sensors report raw voltage per cell. SI takes the peak voltage and
                divides it by the time taken to reach that peak — so a faster, more explosive
                impact scores higher. Holding contact after the hit makes the score
                <strong> decay</strong> (a ~100&nbsp;ms half-life), so only the initial spike
                counts — leaning on the bag won't inflate it.
                <div style={{
                  marginTop: 10, padding: "8px 10px", borderRadius: 8,
                  background: "rgba(180,0,255,0.06)", border: "1px solid rgba(180,0,255,0.18)",
                  fontFamily: "monospace", fontSize: 11.5, color: "var(--text)", lineHeight: 1.7,
                }}>
                  rate = peak&nbsp;voltage ÷ time-to-peak<br />
                  SI&nbsp;&nbsp;&nbsp;= (rate ÷ max&nbsp;rate) × 1000 × decay
                </div>
              </Section>

              <Section title="Why it works (and why not Newtons)">
                The sensors are resistive — there's no calibration constant to honestly convert
                voltage to Newtons, and readings drift with temperature, wear, and bag material.
                A "245&nbsp;N" number would be fabricated precision. SI instead measures
                something real and repeatable: <strong>speed of force application</strong>. It
                also accounts for hardware — the scoring ceiling is tied to scan resolution, so
                a faster Model&nbsp;III (120&nbsp;Hz) can reach the full 0–1000 while a Model&nbsp;II
                (27&nbsp;Hz) naturally caps lower rather than being falsely equalized.
              </Section>

              <Section title="How to read the results">
                <strong>Higher = more explosive.</strong> The most useful signal is the trend
                over time: compare an athlete to <strong>their own</strong> past sessions rather
                than to raw numbers across devices. Watch the <strong>SI fatigue slope</strong>
                across a session — a downward slope means power is dropping as they tire
                (a cue to shorten windows or add rest). Pair SI with <strong>V (peak voltage)</strong>,
                which shows raw amplitude, and with hit count for volume work.
              </Section>

              <div style={{
                fontSize: 11, color: "var(--muted)", lineHeight: 1.55,
                paddingTop: 10, borderTop: "1px solid var(--panel-border)",
              }}>
                <strong style={{ color: "var(--text)" }}>V vs SI:</strong> V is the honest raw
                voltage the hardware outputs (used for heatmaps and peak-force). SI is built on
                top of it to reward explosive speed and penalize held contact.
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default StrengthIndexInfo;
