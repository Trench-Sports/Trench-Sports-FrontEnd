// src/lib/errorReporting.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Global error capture. Part 1, Phase 1 of
// docs/observability-and-code-audit-plan.md (§1.5). Per the plan this is
// "arguably the highest value-per-line item in the whole plan" — today the app
// has no ErrorBoundary, no window.onerror, and no unhandledrejection handler,
// so every render crash is a silent white screen and every uncaught rejection
// vanishes.
//
//   • window 'error' + 'unhandledrejection'  → app.error telemetry
//   • <ErrorBoundary> around <RouterProvider> → reports + recovery UI, no
//     white screen on a render crash
//   • stack hashed for grouping; messages truncated and stripped of anything
//     that could carry athlete data (some athletes are minors — §1.4)
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { track } from "./telemetry";

const MAX_MSG = 300;

// Fast non-crypto hash (FNV-1a) → short base36 string, for grouping errors by
// stack in the admin error feed (Panel 8).
function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Strip data that could carry PII, then truncate. We can't fully guarantee a
// message is PII-free, so we (a) drop query strings and (b) hard-cap length.
function sanitizeMessage(msg: unknown): string {
  let s = typeof msg === "string" ? msg : String(msg ?? "");
  s = s.replace(/\?[^\s]*/g, ""); // strip query strings that may carry ids/PII
  return s.slice(0, MAX_MSG);
}

// Route without query/hash — the path can be low-cardinality-grouped, the query
// can't and may carry PII.
function currentRoute(): string {
  try {
    return window.location.pathname;
  } catch {
    return "unknown";
  }
}

function reportError(message: unknown, stack: string | undefined, source: string): void {
  const msg = sanitizeMessage(message);
  const stackForHash = (stack || msg).split("\n").slice(0, 6).join("\n");
  track("app.error", {
    message: msg,
    stack_hash: hashString(`${source}:${stackForHash}`),
    source,
    route: currentRoute(),
    ok: false,
  });
}

let installed = false;
/** Install global window error + unhandledrejection handlers (once). */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    reportError(e.message || e.error?.message, e.error?.stack, "window.error");
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: any = e.reason;
    reportError(reason?.message ?? reason, reason?.stack, "unhandledrejection");
  });
}

// ── React error boundary ─────────────────────────────────────────────────────
type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(
      error?.message,
      error?.stack || info?.componentStack || undefined,
      "react.boundary",
    );
  }

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      /* noop */
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "40px 16px",
          textAlign: "center",
          color: "var(--text, #eee)",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900 }}>Something went wrong</div>
        <div style={{ fontSize: 14, opacity: 0.75, maxWidth: 420 }}>
          The app hit an unexpected error. Your recorded session data is safe on this device.
          Reloading usually fixes it.
        </div>
        <button
          onClick={this.handleReload}
          style={{
            padding: "10px 20px",
            borderRadius: 12,
            border: "1px solid var(--accent, #b400ff)",
            background: "var(--accent, #b400ff)",
            color: "#000",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
