// src/pages/admin.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Internal-only observability dashboard. Part 1, Phase 2 of
// docs/observability-and-code-audit-plan.md.
//
// Gated on the internal_admins table via the is_internal_admin() RPC. For
// non-internal users it renders a plain 404-equivalent — no "access denied",
// which would just confirm the route exists.
//
// Every number on this page comes from a SECURITY DEFINER RPC that returns
// pre-aggregated rows only (see supabase/telemetry_admin.sql). The browser
// never pulls raw cross-program data. These three panels need zero new
// instrumentation — they are queries over the existing tables.
//
// Dependency-free by design: sparklines and bars are inline SVG/CSS so no
// charting library ships here (and the open Recharts-vs-Chart.js decision
// stays open). The route is lazy-loaded in router.tsx so nothing here reaches
// coaches' bundles.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

// ── Types mirroring the RPC payloads ────────────────────────────────────────
type SparkPoint = { day: string; count: number };

type Pulse = {
  programs_total: number;
  programs_active_7d: number;
  coaches_total: number;
  athletes_total: number;
  devices_total: number;
  sessions_today: number;
  sessions_7d: number;
  sessions_prev_7d: number;
  sessions_30d: number;
  sessions_spark: SparkPoint[];
};

type UploadHealth = {
  sessions_total: number;
  missing_summary: number;
  missing_events: number;
  events_but_no_cells: number;
  complete: number;
  sessions_last_7d: number;
  partial_last_7d: number;
};

type TelemetryPulse = {
  events_today: number;
  events_24h: number;
  errors_24h: number;
  active_clients_24h: number;
  by_name: { name: string; count: number; error_count: number }[];
  recent: { ts: string; name: string; ok: boolean | null; error_code: string | null; route: string | null; platform: string | null }[];
};

type ProgramRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  max_athletes: number | null;
  max_devices: number | null;
  max_sessions_per_month: number | null;
  coaches: number;
  athletes: number;
  devices: number;
  sessions_7d: number;
  sessions_30d: number;
  sessions_this_month: number;
  last_activity: string | null;
};

type Gate = "checking" | "denied" | "allowed";

// Subscription tiers, in order. `value` is what programs.plan stores (see
// supabase/admin_set_program_plan.sql); `label` is what admins see.
const PLAN_OPTIONS: { value: string; label: string; note: string }[] = [
  { value: "trial", label: "Trial", note: "Evaluation" },
  { value: "I", label: "Tier I", note: "Foundation" },
  { value: "II", label: "Tier II", note: "Analysis" },
  { value: "III", label: "Tier III", note: "Intelligence" },
];
const PLAN_LABEL: Record<string, string> = PLAN_OPTIONS.reduce(
  (acc, o) => ((acc[o.value] = o.label), acc),
  {} as Record<string, string>
);
function planLabel(plan: string): string {
  return PLAN_LABEL[plan] ?? plan;
}

// ── Small presentational helpers ────────────────────────────────────────────
const muted = "var(--muted)";
const border = "var(--panel-border)";

function pctDelta(cur: number, prev: number): { label: string; up: boolean } | null {
  if (prev === 0) return cur === 0 ? null : { label: "new", up: true };
  const d = ((cur - prev) / prev) * 100;
  return { label: `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`, up: d >= 0 };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysAgo(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "never";
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const mo = Math.floor(days / 30);
  return mo === 1 ? "1 month ago" : `${mo} months ago`;
}

// Inline SVG sparkline — no dependency.
function Sparkline({ points, width = 120, height = 32 }: { points: number[]; width?: number; height?: number }) {
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(height - (v / max) * (height - 2) - 1).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.length > 0 && (
        <circle cx={(width).toFixed(1)} cy={(height - (last / max) * (height - 2) - 1).toFixed(1)} r={2.5} fill="var(--accent)" />
      )}
    </svg>
  );
}

