// src/lib/telemetryEvents.ts
// ─────────────────────────────────────────────────────────────────────────────
// Typed wrappers over track() for the §1.2 event taxonomy. Phase 3 of
// docs/observability-and-code-audit-plan.md.
//
// Why this exists: the session/BLE logic is triplicated across session.tsx,
// mobile/session.tsx and mobile/home.tsx (finding H). If each copy called
// track("...") with hand-written names and prop shapes, they'd drift. Routing
// every call site through these functions keeps names + prop keys identical
// across all three, and gives one place for the telemetry-PII audit (§2.4) to
// enforce that no athlete data leaks into props.
//
// Each function is a thin, non-throwing pass-through to track() (which already
// swallows errors). Keep names in sync with §1.2 and the optional whitelist in
// supabase/telemetry_events.sql.
// ─────────────────────────────────────────────────────────────────────────────
import { track } from "./telemetry";

type Platform = "web" | "ios";
type ConnectErrorClass = "cancel" | "gatt" | "adapter" | "timeout" | "unknown";
type UploadStage = "sessions" | "events" | "event_cells" | "session_summaries";
type StopReason = "user" | "auto_timeout" | "disconnect" | "error";

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authLoginSucceeded = () => track("auth.login_succeeded", { ok: true });
export const authLoginFailed = (error_code?: string) =>
  track("auth.login_failed", { ok: false, error_code });
export const authSignupSucceeded = () => track("auth.signup_succeeded", { ok: true });
export const authSignupFailed = (error_code?: string) =>
  track("auth.signup_failed", { ok: false, error_code });

// ── Onboarding ─────────────────────────────────────────────────────────────
export const onboardingStepCompleted = (step: string, path: string) =>
  track("onboarding.step_completed", { step, path });

// ── BLE ─────────────────────────────────────────────────────────────────────
export const bleConnectAttempted = (platform: Platform, slot: number) =>
  track("ble.connect_attempted", { platform, slot });

export const bleConnectSucceeded = (p: {
  duration_ms?: number;
  device_model?: string;
  fw_version?: string;
  attempt_n?: number;
  slot?: number;
}) =>
  track("ble.connect_succeeded", {
    ok: true,
    duration_ms: p.duration_ms,
    device_model: p.device_model,
    fw_version: p.fw_version,
    attempt_n: p.attempt_n,
    slot: p.slot,
  });

export const bleConnectFailed = (p: { error_class: ConnectErrorClass; attempt_n?: number; slot?: number }) =>
  track("ble.connect_failed", { ok: false, error_code: p.error_class, attempt_n: p.attempt_n, slot: p.slot });

export const bleDisconnected = (p: { during_session: boolean; session_elapsed_ms?: number; slot?: number }) =>
  track("ble.disconnected", {
    during_session: p.during_session,
    session_elapsed_ms: p.session_elapsed_ms,
    slot: p.slot,
  });

// ── Session lifecycle ────────────────────────────────────────────────────────
export const sessionStarted = (p: { mode: string; num_bags: number; session_id?: string }) =>
  track("session.started", { mode: p.mode, num_bags: p.num_bags, session_id: p.session_id });

export const sessionStopped = (p: {
  duration_ms?: number;
  event_count?: number;
  reason: StopReason;
  session_id?: string;
}) =>
  track("session.stopped", {
    duration_ms: p.duration_ms,
    event_count: p.event_count,
    reason: p.reason,
    session_id: p.session_id,
  });

export const sessionDiscarded = (p: { duration_ms?: number; session_id?: string }) =>
  track("session.discarded", { duration_ms: p.duration_ms, session_id: p.session_id });

// ── Session upload (the finding-A stage tracking) ────────────────────────────
export const sessionUploadStarted = (p: {
  session_id: string;
  event_count: number;
  cell_count?: number;
  raw_bytes?: number;
}) =>
  track("session.upload_started", {
    session_id: p.session_id,
    event_count: p.event_count,
    cell_count: p.cell_count,
    raw_bytes: p.raw_bytes,
  });

export const sessionUploadStageFailed = (p: {
  session_id: string;
  stage: UploadStage;
  error_code?: string;
  chunk_index?: number;
}) =>
  track("session.upload_stage_failed", {
    ok: false,
    session_id: p.session_id,
    stage: p.stage,
    error_code: p.error_code,
    chunk_index: p.chunk_index,
  });

export const sessionUploadSucceeded = (p: {
  session_id: string;
  total_ms?: number;
  raw_bytes?: number;
  event_count?: number;
  cell_count?: number;
}) =>
  track("session.upload_succeeded", {
    ok: true,
    session_id: p.session_id,
    duration_ms: p.total_ms,
    raw_bytes: p.raw_bytes,
    event_count: p.event_count,
    cell_count: p.cell_count,
  });

// ── Outbox (instrumented once in sessionOutbox.ts — covers all 3 pages) ──────
export const outboxEnqueued = (queue_depth: number) =>
  track("outbox.enqueued", { queue_depth });

export const outboxFlushSucceeded = (p: { attempt_n?: number; age_ms?: number; queue_depth: number }) =>
  track("outbox.flush_succeeded", { ok: true, attempt_n: p.attempt_n, age_ms: p.age_ms, queue_depth: p.queue_depth });

export const outboxFlushFailed = (p: { attempt_n?: number; age_ms?: number; queue_depth: number; error_code?: string }) =>
  track("outbox.flush_failed", { ok: false, attempt_n: p.attempt_n, age_ms: p.age_ms, queue_depth: p.queue_depth, error_code: p.error_code });
