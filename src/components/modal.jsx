// src/components/modal.jsx
//
// Trench Sports — Modal / Popup template
//
// Usage:
//   import Modal from "./modal";
//
//   <Modal
//     open={isOpen}
//     onClose={() => setIsOpen(false)}
//     title="Confirm Action"
//     size="md"                  // "sm" | "md" | "lg"
//     closeOnBackdrop={true}
//     closeOnEsc={true}
//     footer={                   // optional — pass null to hide footer
//       <>
//         <button className="ts-btn ts-btnGhost" onClick={() => setIsOpen(false)}>Cancel</button>
//         <button className="ts-btn ts-btnPrimary" onClick={handleConfirm}>Confirm</button>
//       </>
//     }
//   >
//     <p>Modal body content goes here.</p>
//   </Modal>

import React, { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ─── Inline styles (scoped — won't pollute global CSS) ───────────────────────

const S = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    background: "rgba(7, 7, 10, 0.72)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    animation: "ts-modalOverlayIn 180ms ease forwards",
  },
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    maxHeight: "calc(100vh - 80px)",
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "20px",
    boxShadow:
      "0 0 0 1px rgba(180,0,255,0.14), 0 32px 64px rgba(0,0,0,0.55), 0 0 80px rgba(180,0,255,0.08)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    overflow: "hidden",
    animation: "ts-modalPanelIn 220ms cubic-bezier(0.22,1,0.36,1) forwards",
    // size variants applied via maxWidth below
  },
  // Purple sweep behind the panel (matches profileHeader::before pattern)
  panelGlow: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(135deg, rgba(180,0,255,0.08) 0%, transparent 55%)",
    pointerEvents: "none",
    borderRadius: "20px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "18px 20px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: "17px",
    fontWeight: 950,
    letterSpacing: "0.1px",
    color: "var(--text, rgba(255,255,255,0.92))",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  closeBtn: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    padding: 0,
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "var(--muted, rgba(255,255,255,0.65))",
    cursor: "pointer",
    transition: "border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
    lineHeight: 1,
  },
  body: {
    padding: "20px",
    flex: "1 1 auto",
    overflowY: "auto",
    color: "var(--text, rgba(255,255,255,0.92))",
    fontSize: "15px",
    lineHeight: 1.6,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "14px 20px 18px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
  },
};

const SIZE_MAX_WIDTH = {
  sm: "400px",
  md: "540px",
  lg: "720px",
};

// ─── Keyframe injection (once per page) ──────────────────────────────────────

let keyframesInjected = false;

function injectKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ts-modalOverlayIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes ts-modalPanelIn {
      from { opacity: 0; transform: scale(0.95) translateY(8px); }
      to   { opacity: 1; transform: scale(1)    translateY(0);   }
    }
    @keyframes ts-modalPanelOut {
      from { opacity: 1; transform: scale(1)    translateY(0);   }
      to   { opacity: 0; transform: scale(0.95) translateY(8px); }
    }
    .ts-modalCloseBtn:hover:not(:disabled) {
      border-color: rgba(180,0,255,0.32) !important;
      background:   rgba(180,0,255,0.12) !important;
      color: var(--text, rgba(255,255,255,0.92)) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 0 0 2px rgba(180,0,255,0.10) !important;
    }
    /* Light mode overrides */
    :root[data-theme="light"] .ts-modal__panel {
      background: rgba(255,255,255,0.82) !important;
      border-color: rgba(20,20,40,0.10) !important;
      box-shadow: 0 0 0 1px rgba(180,0,255,0.10),
                  0 32px 64px rgba(0,0,0,0.18),
                  0 0 60px rgba(180,0,255,0.05) !important;
    }
    :root[data-theme="light"] .ts-modal__header,
    :root[data-theme="light"] .ts-modal__footer {
      border-color: rgba(20,20,40,0.08) !important;
    }
    :root[data-theme="light"] .ts-modalCloseBtn {
      border-color: rgba(20,20,40,0.12) !important;
      background: rgba(20,20,40,0.04) !important;
      color: rgba(20,20,40,0.62) !important;
    }
    :root[data-theme="light"] .ts-modal__overlay {
      background: rgba(240,238,255,0.55) !important;
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal
 *
 * @param {object}        props
 * @param {boolean}       props.open            — controlled open state
 * @param {function}      props.onClose         — called when modal should close
 * @param {string}        [props.title]         — header title text
 * @param {"sm"|"md"|"lg"} [props.size="md"]    — panel max-width
 * @param {boolean}       [props.closeOnBackdrop=true]
 * @param {boolean}       [props.closeOnEsc=true]
 * @param {React.ReactNode} [props.footer]      — footer slot; pass null to hide
 * @param {React.ReactNode} props.children      — body content
 */
export default function Modal({
  open,
  onClose,
  title = "Modal",
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true,
  footer,
  children,
}) {
  injectKeyframes();

  const panelRef = useRef(null);
  const lastFocusedRef = useRef(null);

  // ── Esc key ──
  const handleKeyDown = useCallback(
    (e) => {
      if (!closeOnEsc) return;
      if (e.key === "Escape") onClose?.();
    },
    [closeOnEsc, onClose]
  );

  // ── Focus management + keydown listener ──
  useEffect(() => {
    if (!open) return;

    lastFocusedRef.current = document.activeElement;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    // Focus panel for accessibility
    requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      lastFocusedRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const maxWidth = SIZE_MAX_WIDTH[size] ?? SIZE_MAX_WIDTH.md;

  const handleOverlayClick = (e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div
      className="ts-modal__overlay"
      style={S.overlay}
      onClick={handleOverlayClick}
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className="ts-modal__panel"
        style={{ ...S.panel, maxWidth }}
        tabIndex={-1}
      >
        {/* Purple atmospheric glow */}
        <div style={S.panelGlow} aria-hidden="true" />

        {/* ── Header ── */}
        <div className="ts-modal__header" style={S.header}>
          <h2 style={S.title}>{title}</h2>
          <button
            type="button"
            className="ts-modalCloseBtn"
            style={S.closeBtn}
            onClick={onClose}
            aria-label="Close modal"
          >
            <CloseIcon />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="ts-modal__body" style={S.body}>
          {children}
        </div>

        {/* ── Footer (optional) ── */}
        {footer !== null && footer !== undefined && (
          <div className="ts-modal__footer" style={S.footer}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Close icon SVG ───────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1 1l12 12M13 1L1 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}