function StatTile({
  label,
  value,
  sub,
  delta,
  spark,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: { label: string; up: boolean } | null;
  spark?: number[];
}) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 150,
        background: "var(--panel)",
        border: `1px solid ${border}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 12, color: muted, letterSpacing: "0.02em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{value}</span>
        {delta && (
          <span style={{ fontSize: 12, fontWeight: 700, color: delta.up ? "#3fca7a" : "#ff6b6b" }}>{delta.label}</span>
        )}
      </div>
      {sub && <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{sub}</div>}
      {spark && spark.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <Sparkline points={spark} />
        </div>
      )}
    </div>
  );
}

// Horizontal stacked bar for the upload-health breakdown.
function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}` }}>
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ fontSize: 12, color: muted, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
            {s.label} <strong style={{ color: "var(--text)" }}>{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function Badge({ text, tone }: { text: string; tone: "ok" | "warn" | "bad" | "neutral" }) {
  const map = {
    ok: { bg: "rgba(63,202,122,0.15)", fg: "#3fca7a" },
    warn: { bg: "rgba(255,180,0,0.15)", fg: "#ffb400" },
    bad: { bg: "rgba(255,107,107,0.15)", fg: "#ff6b6b" },
    neutral: { bg: "var(--btn-bg)", fg: muted },
  }[tone];
  return (
    <span style={{ background: map.bg, color: map.fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function PanelTitle({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)" }}>{String(n).padStart(2, "0")}</span>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>{title}</h2>
      </div>
      {note && <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Admin() {
  const [gate, setGate] = useState<Gate>("checking");
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [upload, setUpload] = useState<UploadHealth | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [tele, setTele] = useState<TelemetryPulse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  // Staged tier change awaiting explicit confirmation (see confirm modal).
  const [pendingPlan, setPendingPlan] = useState<{ program: ProgramRow; next: string } | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);

  async function applyPlanChange() {
    if (!pendingPlan || !supabase) return;
    setSavingPlan(true);
    setPlanErr(null);
    const { program, next } = pendingPlan;
    const { data, error } = await supabase.rpc("admin_set_program_plan", {
      p_program_id: program.id,
      p_new_plan: next,
    });
    if (error) {
      setPlanErr(error.message || "Failed to change tier.");
      setSavingPlan(false);
      return;
    }
    // Optimistically reflect the confirmed change in the table.
    const confirmed = (data as { new_plan?: string } | null)?.new_plan ?? next;
    setPrograms((rows) => rows.map((r) => (r.id === program.id ? { ...r, plan: confirmed } : r)));
    setSavingPlan(false);
    setPendingPlan(null);
  }

  async function loadAll() {
    if (!supabase) return;
    setErr(null);
    const [p, u, pr, t] = await Promise.all([
      supabase.rpc("admin_platform_pulse"),
      supabase.rpc("admin_upload_health"),
      supabase.rpc("admin_program_health"),
      supabase.rpc("admin_telemetry_pulse"),
    ]);
    if (p.error || u.error || pr.error) {
      setErr(p.error?.message || u.error?.message || pr.error?.message || "Failed to load metrics.");
      return;
    }
    setPulse(p.data as Pulse);
    setUpload(u.data as UploadHealth);
    setPrograms((pr.data as ProgramRow[]) || []);
    // Telemetry is best-effort — if the events RPC/table isn't there yet, the
    // rest of the page still renders.
    setTele(t.error ? null : (t.data as TelemetryPulse));
    setLoadedAt(new Date());
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!supabase) {
          if (alive) setGate("denied");
          return;
        }
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          if (alive) setGate("denied");
          return;
        }
        const { data: isAdmin, error } = await supabase.rpc("is_internal_admin");
        if (error || !isAdmin) {
          if (alive) setGate("denied");
          return;
        }
        if (!alive) return;
        setGate("allowed");
        await loadAll();
      } catch {
        if (alive) setGate("denied");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const spark = useMemo(() => (pulse?.sessions_spark || []).map((d) => d.count), [pulse]);

  // Client-side sortable program table (plan §1.6, Panel 7).
  const [sort, setSort] = useState<{ key: keyof ProgramRow; dir: "asc" | "desc" }>({
    key: "last_activity",
    dir: "desc",
  });

  const sortedPrograms = useMemo(() => {
    const rows = [...programs];
    const { key, dir } = sort;
    const mult = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Nulls always sort last, regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (key === "last_activity" || key === "trial_ends_at") {
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * mult;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
    return rows;
  }, [programs, sort]);

  function toggleSort(key: keyof ProgramRow) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  // 404-equivalent — no confirmation that the route exists.
  if (gate !== "allowed") {
    if (gate === "checking") return null;
    return (
      <div style={{ padding: "80px 16px", textAlign: "center", color: muted }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>404 — Page not found</h1>
        <p>The page you’re looking for doesn’t exist.</p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 950, letterSpacing: "-0.01em" }}>Platform Health</h1>
          <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>Internal · usage, reliability &amp; capacity</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {loadedAt && <span style={{ fontSize: 12, color: muted }}>Updated {loadedAt.toLocaleTimeString()}</span>}
          <button className="btnSecondary" onClick={() => loadAll()} style={{ padding: "8px 14px" }}>
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "rgba(255,107,107,0.4)", color: "#ff6b6b" }}>
          {err}
        </div>
      )}

      {/* ── Panel 1 — Platform pulse ─────────────────────────────────────── */}
      <div className="card">
        <PanelTitle n={1} title="Platform pulse" note="Last 14 days of activity. Telemetry-derived tiles (errors, outbox depth) arrive with Phase 3." />
        {pulse ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile
              label="Sessions today"
              value={pulse.sessions_today}
              sub={`${pulse.sessions_7d} in last 7d`}
              spark={spark}
            />
            <StatTile
              label="Sessions (7d)"
              value={pulse.sessions_7d}
              delta={pctDelta(pulse.sessions_7d, pulse.sessions_prev_7d)}
              sub={`${pulse.sessions_30d} in last 30d`}
            />
            <StatTile label="Active programs (7d)" value={pulse.programs_active_7d} sub={`of ${pulse.programs_total} total`} />
            {tele && (
              <StatTile
                label="Events today"
                value={tele.events_today}
                sub={`${tele.active_clients_24h} active client${tele.active_clients_24h === 1 ? "" : "s"} (24h)`}
              />
            )}
            {tele && (
              <StatTile
                label="Errors (24h)"
                value={tele.errors_24h}
                delta={tele.errors_24h > 0 ? { label: "investigate", up: false } : { label: "none", up: true }}
              />
            )}
            <StatTile label="Athletes" value={pulse.athletes_total} />
            <StatTile label="Coaches" value={pulse.coaches_total} />
            <StatTile label="Devices" value={pulse.devices_total} />
          </div>
        ) : (
          <div style={{ color: muted }}>Loading…</div>
        )}
      </div>

      {/* ── Panel 4 — Upload health ──────────────────────────────────────── */}
      <div className="card">
        <PanelTitle
          n={4}
          title="Upload health"
          note="A session is a partial write if its downstream inserts didn’t all land (finding A). Computed live over existing tables — no instrumentation."
        />
        {upload ? (
          (() => {
            const partial = upload.missing_summary + Math.max(0, upload.missing_events - 0) + upload.events_but_no_cells;
            const healthPct = upload.sessions_total > 0 ? (upload.complete / upload.sessions_total) * 100 : 100;
            return (
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 260px" }}>
                  <StatTile
                    label="Complete sessions"
                    value={`${healthPct.toFixed(1)}%`}
                    sub={`${upload.complete} of ${upload.sessions_total} fully written`}
                    delta={partial > 0 ? { label: `${partial} partial`, up: false } : { label: "all clean", up: true }}
                  />
                </div>
                <div style={{ flex: "2 1 380px", minWidth: 300 }}>
                  <StackBar
                    segments={[
                      { label: "Complete", value: upload.complete, color: "#3fca7a" },
                      { label: "No summary", value: upload.missing_summary, color: "#ffb400" },
                      { label: "No events", value: upload.missing_events, color: "#ff8a3d" },
                      { label: "Events, no cells", value: upload.events_but_no_cells, color: "#ff6b6b" },
                    ]}
                  />
                  <div style={{ fontSize: 12, color: muted, marginTop: 12 }}>
                    Last 7 days: <strong style={{ color: "var(--text)" }}>{upload.partial_last_7d}</strong> partial of{" "}
                    <strong style={{ color: "var(--text)" }}>{upload.sessions_last_7d}</strong> sessions.
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <div style={{ color: muted }}>Loading…</div>
        )}
      </div>

      {/* ── Panel 7 — Program health ─────────────────────────────────────── */}
      <div className="card">
        <PanelTitle n={7} title="Program health" note="Per-program churn-risk &amp; support-triage view. Flags programs near their plan limits." />
        {programs.length === 0 ? (
          <div style={{ color: muted }}>No programs yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
              <thead>
                <tr style={{ textAlign: "left", color: muted, borderBottom: `1px solid ${border}` }}>
                  {([
                    ["Program", "name"],
                    ["Plan", "plan"],
                    ["Status", "status"],
                    ["Trial end", "trial_ends_at"],
                    ["Coaches", "coaches"],
                    ["Athletes", "athletes"],
                    ["Devices", "devices"],
                    ["Sessions 7d / 30d", "sessions_7d"],
                    ["This month", "sessions_this_month"],
                    ["Last activity", "last_activity"],
                  ] as [string, keyof ProgramRow][]).map(([label, key]) => {
                    const active = sort.key === key;
                    return (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        title="Sort"
                        style={{
                          padding: "8px 10px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                          userSelect: "none",
                          color: active ? "var(--text)" : muted,
                        }}
                      >
                        {label} <span style={{ opacity: active ? 1 : 0.25 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedPrograms.map((p) => {
                  const nearAthletes = p.max_athletes != null && p.athletes >= p.max_athletes * 0.8;
                  const nearDevices = p.max_devices != null && p.devices >= p.max_devices * 0.8;
                  const nearSessions =
                    p.max_sessions_per_month != null && p.sessions_this_month >= p.max_sessions_per_month * 0.8;
                  const statusTone = p.status === "active" ? "ok" : p.status === "suspended" ? "bad" : "warn";
                  const trialSoon =
                    p.trial_ends_at != null &&
                    new Date(p.trial_ends_at).getTime() - Date.now() < 14 * 86_400_000 &&
                    new Date(p.trial_ends_at).getTime() - Date.now() > 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${border}` }}>
                      <td style={{ padding: "10px", fontWeight: 700 }}>{p.name}</td>
                      <td style={{ padding: "10px" }}>
                        <select
                          value={p.plan}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next !== p.plan) setPendingPlan({ program: p, next });
                          }}
                          title="Change subscription tier"
                          style={{
                            appearance: "none",
                            background: "var(--btn-bg)",
                            color: "var(--text)",
                            border: `1px solid ${border}`,
                            borderRadius: 8,
                            padding: "4px 24px 4px 8px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            backgroundImage:
                              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M1 3l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/></svg>\")",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 8px center",
                          }}
                        >
                          {PLAN_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "10px" }}>
                        <Badge text={p.status} tone={statusTone as any} />
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap", color: muted }}>
                        {fmtDate(p.trial_ends_at)} {trialSoon && <Badge text="soon" tone="warn" />}
                      </td>
                      <td style={{ padding: "10px" }}>{p.coaches}</td>
                      <td style={{ padding: "10px" }}>
                        {p.athletes}
                        {p.max_athletes != null && <span style={{ color: muted }}>/{p.max_athletes}</span>}{" "}
                        {nearAthletes && <Badge text="near" tone="warn" />}
                      </td>
                      <td style={{ padding: "10px" }}>
                        {p.devices}
                        {p.max_devices != null && <span style={{ color: muted }}>/{p.max_devices}</span>}{" "}
                        {nearDevices && <Badge text="near" tone="warn" />}
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                        {p.sessions_7d} <span style={{ color: muted }}>/ {p.sessions_30d}</span>
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                        {p.sessions_this_month}
                        {p.max_sessions_per_month != null && <span style={{ color: muted }}>/{p.max_sessions_per_month}</span>}{" "}
                        {nearSessions && <Badge text="near" tone="warn" />}
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap", color: muted }} title={fmtDate(p.last_activity)}>
                        {daysAgo(p.last_activity)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Telemetry (24h) — live app_events feed ───────────────────────── */}
      <div className="card">
        <PanelTitle
          n={8}
          title="Telemetry (24h)"
          note="Live from app_events. As Phase 3 instrumentation lands, more event types appear here automatically."
        />
        {!tele ? (
          <div style={{ color: muted }}>
            No telemetry yet — run <code>supabase/telemetry_events.sql</code>, or no events in the last 24h.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
            {/* By event name */}
            <div style={{ flex: "1 1 300px", minWidth: 260 }}>
              <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>By event ({tele.events_24h} in 24h)</div>
              {tele.by_name.length === 0 ? (
                <div style={{ color: muted }}>—</div>
              ) : (
                (() => {
                  const max = Math.max(...tele.by_name.map((b) => b.count), 1);
                  return tele.by_name.map((b) => (
                    <div key={b.name} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.name}</span>
                        <span style={{ color: muted }}>
                          {b.count}
                          {b.error_count > 0 && <span style={{ color: "#ff6b6b" }}> · {b.error_count} err</span>}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: "var(--btn-bg)", overflow: "hidden" }}>
                        <div style={{ width: `${(b.count / max) * 100}%`, height: "100%", background: b.error_count > 0 ? "#ff8a3d" : "var(--accent)" }} />
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>

            {/* Recent feed */}
            <div style={{ flex: "1 1 340px", minWidth: 280 }}>
              <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>Most recent</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
                {tele.recent.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 8,
                      background: r.ok === false ? "rgba(255,107,107,0.08)" : "transparent",
                    }}
                  >
                    <span style={{ color: muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {new Date(r.ts).toLocaleTimeString()}
                    </span>
                    <span style={{ fontFamily: "ui-monospace, monospace", flex: 1 }}>{r.name}</span>
                    {r.route && <span style={{ color: muted }}>{r.route}</span>}
                    {r.ok === false && <Badge text={r.error_code || "error"} tone="bad" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm tier change ──────────────────────────────────────────── */}
      {pendingPlan && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !savingPlan && (setPendingPlan(null), setPlanErr(null))}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              border: `1px solid ${border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 420,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>Change subscription tier?</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: muted, lineHeight: 1.5 }}>
              This changes the subscription tier for{" "}
              <strong style={{ color: "var(--text)" }}>{pendingPlan.program.name}</strong>. It affects which
              features the program can access. Limits (athletes, devices, sessions) are not changed automatically.
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "14px 12px",
                borderRadius: 12,
                background: "var(--btn-bg)",
                marginBottom: 16,
              }}
            >
              <Badge text={planLabel(pendingPlan.program.plan)} tone="neutral" />
              <span style={{ color: muted, fontSize: 18 }}>→</span>
              <Badge text={planLabel(pendingPlan.next)} tone="ok" />
            </div>
            {planErr && (
              <div style={{ fontSize: 13, color: "#ff6b6b", marginBottom: 12 }}>{planErr}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                className="btnSecondary"
                disabled={savingPlan}
                onClick={() => {
                  setPendingPlan(null);
                  setPlanErr(null);
                }}
                style={{ padding: "8px 16px" }}
              >
                Cancel
              </button>
              <button
                disabled={savingPlan}
                onClick={() => void applyPlanChange()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "#000",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: savingPlan ? "default" : "pointer",
                  opacity: savingPlan ? 0.6 : 1,
                }}
              >
                {savingPlan ? "Saving…" : `Confirm change to ${planLabel(pendingPlan.next)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: muted, textAlign: "center", marginTop: 20 }}>
        Panels 2/3/5/6 land in later phases (need capacity cron or a few weeks of data). See the build plan.
      </div>
    </div>
  );
}
