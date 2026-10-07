// src/hooks/useCoachDashboard.ts
//
// State, data fetching and derived values for the coach dashboard, shared by
// the desktop (src/pages/dashboard.tsx) and mobile (src/pages/mobile/dashboard.tsx)
// pages. Each page keeps only its own layout and platform-only behaviour
// (desktop: roster import / export modals, athlete-list scroll fade; mobile:
// swipe and pull-to-refresh gestures) and renders from what this returns.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Profile } from "../components/profileHeader";
import { supabase } from "../supabaseClient";
import { fetchSessionRows, fetchLeaderboardRowsByMode, fetchSessionRowsByTeam } from "../lib/sessionSummaries";
import { useEntitlements, useRetainedData } from "../lib/entitlements";


export type Insight = { title: string; body: string; tag: "Power" | "Accuracy" | "Tempo" | "Recovery" };

export type RecentSession = {
  id: string;
  timestamp: string;
  mode: string;
  athleteFirstName: string;
  athleteLastName: string;
  athleteId: string | null;
};

export type HeatmapCell = { r: number; c: number; intensity: number }; // intensity 0–1

// One event as fetched from the events table — groups all cells hit in that frame
export type ReplayCell  = { r: number; c: number; mv: number };
export type ReplayEvent = {
  eventId:    string;
  tMs:        number;          // offset from session start in ms (t_start_ms - t_zero)
  cells:      ReplayCell[];
  si:         number | null;   // strength_index.value
  cellCount:  number;          // temporal.cell_count
  impulse:    number | null;   // impulse_index
  durationMs: number | null;   // duration_ms
  riseMs:         number | null;   // rise_time_ms
  angleDeg:       number | null;   // angle_deg
  reactionTimeMs: number | null;   // reaction_time_ms (reaction + target modes)
  // ── Target mode ────────────────────────────────────────────────────────────
  targetZone:  { row: string; col: string } | null;  // accuracy.target_zone
  zoneHit:     { row: string; col: string } | null;  // accuracy.zone_hit
  zoneCorrect: boolean | null;                        // accuracy.zone_correct
  // ── Volume mode ────────────────────────────────────────────────────────────
  volWindowIdx: number | null;   // temporal.vol_window_idx
  volHitSeq:    number | null;   // temporal.vol_hit_seq
};

export type SessionSummaryData = {
  mode: string;
  num_events: number | null;
  session_duration_ms: number | null;
  peak_force_stats: any;
  impulse_stats: any;
  duration_ms_stats: any;
  angles_deg: any;
  most_contacted_cell_rc: any;
  center_of_mass_mm: any;
  cadence_hz_avg: number | null;
  iei_ms: any;
  quality: any;
};

export type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  height: string | null;
  weight: string | null;
  sport: string | null;
  position: string | null;
};

export type Team = {
  id: string;
  name: string;
  team_type: string;
  parent_team_id: string | null;
  created_by: string | null;
  program_id: string;
  member_count?: number;
};

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// Session rows now arrive from tiered_session_summaries() rather than from the
// table, and PostgREST cannot embed a related resource into a function result —
// so the athlete's name comes back as two flat columns instead of a nested
// `athletes` object. One helper keeps that shape change in a single place.
export function athleteNameOf(row: any, fallback = "Unknown Athlete"): string {
  const name = [row?.athlete_first_name, row?.athlete_last_name].filter(Boolean).join(" ").trim();
  return name || fallback;
}


export type TabKey = "recent" | "insights" | "athletes";
export type MetricKey = "strength" | "reaction" | "accuracy" | "form" | "volume" | "target";

export type LeaderRow =
  | {
      name: string;
      athleteId: string;
      metric: "strength";
      peakIndex: number;  // 0–1000, best single-event strength index
      avgIndex: number;   // 0–1000, mean strength index across all events
      sessions: number;
    }
  | {
      name: string;
      athleteId: string;
      metric: "reaction";
      avgReactionMs: number; // ms (lower is better)
      bestReactionMs: number; // ms
      attempts: number;
    }
  | {
      name: string;
      athleteId: string;
      metric: "accuracy";
      accuracyPct: number; // %
      avgOffsetCm: number; // cm (lower is better)
      sessions: number;
    };


// ---------- Athlete progress badges ----------
export type AthleteProgress = {
  trend:   "up" | "stable" | "down";
  delta:   number;
  metric:  "strength" | "accuracy" | "reaction" | "targetAccuracy" | "targetReaction";
  unit:    string;
  sessions: number;
};

// ---------- Per-mode analytics (powering the mode pills) ----------
// Each sub-key only appears when the athlete has > 5 sessions of that mode.
export type ModeTrend = "up" | "stable" | "down";
export type AthleteModeStats = {
  power?:    { sessions: number; avgIndex: number; peakIndex: number; trend: ModeTrend; delta: number };
  reaction?: { sessions: number; avgMs:    number; bestMs:    number; trend: ModeTrend; delta: number };
  accuracy?: { sessions: number; avgPct:   number;                    trend: ModeTrend; delta: number };
  volume?:   { sessions: number; maxEvents: number; avgEvents: number };
  target?:   { sessions: number; avgPct:   number;                    trend: ModeTrend; delta: number };
};

export type SummaryStatItem = { label: string; value: string; accent?: boolean };

// ---------- Leaderboard ----------
export type LeaderDateRange = 7 | 30 | 90 | "all";

// ---------- Volume leaderboard (insights only) ----------
export type VolumeInsightRow = {
  athleteId: string;
  name: string;
  avgWindowHits: number;
  bestWindowHits: number;
  avgSiFatigueSlope: number | null;
  avgSi: number | null;
  sessions: number;
  numEvents: number;
};

// ---------- Target leaderboard (insights only) ----------
export type TargetInsightRow = {
  athleteId: string;
  name: string;
  avgAccuracyPct: number;
  avgReactionMsCorrect: number | null;
  attempts: number;
  sessions: number;
};

// ---------- Team Leaderboards ----------
export type TeamLeaderRow = {
  teamId: string;
  name: string;
  teamType: "core" | "sub";
  memberCount: number;
  sessionCount: number;
  // strength
  peakIndex?: number;
  avgIndex?: number;
  // accuracy
  accuracyPct?: number;
  avgOffsetMm?: number;
  // reaction
  avgReactionMs?: number;
  bestReactionMs?: number;
  // volume
  totalHits?: number;
  avgSi?: number;
  // target
  targetAccuracyPct?: number;
  avgReactionMsCorrect?: number;
};

// Most Improved per team — first 50% of sessions vs last 50%
export type TeamImprovedRow = { teamId: string; name: string; teamType: "core"|"sub"; delta: number; from: number; to: number; sessions: number };

// ---------- Coaching Insights (data-driven) ----------
export type CoachInsight = {
  tag: "Power" | "Accuracy" | "Reaction" | "Consistency" | "Fatigue" | "Tempo" | "Volume" | "Target";
  priority: "high" | "medium" | "low";
  headline: string;
  numbers: { label: string; value: string; delta?: string; deltaDir?: "up" | "down" | "neutral" }[];
  cue: string;
};

// ---------- In-Depth Athlete Analysis ----------
export type AthleteSessionRow = {
  session_id: string;
  date_of_record: string;
  mode: string;
  num_events: number | null;
  session_duration_ms: number | null;
  cadence_hz_avg: number | null;
  peak_force_stats: any;
  quality: any;
  angles_deg: any;
  iei_ms: any;
};

// Most Improved Athletes — derived from per-athlete session histories
export type AthleteImprovedRow = { athleteId: string; name: string; metric: MetricKey; delta: number; from: number; to: number; sessions: number };

// ─────────────────────────────────────────────────────────────────────────
// Charts & Graphs
// ─────────────────────────────────────────────────────────────────────────
export type ChartMetric = "strength" | "accuracy" | "reaction" | "volume";
export type CompareMode = "athlete-athlete" | "athlete-team" | "team-team";
export type EntityKind  = "athlete" | "team";
export type ChartEntity = { kind: EntityKind; id: string; label: string };

// Per-week data point
export type WeekPoint = { week: string; value: number | null }; // week = "YYYY-WW"
export type CoachDashboardOptions = {
  // Bumped by mobile pull-to-refresh to re-run the session reads. Desktop omits it.
  refreshKey?: number;
  // Leaderboard date ranges offered for a tier history window (null = unlimited),
  // in display order. Must be a stable reference (define it at module scope).
  leaderRangesFor: (historyDays: number | null) => LeaderDateRange[];
  leaderRangeDefault: LeaderDateRange;
};

export function useCoachDashboard(options: CoachDashboardOptions) {
  const refreshKey = options.refreshKey ?? 0;

  const navigate = useNavigate();

  // ---------- entitlements ----------
  // Decides which panels render and which render locked. NOT the security
  // boundary — supabase/entitlements.sql withholds the underlying rows, so a
  // program that forged a higher tier here would unlock empty panels.
  // Components ask capability questions (ent.can("fatigueTracker")), never
  // `plan === "II"` — see the hard rule in src/lib/entitlements.ts.
  const ent = useEntitlements();
  // Real counts of the program's own retained-but-locked training data.
  // Capture is tier-blind and nothing is ever pruned, so this is what an
  // upgrade would reveal — see RetainedDataNotice.
  const retained = useRetainedData();

  // ---------- tabs ----------
  const [activeTab, setActiveTab] = useState<TabKey>("recent");
  const [showCreateAthlete, setShowCreateAthlete] = useState(false);
  const [editAthleteTarget, setEditAthleteTarget] = useState<Athlete | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showProgram, setShowProgram] = useState(false);

  // ---------- profile ----------
  const [profile, setProfile] = useState<Profile | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [coreTeamId, setCoreTeamId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    async function fetchProfile() {
      const { data: userData } = await supabase!.auth.getUser();
      const user = userData?.user;
      if (!user) return;

      // Single round-trip: join programs table to get the program name
      const { data, error } = await supabase!
        .from("profiles")
        .select("first_name, last_name, role, city, state, program_id, programs(name)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !data) return;

      const role: string = data.role ?? "";
      const pid: string | null = (data as any).program_id ?? null;

      // For coaches, find their core team so we can scope session queries.
      // Uses a SECURITY DEFINER RPC to bypass RLS on team_members (coach isn't
      // yet scoped to a program at the time this runs, so direct queries are blocked).
      let coachCoreTeamId: string | null = null;
      if (role === "coach") {
        const { data: coreTeamRow, error: coreTeamErr } = await supabase!
          .rpc("get_coach_core_team", { p_user_id: user.id });
        if (coreTeamErr) {
          console.error("[dashboard] get_coach_core_team failed:", coreTeamErr.message);
        }
        coachCoreTeamId = coreTeamRow ?? null;
      }

      setProgramId(pid);
      setUserRole(role);
      setCoreTeamId(coachCoreTeamId);
      setCurrentUserId(user.id);
      setProfile({
        name: [data.first_name, data.last_name].filter(Boolean).join(" ") || "—",
        role: data.role ?? "",
        location: [data.city, data.state].filter(Boolean).join(", "),
        program: (data.programs as any)?.name ?? "",
      });
    }

    fetchProfile();
  }, []);

  // ---------- athletes ----------
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [athletesError, setAthletesError] = useState("");
  const [athleteFilter, setAthleteFilter] = useState("");

  useEffect(() => {
    if (activeTab !== "athletes" || !programId || !userRole || !supabase) return;

    async function fetchAthletes() {
      setAthletesLoading(true);
      setAthletesError("");
      try {
        let query = supabase!
          .from("athletes")
          .select("id, first_name, last_name, height, weight, sport, position")
          .eq("program_id", programId!)
          .order("last_name");

        // Coaches only see athletes on their core team (matched by both program_id
        // and core_team_id via the athletes.core_team_id FK)
        if (userRole === "coach" && coreTeamId) {
          query = query.eq("core_team_id", coreTeamId);
        }

        const { data, error } = await query;
        if (error) throw error;
        setAthletes(data ?? []);
      } catch (err: any) {
        setAthletesError(err.message ?? "Failed to load athletes.");
      } finally {
        setAthletesLoading(false);
      }
    }

    fetchAthletes();
  }, [activeTab, programId, userRole, coreTeamId, refreshKey]);
  const [athleteProgressMap, setAthleteProgressMap] = useState<Map<string, AthleteProgress>>(new Map());
  const [athleteProgressLoading, setAthleteProgressLoading] = useState(false);
  const [athleteModeStatsMap, setAthleteModeStatsMap] = useState<Map<string, AthleteModeStats>>(new Map());

  useEffect(() => {
    if (activeTab !== "athletes" || !programId || !userRole || !supabase) return;

    setAthleteProgressLoading(true);

    (async () => {
      try {
        // Fetch all sessions across all modes in one round-trip.
        // num_events powers the volume pill (max hits in a single session).
        // Reads go through tiered_session_rows() (list-view columns of
        // tiered_session_summaries(), arrays stripped) instead of the table.
        // Program scope, coach core-team scope, the tier's entitled mode set
        // and its history window are all applied inside the function
        // (supabase/entitlements.sql §6a), and the gated columns are revoked
        // from the client outright — so none of the filters that used to live
        // here are load-bearing for access control any more.
        const { data: progressRows } = await fetchSessionRows();

        // The RPC orders newest-first; this aggregation wants oldest-first so
        // the early-vs-late trend split below reads in chronological order.
        const data = (progressRows ?? [])
          .filter((r: any) => r.athlete_id)
          .sort((a: any, b: any) =>
            String(a.date_of_record ?? "").localeCompare(String(b.date_of_record ?? "")));

        if (!data.length) return;

        // Group by athlete → mode → vals[]
        type ModeVals = {
          strength: number[];
          accuracy: number[];
          reaction: number[];
          targetAccuracy: number[];
          targetReaction: number[];
          volumeEvents: number[]; // per-session hit counts (volume mode pills)
        };
        const byAthlete = new Map<string, ModeVals>();

        for (const row of data as any[]) {
          const id   = row.athlete_id;
          const mode = (row.mode ?? "power").toLowerCase();
          if (!id) continue;

          if (!byAthlete.has(id)) byAthlete.set(id, { strength: [], accuracy: [], reaction: [], targetAccuracy: [], targetReaction: [], volumeEvents: [] });
          const entry = byAthlete.get(id)!;

          if (mode === "power") {
            const si = row.quality?.strength_index;
            let val: number | null = null;
            if (si?.max != null) val = Math.round(si.max);
            else {
              const pMv = row.peak_force_stats?.peak_mv ?? (row.peak_force_stats?.peak_v != null ? row.peak_force_stats.peak_v * 1000 : null);
              if (pMv != null) val = Math.round((pMv / 3320) * 1000);
            }
            if (val != null) entry.strength.push(val);
          } else if (mode === "accuracy") {
            const pct = row.quality?.accuracy_pct ?? row.quality?.score ?? null;
            if (pct != null) entry.accuracy.push(Math.round(Number(pct) * 10) / 10);
          } else if (mode === "reaction") {
            const rt = row.quality?.avg_reaction_ms ?? null;
            if (rt != null) entry.reaction.push(Math.round(rt));
          } else if (mode === "target") {
            const pct = row.quality?.target_accuracy_pct ?? null;
            if (pct != null) entry.targetAccuracy.push(Math.round(Number(pct) * 10) / 10);
            // avg_reaction_ms_correct is the meaningful benchmark; fall back to all-attempts avg
            const rt = row.quality?.avg_reaction_ms_correct ?? row.quality?.avg_reaction_ms_all ?? null;
            if (rt != null) entry.targetReaction.push(Math.round(rt));
          } else if (mode === "volume") {
            const events = row.num_events;
            if (typeof events === "number" && events > 0) entry.volumeEvents.push(events);
          }
        }

        // Compute progress per athlete — pick metric with most sessions (≥4)
        const progressMap = new Map<string, AthleteProgress>();

        for (const [athleteId, modes] of byAthlete) {
          // Pick the metric with the most sessions that has ≥4 data points
          const candidates = ([
            { metric: "strength",       vals: modes.strength,       unit: "pts", lowerIsBetter: false },
            { metric: "accuracy",       vals: modes.accuracy,       unit: "%",   lowerIsBetter: false },
            { metric: "reaction",       vals: modes.reaction,       unit: "ms",  lowerIsBetter: true  },
            { metric: "targetAccuracy", vals: modes.targetAccuracy, unit: "%",   lowerIsBetter: false },
            { metric: "targetReaction", vals: modes.targetReaction, unit: "ms",  lowerIsBetter: true  },
          ] as { metric: "strength" | "accuracy" | "reaction" | "targetAccuracy" | "targetReaction"; vals: number[]; unit: string; lowerIsBetter: boolean }[]).filter(c => c.vals.length >= 4).sort((a, b) => b.vals.length - a.vals.length);

          if (candidates.length === 0) continue;

          const { metric, vals, unit, lowerIsBetter } = candidates[0];
          const half  = Math.floor(vals.length / 2);
          const early = vals.slice(0, half).reduce((s, v) => s + v, 0) / half;
          const late  = vals.slice(-half).reduce((s, v)  => s + v, 0) / half;

          // Positive delta always means improvement regardless of metric direction
          const delta      = lowerIsBetter ? Math.round(early - late) : Math.round(late - early);
          const absDelta   = Math.abs(delta);

          // Threshold: >3% relative change = meaningful
          const threshold  = Math.max(1, Math.round(early * 0.03));
          const trend: AthleteProgress["trend"] = delta > threshold ? "up" : delta < -threshold ? "down" : "stable";

          progressMap.set(athleteId, { trend, delta, metric, unit, sessions: vals.length });
        }

        setAthleteProgressMap(progressMap);

        // ── Per-mode pill stats ─────────────────────────────────────────────
        // For each mode the athlete has *more than 5* sessions of, compute the
        // headline metric the pill will surface (and a directional trend
        // where it makes sense).
        const trendOf = (vals: number[], lowerIsBetter: boolean): { trend: ModeTrend; delta: number } => {
          if (vals.length < 2) return { trend: "stable", delta: 0 };
          const half  = Math.max(1, Math.floor(vals.length / 2));
          const early = vals.slice(0, half).reduce((s, v) => s + v, 0) / half;
          const late  = vals.slice(-half).reduce((s, v) => s + v, 0) / half;
          // Positive delta always means improvement, regardless of metric direction.
          const delta     = lowerIsBetter ? Math.round(early - late) : Math.round(late - early);
          const threshold = Math.max(1, Math.round(Math.abs(early) * 0.03));
          const trend: ModeTrend = delta > threshold ? "up" : delta < -threshold ? "down" : "stable";
          return { trend, delta };
        };

        const modeStatsMap = new Map<string, AthleteModeStats>();
        for (const [athleteId, modes] of byAthlete) {
          const stats: AthleteModeStats = {};

          if (modes.strength.length > 5) {
            const peak = Math.max(...modes.strength);
            const avg  = Math.round(modes.strength.reduce((s, v) => s + v, 0) / modes.strength.length);
            const { trend, delta } = trendOf(modes.strength, false);
            stats.power = { sessions: modes.strength.length, avgIndex: avg, peakIndex: peak, trend, delta };
          }

          if (modes.reaction.length > 5) {
            const avg  = Math.round(modes.reaction.reduce((s, v) => s + v, 0) / modes.reaction.length);
            const best = Math.round(Math.min(...modes.reaction));
            const { trend, delta } = trendOf(modes.reaction, true);
            stats.reaction = { sessions: modes.reaction.length, avgMs: avg, bestMs: best, trend, delta };
          }

          if (modes.accuracy.length > 5) {
            const avg = Math.round((modes.accuracy.reduce((s, v) => s + v, 0) / modes.accuracy.length) * 10) / 10;
            const { trend, delta } = trendOf(modes.accuracy, false);
            stats.accuracy = { sessions: modes.accuracy.length, avgPct: avg, trend, delta };
          }

          if (modes.volumeEvents.length > 5) {
            const max = Math.max(...modes.volumeEvents);
            const avg = Math.round(modes.volumeEvents.reduce((s, v) => s + v, 0) / modes.volumeEvents.length);
            stats.volume = { sessions: modes.volumeEvents.length, maxEvents: max, avgEvents: avg };
          }

          if (modes.targetAccuracy.length > 5) {
            const avg = Math.round((modes.targetAccuracy.reduce((s, v) => s + v, 0) / modes.targetAccuracy.length) * 10) / 10;
            const { trend, delta } = trendOf(modes.targetAccuracy, false);
            stats.target = { sessions: modes.targetAccuracy.length, avgPct: avg, trend, delta };
          }

          if (Object.keys(stats).length > 0) modeStatsMap.set(athleteId, stats);
        }
        setAthleteModeStatsMap(modeStatsMap);
      } finally {
        setAthleteProgressLoading(false);
      }
    })();
  }, [activeTab, programId, userRole, coreTeamId]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState("");

  useEffect(() => {
    if (activeTab !== "athletes" || !programId || !profile?.role || !userRole || !supabase) return;

    async function fetchTeams() {
      setTeamsLoading(true);
      setTeamsError("");
      try {
        let query = supabase!
          .from("teams")
          .select("id, name, team_type, parent_team_id, created_by, program_id, team_members(athlete_id)")
          .eq("program_id", programId!)
          .order("name");

        if (profile!.role === "coach") {
          // Coaches only see sub-teams parented under their own core team
          query = query.neq("team_type", "core");
          if (coreTeamId) {
            query = query.eq("parent_team_id", coreTeamId);
          }
        }

        const { data, error } = await query;
        if (error) throw error;
        const mapped = (data ?? []).map((t: any) => ({
          ...t,
          member_count: (t.team_members ?? []).filter((m: any) => m.athlete_id !== null).length,
          team_members: undefined,
        }));
        setTeams(mapped);
      } catch (err: any) {
        setTeamsError(err.message ?? "Failed to load teams.");
      } finally {
        setTeamsLoading(false);
      }
    }

    fetchTeams();
  }, [activeTab, programId, profile?.role, userRole, coreTeamId]);

  // ---------- lightweight "demo" state ----------
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const [hits, setHits] = useState(0);

  const [lastForce, setLastForce] = useState(0);
  const [lastSpeed, setLastSpeed] = useState(0);
  const [lastZone, setLastZone] = useState("—");

  const [series, setSeries] = useState<number[]>(() => Array.from({ length: 32 }, () => 0));

  // Simulated live feed (replace with your real data pipeline later)
  useEffect(() => {
    if (!connected || !listening) return;

    const t = setInterval(() => {
      const shouldHit = sessionActive && Math.random() < 0.28;
      if (!shouldHit) return;

      const f = clamp(18 + Math.random() * 20 + (Math.random() < 0.15 ? 12 : 0), 0, 65);
      const v = clamp(5.4 + Math.random() * 3.1 + (Math.random() < 0.15 ? 1.2 : 0), 0, 12);

      const col = 1 + Math.floor(Math.random() * 8);
      const row = 1 + Math.floor(Math.random() * 12);
      const zone = `C${col}-R${row}`;

      setHits((h) => h + 1);
      setLastForce(f);
      setLastSpeed(v);
      setLastZone(zone);

      setSeries((prev) => {
        const next = prev.slice(1);
        next.push(f);
        return next;
      });
    }, 380);

    return () => clearInterval(t);
  }, [connected, listening, sessionActive]);

  // ---------- recent sessions ----------
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [recentSessionsError, setRecentSessionsError] = useState("");

  useEffect(() => {
    if (!programId || !userRole || !supabase) return;

    async function fetchRecentSessions() {
      setRecentSessionsLoading(true);
      setRecentSessionsError("");
      try {
        // Tier-scoped read. Sessions recorded in a mode the program is not
        // entitled to never appear in this list — the rows are dropped
        // server-side, not filtered here.
        const { data, error } = await fetchSessionRows();
        if (error) throw error;

        setRecentSessions(
          (data ?? []).map((row: any) => ({
            id: row.session_id,
            timestamp: row.date_of_record ?? "",
            mode: row.mode ?? "Power",
            // Athlete names arrive as flat columns — PostgREST cannot embed a
            // related resource into a function result.
            athleteFirstName: row.athlete_first_name ?? "—",
            athleteLastName: row.athlete_last_name ?? "",
            athleteId: row.athlete_id ?? null,
          }))
        );
      } catch (err: any) {
        setRecentSessionsError(err.message ?? "Failed to load recent sessions.");
      } finally {
        setRecentSessionsLoading(false);
      }
    }

    fetchRecentSessions();
  }, [programId, userRole, coreTeamId, refreshKey]);

  // ---------- selected session heatmap + replay ----------
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummaryData | null>(null);
  const [heatmapViewMode, setHeatmapViewMode] = useState<"live" | "history">("live");

  // ── Replay state ─────────────────────────────────────────────────────────────
  // replayTimeMs  — current playhead position in session-time ms (0 = session start)
  // activeEventIdx — index of the most recently fired event (-1 = none yet)
  const [replayTimeMs,   setReplayTimeMs]   = useState(0);
  const [activeEventIdx, setActiveEventIdx] = useState(-1);
  const [isReplaying,    setIsReplaying]    = useState(false);
  const [replaySpeed,    setReplaySpeed]    = useState(1);   // 0.5 | 1 | 2
  // Pending timeouts — all cancelled on pause / seek / reset
  const replayTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Wall-clock ms when the current play run started, and the session-time offset it started from
  const replayStartWallRef    = useRef(0);
  const replayStartSessionRef = useRef(0);

  // Auto-set view mode based on session mode: accuracy always shows history
  useEffect(() => {
    const mode = (sessionSummary?.mode ?? "power").toLowerCase();
    if (mode === "accuracy") {
      setHeatmapViewMode("history");
    }
  }, [sessionSummary?.mode]);

  useEffect(() => {
    if (!selectedSessionId || !supabase) return;

    setHeatmapCells([]);
    setReplayEvents([]);
    setReplayTimeMs(0);
    setActiveEventIdx(-1);
    setIsReplaying(false);
    setFiredEvents([]);
    setHeatmapRipples([]);
    // Cancel any in-flight replay timeouts (cancelPendingTimeouts defined below)
    replayTimeoutsRef.current.forEach(clearTimeout);
    replayTimeoutsRef.current = [];
    setSessionSummary(null);

    async function fetchSessionHeatmap() {
      setHeatmapLoading(true);
      try {
        // 1. Grab the summary row, tier-masked. Fields above the program's
        //    tier come back null rather than absent, so the metric rows below
        //    render their "—" placeholder instead of breaking.
        const { data: summaryRows } = await supabase!.rpc("tiered_session_summaries", {
          p_session_id: selectedSessionId!,
        });
        const summary = (summaryRows ?? [])[0] as any;

        if (summary) {
          setSessionSummary({
            mode: summary.mode ?? "power",
            num_events: summary.num_events ?? null,
            session_duration_ms: summary.session_duration_ms ?? null,
            peak_force_stats: summary.peak_force_stats ?? null,
            impulse_stats: summary.impulse_stats ?? null,
            duration_ms_stats: summary.duration_ms_stats ?? null,
            angles_deg: summary.angles_deg ?? null,
            most_contacted_cell_rc: summary.most_contacted_cell_rc ?? null,
            center_of_mass_mm: summary.center_of_mass_mm ?? null,
            cadence_hz_avg: summary.cadence_hz_avg ?? null,
            iei_ms: summary.iei_ms ?? null,
            quality: summary.quality ?? null,
          });

          if (summary.heatmap) {
            const raw = summary.heatmap;
            const cells: HeatmapCell[] = [];
            if (Array.isArray(raw)) {
              const maxV = Math.max(1, ...raw.map((x: any) => x.value ?? x.intensity ?? 1));
              for (const x of raw) {
                cells.push({ r: x.r, c: x.c, intensity: (x.value ?? x.intensity ?? 1) / maxV });
              }
            } else if (typeof raw === "object") {
              const vals = Object.values(raw) as number[];
              const maxV = Math.max(1, ...vals);
              for (const [key, val] of Object.entries(raw)) {
                const [r, c] = key.split(/[-,]/).map(Number);
                if (!isNaN(r) && !isNaN(c)) cells.push({ r, c, intensity: (val as number) / maxV });
              }
            }
            setHeatmapCells(cells);
          }
        }

        // 2. Fetch ordered events with all cells — grouped per event for
        //    true-time replay. Served by tiered_session_events(), which
        //    re-authorises the session by id (events carries no program_id of
        //    its own), drops it entirely if the mode or date is outside the
        //    tier, and nulls the Tier II+ per-strike fields below that tier.
        //    event_cells is no longer client-readable at all — the cells come
        //    back pre-aggregated as a jsonb array.
        const { data: events } = await supabase!.rpc("tiered_session_events", {
          p_session_id: selectedSessionId!,
        });

        if (events && events.length > 0) {
          const tZero: number = (events[0] as any).t_start_ms ?? 0;
          const replayEvs: ReplayEvent[] = (events as any[]).map(ev => ({
            eventId:    ev.event_id,
            tMs:        (ev.t_start_ms ?? tZero) - tZero,
            cells:      (ev.cells ?? []).map((c: any) => ({
              r:  c.r,
              c:  c.c,
              mv: Math.round((c.v_min ?? 0) * 1000),
            })),
            si:         ev.strength_index?.value ?? null,
            cellCount:  ev.cell_count ?? (ev.cells?.length ?? 0),
            impulse:    ev.impulse_index   != null ? Math.round(Number(ev.impulse_index) * 10) / 10 : null,
            durationMs: ev.duration_ms     != null ? Math.round(Number(ev.duration_ms))             : null,
            riseMs:     ev.rise_time_ms    != null ? Math.round(Number(ev.rise_time_ms))             : null,
            angleDeg:       ev.angle_deg        != null ? Math.round(Number(ev.angle_deg))               : null,
            reactionTimeMs: ev.reaction_time_ms != null ? Math.round(Number(ev.reaction_time_ms))        : null,
            // Target mode — stored in accuracy jsonb column
            targetZone:  ev.accuracy?.target_zone  ?? null,
            zoneHit:     ev.accuracy?.zone_hit     ?? null,
            zoneCorrect: ev.accuracy?.zone_correct  ?? null,
            // Volume mode — stored in temporal jsonb column alongside cell_count
            volWindowIdx: ev.temporal?.vol_window_idx ?? null,
            volHitSeq:    ev.temporal?.vol_hit_seq    ?? null,
          }));
          setReplayEvents(replayEvs);
        }
      } finally {
        setHeatmapLoading(false);
      }
    }

    fetchSessionHeatmap();
  }, [selectedSessionId]);

  // ── Replay engine — true-time, setTimeout-based ─────────────────────────────

  const [heatmapRipples, setHeatmapRipples] = useState<Array<{ id: number; r: number; c: number; color: string }>>([]);
  const rippleIdRef = useRef(0);

  // Snapshot of fired events used to build the cumulative heatmap
  const [firedEvents, setFiredEvents] = useState<ReplayEvent[]>([]);

  function cancelPendingTimeouts() {
    replayTimeoutsRef.current.forEach(clearTimeout);
    replayTimeoutsRef.current = [];
  }

  // Schedule all events from startIdx onward, with timing relative to startSessionMs
  function scheduleFrom(startIdx: number, startSessionMs: number, speed: number) {
    cancelPendingTimeouts();
    if (startIdx >= replayEvents.length) return;

    const wallNow = performance.now();
    replayStartWallRef.current    = wallNow;
    replayStartSessionRef.current = startSessionMs;

    const totalMs = sessionSummary?.session_duration_ms ?? replayEvents[replayEvents.length - 1]?.tMs ?? 1;
    const mode    = (sessionSummary?.mode ?? "power").toLowerCase();
    const accent  = mode === "accuracy" ? "#00dcff" : mode === "reaction" ? "#ffcc00" : "#b400ff";

    replayEvents.slice(startIdx).forEach((ev, offset) => {
      const idx     = startIdx + offset;
      const delay   = Math.max(0, (ev.tMs - startSessionMs) / speed);

      const tid = setTimeout(() => {
        // Update playhead time
        setReplayTimeMs(ev.tMs);
        setActiveEventIdx(idx);

        // Add to fired events for cumulative heatmap
        setFiredEvents(prev => [...prev, ev]);

        // Spawn ripples for each cell in this event
        ev.cells.forEach(cell => {
          const intensity = Math.min(1, cell.mv / 3300);
          const color = intensity > 0.5 ? accent
                      : intensity > 0.2 ? "rgba(255,255,255,0.75)"
                      : "rgba(255,255,255,0.5)";
          const id = ++rippleIdRef.current;
          setHeatmapRipples(prev => [...prev, { id, r: cell.r, c: cell.c, color }]);
          setTimeout(() => setHeatmapRipples(prev => prev.filter(x => x.id !== id)), 900);
        });

        // Last event — stop replaying, advance playhead to end
        if (idx === replayEvents.length - 1) {
          setIsReplaying(false);
          setReplayTimeMs(totalMs);
        }
      }, delay);

      replayTimeoutsRef.current.push(tid);
    });
  }

  function startReplay() {
    setFiredEvents([]);
    setHeatmapRipples([]);
    setReplayTimeMs(0);
    setActiveEventIdx(-1);
    setIsReplaying(true);
    scheduleFrom(0, 0, replaySpeed);
  }

  function pauseReplay() {
    cancelPendingTimeouts();
    setIsReplaying(false);
  }

  function resumeReplay() {
    if (activeEventIdx >= replayEvents.length - 1) return;
    const nextIdx = activeEventIdx + 1;
    setIsReplaying(true);
    scheduleFrom(nextIdx, replayEvents[nextIdx]?.tMs ?? replayTimeMs, replaySpeed);
  }

  function resetReplay() {
    cancelPendingTimeouts();
    setIsReplaying(false);
    setReplayTimeMs(0);
    setActiveEventIdx(-1);
    setFiredEvents([]);
    setHeatmapRipples([]);
  }

  // Seek to a specific session-time position (ms) — fires all events up to that
  // point instantly, then schedules the rest from there
  function seekTo(targetMs: number) {
    cancelPendingTimeouts();
    const upTo  = replayEvents.filter(ev => ev.tMs <= targetMs);
    const after = replayEvents.findIndex(ev => ev.tMs > targetMs);
    setFiredEvents(upTo);
    setReplayTimeMs(targetMs);
    setActiveEventIdx(upTo.length - 1);
    setHeatmapRipples([]);
    if (isReplaying && after !== -1) {
      scheduleFrom(after, targetMs, replaySpeed);
    }
  }

  // Build cumulative per-cell hit map from all fired events
  const replayHeatmap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const ev of firedEvents) {
      for (const cell of ev.cells) {
        const key = `${cell.r}-${cell.c}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [firedEvents]);

  const maxReplayHits = useMemo(
    () => Math.max(1, ...Array.from(replayHeatmap.values())),
    [replayHeatmap]
  );

  // Derived: most recent event's cells for "just hit" highlight
  const activeEvent = activeEventIdx >= 0 ? replayEvents[activeEventIdx] : null;

  // ── Mode-aware accent colors ──────────────────────────────────────────────────
  const modeAccent = useMemo(() => {
    const m = (sessionSummary?.mode ?? "power").toLowerCase();
    if (m === "accuracy") return "#00dcff";
    if (m === "reaction") return "#ffcc00";
    if (m === "volume")   return "#ff6a00";
    if (m === "target")   return "#00ff88";
    return "#b400ff";
  }, [sessionSummary]);

  const modeGlow = useMemo(() => {
    const m = (sessionSummary?.mode ?? "power").toLowerCase();
    if (m === "accuracy") return "rgba(0,220,255,0.55)";
    if (m === "reaction") return "rgba(255,200,0,0.55)";
    if (m === "volume")   return "rgba(255,106,0,0.55)";
    if (m === "target")   return "rgba(0,255,136,0.55)";
    return "rgba(180,0,255,0.55)";
  }, [sessionSummary]);

  function pressureToColor(kpa: number): string {
    if (kpa > 80)  return modeAccent;
    if (kpa > 30)  return modeAccent + "bb";
    return "rgba(255,255,255,0.45)";
  }
  function pressureToGlow(kpa: number): string {
    if (kpa > 80)  return modeGlow.replace("0.55", "0.70");
    if (kpa > 30)  return modeGlow.replace("0.55", "0.40");
    return "rgba(255,255,255,0.25)";
  }

  // ── Summary stat helpers ──────────────────────────────────────────────────────
  function fmtDuration(ms: number | null): string {
    if (!ms) return "—";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }
  function fmtCell(rc: any): string {
    if (!rc) return "—";
    if (typeof rc === "object" && "r" in rc && "c" in rc)
      return `R${String(rc.r).padStart(2,"0")} C${String(rc.c).padStart(2,"0")}`;
    return String(rc);
  }
  function fmtNum(v: any, decimals = 1, unit = ""): string {
    if (v == null || isNaN(Number(v))) return "—";
    return `${Number(v).toFixed(decimals)}${unit}`;
  }
  function fmtAngle(angles: any): string {
    if (!angles) return "—";
    const mean = angles.mean ?? angles.avg ?? angles.median;
    if (mean == null) return "—";
    return `${Number(mean).toFixed(0)}°`;
  }

  const summaryStats = useMemo<SummaryStatItem[]>(() => {
    const s = sessionSummary;
    if (!s) return [];
    const mode = (s.mode ?? "power").toLowerCase();

    const totalEvents: SummaryStatItem = { label: "Total Events", value: s.num_events ? String(s.num_events) : "—", accent: true };
    const duration: SummaryStatItem    = { label: "Duration",      value: fmtDuration(s.session_duration_ms) };
    const location: SummaryStatItem    = { label: "Top Location",  value: fmtCell(s.most_contacted_cell_rc) };
    const cadence: SummaryStatItem     = { label: "Avg Cadence",   value: fmtNum(s.cadence_hz_avg, 1, " Hz") };
    const iei: SummaryStatItem         = { label: "Time Between",  value: fmtNum(s.iei_ms?.mean, 0, " ms") };

    if (mode === "accuracy") {
      const score   = s.quality?.accuracy_pct ?? s.quality?.score;
      const offset  = s.quality?.avg_offset_mm ?? s.quality?.avg_offset_cm ?? s.quality?.avg_offset_cells;
      const offUnit = s.quality?.avg_offset_mm != null ? " mm"
                    : s.quality?.avg_offset_cm != null ? " cm"
                    : " cells";
      const com = s.center_of_mass_mm;
      const comVal = com && typeof com === "object" && "x" in com && "y" in com
        ? `(${Number(com.x).toFixed(0)}, ${Number(com.y).toFixed(0)})`
        : com ? String(com) : "—";
      return [
        totalEvents,
        duration,
        { label: "Accuracy Score", value: score != null ? `${Number(score).toFixed(1)}%` : "—", accent: true },
        { label: "Avg Offset",     value: fmtNum(offset, 1, offUnit) },
        location,
        { label: "Center of Mass", value: comVal },
        cadence,
        iei,
      ];
    }

    if (mode === "reaction") {
      // Read true reaction times from quality — these are signal-to-impact ms
      // recorded live during the session. iei_ms is inter-event interval (hit-to-hit
      // cadence) and must NOT be used here — it reads much shorter than a real
      // reaction time because it measures the gap between consecutive hits, not
      // the gap from the "HIT!" signal to the strike.
      const bestRt   = s.quality?.best_reaction_ms;
      const avgRt    = s.quality?.avg_reaction_ms;
      const attempts = s.quality?.attempts;
      const impactDur = s.duration_ms_stats?.mean ?? s.duration_ms_stats?.avg;
      return [
        totalEvents,
        duration,
        { label: "Best Reaction", value: fmtNum(bestRt, 0, " ms"), accent: true },
        { label: "Avg Reaction",  value: fmtNum(avgRt, 0, " ms") },
        { label: "Attempts",      value: attempts != null ? String(attempts) : "—" },
        { label: "Impact Duration", value: fmtNum(impactDur, 0, " ms") },
        location,
        { label: "Angle",         value: fmtAngle(s.angles_deg) },
        cadence,
      ];
    }

    if (mode === "target") {
      const q               = s.quality;
      const accPct          = q?.target_accuracy_pct;
      const attempts        = q?.attempts;
      const correct         = q?.correct_hits;
      // best_reaction_ms_correct is the meaningful competitive benchmark —
      // only counts hits that landed in the correct zone.
      // best_reaction_ms covers all attempts as a fallback.
      const bestRtCorrect   = q?.best_reaction_ms_correct ?? q?.best_reaction_ms;
      const avgRtCorrect    = q?.avg_reaction_ms_correct;
      const avgRtAll        = q?.avg_reaction_ms_all ?? q?.reaction_time_ms_all?.mean;
      return [
        duration,
        { label: "Accuracy",           value: accPct != null ? `${Number(accPct).toFixed(1)}%` : "—", accent: true },
        { label: "Correct / Attempts", value: (correct != null && attempts != null) ? `${correct} / ${attempts}` : "—" },
        { label: "Best RT (correct)",  value: fmtNum(bestRtCorrect, 0, " ms") },
        { label: "Avg RT (correct)",   value: fmtNum(avgRtCorrect,  0, " ms") },
        { label: "Avg RT (all)",       value: fmtNum(avgRtAll,      0, " ms") },
        location,
        cadence,
      ];
    }

    if (mode === "volume") {
      const q         = s.quality;
      const bestWin   = q?.best_window_hits;
      const avgWin    = q?.avg_window_hits;
      const totalWins = q?.total_windows;
      const siStats   = q?.strength_index;
      const siSlope   = q?.si_fatigue_slope;   // SI pts/window from linear regression
      const siTrend   = q?.si_trend as "fatigue" | "building" | "stable" | undefined;

      // Format slope: show sign explicitly, round to 1 dp, label units clearly
      const slopeTxt = siSlope != null
        ? `${siSlope > 0 ? "+" : ""}${siSlope} SI / window`
        : "—";

      // Human-readable trend label derived from server-side classification
      const trendTxt =
        siTrend === "fatigue"  ? "▼ Fatiguing"  :
        siTrend === "building" ? "▲ Building"   :
        siTrend === "stable"   ? "→ Stable"     : "—";

      return [
        duration,
        { label: "Best Window",       value: bestWin  != null ? `${bestWin} hits` : "—", accent: true },
        { label: "Avg Window",        value: avgWin   != null ? `${Number(avgWin).toFixed(1)} hits` : "—" },
        { label: "Windows",           value: totalWins != null ? String(totalWins) : "—" },
        { label: "SI Trend",          value: trendTxt },
        { label: "SI Slope",          value: slopeTxt },
        { label: "Peak Strength",     value: fmtNum(siStats?.max,  0, "") },
        { label: "Avg Strength",      value: fmtNum(siStats?.mean, 0, "") },
        cadence,
      ];
    }

    // power / default
    const siStats   = s.quality?.strength_index;
    const peakIndex = siStats?.max  ?? null;
    const avgIndex  = siStats?.mean ?? null;
    return [
      totalEvents,
      duration,
      { label: "Peak Strength Index", value: fmtNum(peakIndex, 0, ""), accent: true },
      { label: "Avg Strength Index",  value: fmtNum(avgIndex,  0, "") },
      { label: "Angle",               value: fmtAngle(s.angles_deg) },
      location,
      cadence,
      iei,
    ];
  }, [sessionSummary]);

  function formatSessionTime(isoString: string) {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }



  const insights: Insight[] = useMemo(() => {
    const peak = Math.max(0, ...series);
    const avg = series.reduce((a, b) => a + b, 0) / Math.max(1, series.length);
    const trend = series.slice(-8).reduce((a, b) => a + b, 0) / 8 - series.slice(0, 8).reduce((a, b) => a + b, 0) / 8;

    return [
      {
        tag: "Power",
        title: peak > 45 ? "Peak power is strong" : "Build peak power",
        body:
          peak > 45
            ? "You're hitting high peaks. Maintain form and focus on consistency between sets."
            : "Try shorter, snappier combinations and increase rest quality between bursts.",
      },
      {
        tag: "Accuracy",
        title: "Placement stability",
        body:
          lastZone === "—"
            ? "Start a session to generate zone distribution and heatmap trends."
            : `Most recent impact registered at ${lastZone}. Add more hits to build your heatmap.`,
      },
      {
        tag: "Tempo",
        title: trend > 2 ? "Output trending up" : trend < -2 ? "Output dropping" : "Output steady",
        body:
          trend > 2
            ? "You're ramping intensity. Keep breathing controlled to avoid accuracy drop."
            : trend < -2
            ? "Power drop detected. Consider longer rest or switch to technique focus."
            : "Stable output. Good time to push precision and reduce wasted movement.",
      },
    ];
  }, [series, lastZone]);

  // ---------- UI handlers ----------
  function toggleConnect() {
    setConnected((c) => {
      const next = !c;
      if (!next) {
        setListening(false);
        setSessionActive(false);
      }
      return next;
    });
  }

  function startListen() {
    if (!connected) return;
    setListening(true);
  }
  function stopListen() {
    setListening(false);
    setSessionActive(false);
  }

  function startSession() {
    if (!connected) return;
    if (!listening) setListening(true);
    setSessionActive(true);
    setHits(0);
    setSeries(Array.from({ length: 32 }, () => 0));
    setLastZone("—");
    setLastForce(0);
    setLastSpeed(0);
  }

  function stopSession() {
    setSessionActive(false);
  }
  const [leaderDateRange, setLeaderDateRange] = useState<LeaderDateRange>(options.leaderRangeDefault);

  // The window the user asked for, as a day count the RPC understands.
  // "all time" sends null, which the function reads as "no client-side
  // narrowing" — it still clamps to the tier's own history window, so a Tier I
  // program selecting All time gets 30 days and nothing older.
  const leaderRangeDays = useMemo<number | null>(
    () => (leaderDateRange === "all" ? null : leaderDateRange),
    [leaderDateRange]
  );

  // Ranges the program's history window actually covers. Offering "All time"
  // to a Tier I program would silently return 30 days and read as a bug.
  const { leaderRangesFor } = options;
  const availableRanges = useMemo<LeaderDateRange[]>(
    () => leaderRangesFor(ent.historyDays()),
    [ent, leaderRangesFor]
  );

  // Keep the selection inside what the tier allows — including on downgrade,
  // where a stored "all time" choice would otherwise persist as a dead option.
  useEffect(() => {
    if (ent.loading) return;
    if (!availableRanges.includes(leaderDateRange)) setLeaderDateRange(availableRanges[0]);
  }, [availableRanges, leaderDateRange, ent.loading]);

  const [leaderMetric, setLeaderMetric] = useState<MetricKey>("strength");
  const [strengthRows, setStrengthRows] = useState<Extract<LeaderRow, { metric: "strength" }>[]>([]);
  const [reactionRows, setReactionRows] = useState<Extract<LeaderRow, { metric: "reaction" }>[]>([]);
  const [accuracyRows, setAccuracyRows] = useState<Extract<LeaderRow, { metric: "accuracy" }>[]>([]);
  const [volumeInsightRows, setVolumeInsightRows] = useState<VolumeInsightRow[]>([]);
  const [targetInsightRows, setTargetInsightRows] = useState<TargetInsightRow[]>([]);

  // Single loading flag covering all five leaderboard queries
  const [strengthLoading, setStrengthLoading] = useState(false);
  const reactionLoading  = strengthLoading;
  const accuracyLoading  = strengthLoading;

  // ---------- Leaderboard — all five modes in one Promise.all ----------
  useEffect(() => {
    if (!programId || !userRole || !supabase) return;

    setStrengthLoading(true);
    setStrengthRows([]);
    setReactionRows([]);
    setAccuracyRows([]);
    setVolumeInsightRows([]);
    setTargetInsightRows([]);

    // One tier-scoped call for all five modes, split by mode client-side.
    // The RPC applies program and core-team scoping itself, so the only
    // thing passed here is the narrowing the user actually asked for. A tier
    // that has not unlocked a mode gets an empty array for it — Volume and
    // Target come back empty below Tier III, which is what starves the
    // fatigue tracker of its inputs.
    const range = leaderRangeDays;

    (async () => {
      try {
        const byMode = await fetchLeaderboardRowsByMode(range);
        const strengthRes = byMode.power;
        const reactionRes = byMode.reaction;
        const accuracyRes = byMode.accuracy;
        const volumeRes   = byMode.volume;
        const targetRes   = byMode.target;

        // ── Strength ────────────────────────────────────────────────────────────
        if (!strengthRes.error && strengthRes.data) {
          type Agg = { name: string; peakIndex: number; avgSum: number; avgCount: number; sessions: number };
          const aggMap = new Map<string, Agg>();
          for (const row of strengthRes.data as any[]) {
            const athleteId = row.athlete_id;
            if (!athleteId) continue;
            const si = row.quality?.strength_index;
            let siMax: number | null = null;
            let siMean: number | null = null;
            if (si && typeof si.max === "number" && typeof si.mean === "number") {
              siMax = si.max; siMean = si.mean;
            } else {
              const pfs = row.peak_force_stats;
              const peakMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? (pfs.peak_mv ?? pfs.peak_v * 1000) : null);
              const avgMv  = pfs?.avg_mv  ?? (pfs?.avg_v  != null ? (pfs.avg_mv  ?? pfs.avg_v  * 1000) : null);
              if (peakMv != null && avgMv != null) {
                siMax  = Math.round((peakMv / 3320) * 1000);
                siMean = Math.round((avgMv  / 3320) * 1000);
              }
            }
            if (siMax == null || siMean == null) continue;
            const name = athleteNameOf(row);
            const ex = aggMap.get(athleteId);
            if (ex) { ex.peakIndex = Math.max(ex.peakIndex, siMax); ex.avgSum += siMean; ex.avgCount++; ex.sessions++; }
            else aggMap.set(athleteId, { name, peakIndex: siMax, avgSum: siMean, avgCount: 1, sessions: 1 });
          }
          const sRows: Extract<LeaderRow, { metric: "strength" }>[] = [];
          for (const [athleteId, agg] of aggMap.entries()) {
            sRows.push({ metric: "strength", athleteId, name: agg.name, peakIndex: Math.round(agg.peakIndex), avgIndex: Math.round(agg.avgSum / agg.avgCount), sessions: agg.sessions });
          }
          sRows.sort((a, b) => b.peakIndex - a.peakIndex);
          setStrengthRows(sRows.slice(0, 5));
        }

        // ── Reaction ────────────────────────────────────────────────────────────
        if (!reactionRes.error && reactionRes.data) {
          type RAgg = { name: string; bestMs: number; sumAvgMs: number; count: number; attempts: number };
          const aggMap = new Map<string, RAgg>();
          for (const row of reactionRes.data as any[]) {
            const athleteId = row.athlete_id;
            if (!athleteId) continue;
            const q = row.quality;
            const avgMs = q?.avg_reaction_ms ?? null;
            const minMs = q?.best_reaction_ms ?? null;
            if (avgMs == null) continue;
            const resolvedMin = minMs ?? avgMs;
            const name = athleteNameOf(row);
            const ex = aggMap.get(athleteId);
            if (ex) { ex.bestMs = Math.min(ex.bestMs, resolvedMin); ex.sumAvgMs += avgMs; ex.count++; ex.attempts += row.num_events ?? 0; }
            else aggMap.set(athleteId, { name, bestMs: resolvedMin, sumAvgMs: avgMs, count: 1, attempts: row.num_events ?? 0 });
          }
          const rRows: Extract<LeaderRow, { metric: "reaction" }>[] = [];
          for (const [athleteId, agg] of aggMap.entries()) {
            rRows.push({ metric: "reaction", athleteId, name: agg.name, avgReactionMs: Math.round(agg.sumAvgMs / agg.count), bestReactionMs: Math.round(agg.bestMs), attempts: agg.attempts });
          }
          rRows.sort((a, b) => a.avgReactionMs - b.avgReactionMs);
          setReactionRows(rRows.slice(0, 5));
        }

        // ── Accuracy ────────────────────────────────────────────────────────────
        if (!accuracyRes.error && accuracyRes.data) {
          type AAgg = { name: string; sumPct: number; sumOffset: number; offsetCount: number; sessions: number };
          const aggMap = new Map<string, AAgg>();
          for (const row of accuracyRes.data as any[]) {
            const athleteId = row.athlete_id;
            if (!athleteId) continue;
            let pct = row.quality?.accuracy_pct ?? row.quality?.score ?? null;
            const offset = row.quality?.avg_offset_mm ?? row.quality?.avg_offset_cm ?? row.quality?.avg_offset_cells ?? null;
            if (pct == null) {
              const avgMv = row.peak_force_stats?.avg_mv ?? (row.peak_force_stats?.avg_v != null ? row.peak_force_stats.avg_v * 1000 : null);
              if (avgMv == null) continue;
              pct = Math.min(100, Math.round((avgMv / 3320) * 100 * 10) / 10);
            }
            const name = athleteNameOf(row);
            const ex = aggMap.get(athleteId);
            if (ex) { ex.sumPct += Number(pct); ex.sessions++; if (offset != null) { ex.sumOffset += Number(offset); ex.offsetCount++; } }
            else aggMap.set(athleteId, { name, sumPct: Number(pct), sumOffset: offset != null ? Number(offset) : 0, offsetCount: offset != null ? 1 : 0, sessions: 1 });
          }
          const aRows: Extract<LeaderRow, { metric: "accuracy" }>[] = [];
          for (const [athleteId, agg] of aggMap.entries()) {
            aRows.push({ metric: "accuracy", athleteId, name: agg.name, accuracyPct: Math.round((agg.sumPct / agg.sessions) * 10) / 10, avgOffsetCm: agg.offsetCount > 0 ? Math.round((agg.sumOffset / agg.offsetCount) * 10) / 10 : 0, sessions: agg.sessions });
          }
          aRows.sort((a, b) => b.accuracyPct - a.accuracyPct);
          setAccuracyRows(aRows.slice(0, 5));
        }

        // ── Volume ──────────────────────────────────────────────────────────────
        if (!volumeRes.error && volumeRes.data) {
          type VAgg = { name: string; sumAvgWin: number; bestWin: number; sumSlope: number; slopeCount: number; sumSi: number; siCount: number; sessions: number; numEvents: number };
          const aggMap = new Map<string, VAgg>();
          for (const row of volumeRes.data as any[]) {
            const aid = row.athlete_id; if (!aid) continue;
            const qd = row.quality;
            const avgWin = qd?.avg_window_hits ?? null;
            if (avgWin == null) continue;
            const bestWin = qd?.best_window_hits ?? avgWin;
            const slope   = qd?.si_fatigue_slope ?? null;
            const siMean  = qd?.strength_index?.mean ?? null;
            const name    = athleteNameOf(row, "Unknown");
            const evts    = row.num_events ?? 0;
            const ex = aggMap.get(aid);
            if (ex) {
              ex.sumAvgWin += Number(avgWin); ex.bestWin = Math.max(ex.bestWin, Number(bestWin));
              if (slope != null) { ex.sumSlope += Number(slope); ex.slopeCount++; }
              if (siMean != null) { ex.sumSi += Number(siMean); ex.siCount++; }
              ex.sessions++; ex.numEvents += evts;
            } else {
              aggMap.set(aid, { name, sumAvgWin: Number(avgWin), bestWin: Number(bestWin), sumSlope: slope != null ? Number(slope) : 0, slopeCount: slope != null ? 1 : 0, sumSi: siMean != null ? Number(siMean) : 0, siCount: siMean != null ? 1 : 0, sessions: 1, numEvents: evts });
            }
          }
          const vRows: VolumeInsightRow[] = [];
          for (const [aid, agg] of aggMap.entries()) {
            vRows.push({ athleteId: aid, name: agg.name, avgWindowHits: Math.round(agg.sumAvgWin / agg.sessions * 10) / 10, bestWindowHits: agg.bestWin, avgSiFatigueSlope: agg.slopeCount > 0 ? Math.round(agg.sumSlope / agg.slopeCount * 10) / 10 : null, avgSi: agg.siCount > 0 ? Math.round(agg.sumSi / agg.siCount) : null, sessions: agg.sessions, numEvents: agg.numEvents });
          }
          vRows.sort((a, b) => b.avgWindowHits - a.avgWindowHits);
          setVolumeInsightRows(vRows);
        }

        // ── Target ──────────────────────────────────────────────────────────────
        if (!targetRes.error && targetRes.data) {
          type TAgg = { name: string; sumAccPct: number; sumRtCorrect: number; rtCount: number; attempts: number; sessions: number };
          const aggMap = new Map<string, TAgg>();
          for (const row of targetRes.data as any[]) {
            const aid = row.athlete_id; if (!aid) continue;
            const qd = row.quality;
            const accPct = qd?.target_accuracy_pct ?? null;
            if (accPct == null) continue;
            const rt   = qd?.avg_reaction_ms_correct ?? qd?.avg_reaction_ms_all ?? null;
            const atts = qd?.attempts ?? 0;
            const name = athleteNameOf(row, "Unknown");
            const ex = aggMap.get(aid);
            if (ex) { ex.sumAccPct += Number(accPct); if (rt != null) { ex.sumRtCorrect += Number(rt); ex.rtCount++; } ex.attempts += Number(atts); ex.sessions++; }
            else aggMap.set(aid, { name, sumAccPct: Number(accPct), sumRtCorrect: rt != null ? Number(rt) : 0, rtCount: rt != null ? 1 : 0, attempts: Number(atts), sessions: 1 });
          }
          const tRows: TargetInsightRow[] = [];
          for (const [aid, agg] of aggMap.entries()) {
            tRows.push({ athleteId: aid, name: agg.name, avgAccuracyPct: Math.round(agg.sumAccPct / agg.sessions * 10) / 10, avgReactionMsCorrect: agg.rtCount > 0 ? Math.round(agg.sumRtCorrect / agg.rtCount) : null, attempts: agg.attempts, sessions: agg.sessions });
          }
          tRows.sort((a, b) => b.avgAccuracyPct - a.avgAccuracyPct);
          setTargetInsightRows(tRows);
        }

      } finally {
        setStrengthLoading(false);
      }
    })();
  }, [programId, userRole, coreTeamId, leaderRangeDays]);

  const [teamLeaderMetric, setTeamLeaderMetric] = useState<MetricKey>("strength");
  const [teamLeaderRows,   setTeamLeaderRows]   = useState<TeamLeaderRow[]>([]);
  const [teamLeaderLoading,setTeamLeaderLoading]= useState(false);
  const [teamImprovedMetric, setTeamImprovedMetric] = useState<MetricKey>("strength");
  const [teamImprovedRows,   setTeamImprovedRows]   = useState<TeamImprovedRow[]>([]);
  const [teamImprovedLoading,setTeamImprovedLoading]= useState(false);

  useEffect(() => {
    if (!programId || !supabase || teams.length === 0) return;
    setTeamLeaderLoading(true);
    setTeamLeaderRows([]);

    (async () => {
      try {
        // All teams visible (core + sub)
        const allTeams = teams;

        // For sub-teams: resolve athlete IDs from team_members
        const subTeams = allTeams.filter(t => t.team_type !== "core");
        const subTeamMembers = new Map<string, string[]>();
        if (subTeams.length > 0) {
          const { data: memberRows } = await supabase!
            .from("team_members")
            .select("team_id, athlete_id")
            .in("team_id", subTeams.map(t => t.id))
            .not("athlete_id", "is", null);
          for (const m of memberRows ?? []) {
            if (!subTeamMembers.has(m.team_id)) subTeamMembers.set(m.team_id, []);
            subTeamMembers.get(m.team_id)!.push(m.athlete_id);
          }
        }

        const modeFilter = teamLeaderMetric === "strength" ? "power"
                         : teamLeaderMetric === "volume"   ? "volume"
                         : teamLeaderMetric === "target"   ? "target"
                         : teamLeaderMetric;

        const rows: TeamLeaderRow[] = [];
        // One call for every team, bucketed client-side: a core team by
        // core_team_id, a sub-team by its roster. Both only narrow the
        // tier-scoped result, so an id from outside the program gets nothing.
        const rowsByTeam = await fetchSessionRowsByTeam(allTeams, subTeamMembers, {
          mode: modeFilter,
          rangeDays: leaderRangeDays,
        });

        for (const team of allTeams) {
          const isCore = team.team_type === "core";

          const data = rowsByTeam.get(team.id);
          if (!data || data.length === 0) continue;

          if (teamLeaderMetric === "strength") {
            let peakBest = 0, avgSum = 0, avgCount = 0;
            for (const row of data as any[]) {
              const si = row.quality?.strength_index;
              let peak: number | null = null, avg: number | null = null;
              if (si?.max != null) { peak = Math.round(si.max); avg = Math.round(si.mean ?? si.max); }
              else {
                const pfs = row.peak_force_stats;
                const pMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? pfs.peak_v * 1000 : null);
                const aMv = pfs?.avg_mv  ?? (pfs?.avg_v  != null ? pfs.avg_v  * 1000 : null);
                if (pMv != null) { peak = Math.round((pMv / 3320) * 1000); avg = aMv != null ? Math.round((aMv / 3320) * 1000) : peak; }
              }
              if (peak != null) { peakBest = Math.max(peakBest, peak); avgSum += avg ?? peak; avgCount++; }
            }
            if (avgCount === 0) continue;
            rows.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", memberCount: team.member_count ?? 0, sessionCount: data.length, peakIndex: peakBest, avgIndex: Math.round(avgSum / avgCount) });
          } else if (teamLeaderMetric === "accuracy") {
            let pctSum = 0, offsetSum = 0, offsetCount = 0, count = 0;
            for (const row of data as any[]) {
              let pct = row.quality?.accuracy_pct ?? row.quality?.score ?? null;
              if (pct == null) { const aMv = row.peak_force_stats?.avg_mv ?? null; if (aMv != null) pct = Math.min(100, Math.round((aMv / 3320) * 100 * 10) / 10); }
              if (pct == null) continue;
              pctSum += Number(pct); count++;
              const off = row.quality?.avg_offset_mm ?? null;
              if (off != null) { offsetSum += Number(off); offsetCount++; }
            }
            if (count === 0) continue;
            rows.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", memberCount: team.member_count ?? 0, sessionCount: data.length, accuracyPct: Math.round((pctSum / count) * 10) / 10, avgOffsetMm: offsetCount > 0 ? Math.round(offsetSum / offsetCount) : undefined });
          } else if (teamLeaderMetric === "volume") {
            let totalHits = 0, avgWinSum = 0, avgWinCount = 0, siSum = 0, siCount = 0;
            for (const row of data as any[]) {
              const avgWin = row.quality?.avg_window_hits ?? null;
              if (avgWin != null) { avgWinSum += Number(avgWin); avgWinCount++; }
              const si = row.quality?.strength_index?.mean ?? null;
              if (si != null) { siSum += Number(si); siCount++; }
            }
            if (avgWinCount === 0) continue;
            totalHits = Math.round(avgWinSum / avgWinCount * 10) / 10;
            rows.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", memberCount: team.member_count ?? 0, sessionCount: data.length, totalHits, avgSi: siCount > 0 ? Math.round(siSum / siCount) : undefined });
          } else if (teamLeaderMetric === "target") {
            let accSum = 0, rtSum = 0, rtCount = 0, attempts = 0, count = 0;
            for (const row of data as any[]) {
              const acc = row.quality?.target_accuracy_pct ?? null;
              if (acc == null) continue;
              accSum += Number(acc); count++;
              attempts += row.quality?.attempts ?? 0;
              const rt = row.quality?.avg_reaction_ms_correct ?? row.quality?.avg_reaction_ms_all ?? null;
              if (rt != null) { rtSum += Number(rt); rtCount++; }
            }
            if (count === 0) continue;
            rows.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", memberCount: team.member_count ?? 0, sessionCount: data.length, targetAccuracyPct: Math.round((accSum / count) * 10) / 10, avgReactionMsCorrect: rtCount > 0 ? Math.round(rtSum / rtCount) : undefined });
          } else {
            let avgSum = 0, bestMin = Infinity, count = 0;
            for (const row of data as any[]) {
              const avg = row.quality?.avg_reaction_ms ?? null;
              const best = row.quality?.best_reaction_ms ?? null;
              if (avg == null) continue;
              avgSum += avg; count++;
              if (best != null) bestMin = Math.min(bestMin, best);
            }
            if (count === 0) continue;
            rows.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", memberCount: team.member_count ?? 0, sessionCount: data.length, avgReactionMs: Math.round(avgSum / count), bestReactionMs: bestMin < Infinity ? Math.round(bestMin) : undefined });
          }
        }

        // Sort
        if (teamLeaderMetric === "strength")  rows.sort((a, b) => (b.peakIndex ?? 0) - (a.peakIndex ?? 0));
        if (teamLeaderMetric === "accuracy")  rows.sort((a, b) => (b.accuracyPct ?? 0) - (a.accuracyPct ?? 0));
        if (teamLeaderMetric === "reaction")  rows.sort((a, b) => (a.avgReactionMs ?? 9999) - (b.avgReactionMs ?? 9999));
        if (teamLeaderMetric === "volume")    rows.sort((a, b) => (b.totalHits ?? 0) - (a.totalHits ?? 0));
        if (teamLeaderMetric === "target")    rows.sort((a, b) => (b.targetAccuracyPct ?? 0) - (a.targetAccuracyPct ?? 0));

        setTeamLeaderRows(rows);
      } finally {
        setTeamLeaderLoading(false);
      }
    })();
  }, [programId, teams, teamLeaderMetric, leaderRangeDays]);

  // Most Improved per team
  useEffect(() => {
    if (!programId || !supabase || teams.length === 0) return;
    setTeamImprovedLoading(true);
    setTeamImprovedRows([]);

    (async () => {
      try {
        const subTeams = teams.filter(t => t.team_type !== "core");
        const subTeamMembers = new Map<string, string[]>();
        if (subTeams.length > 0) {
          const { data: memberRows } = await supabase!
            .from("team_members").select("team_id, athlete_id")
            .in("team_id", subTeams.map(t => t.id)).not("athlete_id", "is", null);
          for (const m of memberRows ?? []) {
            if (!subTeamMembers.has(m.team_id)) subTeamMembers.set(m.team_id, []);
            subTeamMembers.get(m.team_id)!.push(m.athlete_id);
          }
        }

        const modeFilter = teamImprovedMetric === "strength" ? "power"
                         : teamImprovedMetric === "form"     ? null
                         : teamImprovedMetric;
        const improved: TeamImprovedRow[] = [];
        const rowsByTeam = await fetchSessionRowsByTeam(teams, subTeamMembers, {
          mode: modeFilter,
          rangeDays: leaderRangeDays,
        });

        for (const team of teams) {
          const isCore = team.team_type === "core";
          if (!rowsByTeam.has(team.id)) continue;
          const teamRows = rowsByTeam.get(team.id)!;

          // Oldest-first: the improvement split below compares the first half
          // of a team's history against the last.
          const data = (teamRows ?? []).sort((a: any, b: any) =>
            String(a.date_of_record ?? "").localeCompare(String(b.date_of_record ?? "")));
          if (data.length < 4) continue;

          function extractVal(row: any): number | null {
            if (teamImprovedMetric === "strength") {
              const si = row.quality?.strength_index;
              if (si?.max != null) return Math.round(si.max);
              const pMv = row.peak_force_stats?.peak_mv ?? null;
              return pMv != null ? Math.round((pMv / 3320) * 1000) : null;
            }
            if (teamImprovedMetric === "accuracy") return row.quality?.accuracy_pct ?? row.quality?.score ?? null;
            if (teamImprovedMetric === "reaction") return row.quality?.avg_reaction_ms ?? null;
            // form: abs(angle)
            const angle = row.angles_deg?.mean ?? row.angles_deg?.avg ?? null;
            return angle != null ? Math.round(Math.abs(Number(angle)) * 10) / 10 : null;
          }

          const vals = (data as any[]).map(extractVal).filter((v): v is number => v != null);
          if (vals.length < 4) continue;
          const half = Math.floor(vals.length / 2);
          const early = vals.slice(0, half).reduce((s, v) => s + v, 0) / half;
          const late  = vals.slice(-half).reduce((s, v) => s + v, 0) / half;
          // form & reaction: lower = better
          const delta = (teamImprovedMetric === "reaction" || teamImprovedMetric === "form")
            ? Math.round((early - late) * 10) / 10
            : Math.round(late - early);
          improved.push({ teamId: team.id, name: team.name, teamType: isCore ? "core" : "sub", delta, from: Math.round(early * 10) / 10, to: Math.round(late * 10) / 10, sessions: vals.length });
        }

        improved.sort((a, b) => b.delta - a.delta);
        setTeamImprovedRows(improved.slice(0, 5));
      } finally {
        setTeamImprovedLoading(false);
      }
    })();
  }, [programId, teams, teamImprovedMetric, leaderRangeDays]);

  const leaderboardData = useMemo<LeaderRow[]>(() => {
    if (leaderMetric === "strength") return strengthRows;
    if (leaderMetric === "reaction") return reactionRows;
    if (leaderMetric === "accuracy") return accuracyRows;
    // volume and target use their own typed arrays rendered directly
    return [];
  }, [leaderMetric, strengthRows, reactionRows, accuracyRows]);

  const coachInsights = useMemo<CoachInsight[]>(() => {
    const out: CoachInsight[] = [];

    // ── 1. POWER — from strength leaderboard ─────────────────────────────────
    if (strengthRows.length > 0) {
      const top       = strengthRows[0];
      const bottom    = strengthRows[strengthRows.length - 1];
      const spread    = top.peakIndex - bottom.peakIndex;
      const avgOfAvgs = Math.round(strengthRows.reduce((s, r) => s + r.avgIndex, 0) / strengthRows.length);
      const gapTopAvg = top.peakIndex - top.avgIndex;
      const consistency = gapTopAvg < 80 ? "consistent" : gapTopAvg < 180 ? "moderate variance" : "high variance";
      out.push({
        tag: "Power",
        priority: spread > 300 ? "high" : "medium",
        headline: spread > 300
          ? `${top.name.split(" ")[0]} leads by ${spread} pts — group spread is wide`
          : `Group avg strength index: ${avgOfAvgs} / 1000`,
        numbers: [
          { label: "Top athlete", value: `${top.peakIndex} peak`, delta: `${top.avgIndex} avg` },
          { label: "Group avg",   value: `${avgOfAvgs} / 1000` },
          { label: "Spread",      value: `${spread} pts`, deltaDir: spread > 300 ? "down" : "neutral" },
        ],
        cue: spread > 300
          ? `Focus lower-index athletes on max-effort combos (3–4 strikes). Pair ${top.name.split(" ")[0]} with technique refinement — their ${consistency} peak-to-avg gap suggests ${gapTopAvg < 80 ? "solid output control" : "room to raise their floor"}.`
          : `Group power is ${avgOfAvgs > 600 ? "strong" : avgOfAvgs > 400 ? "developing" : "early-stage"}. ${gapTopAvg > 150 ? `${top.name.split(" ")[0]}'s peak-to-avg gap (${gapTopAvg} pts) is wide — cue them to engage hips earlier on every strike.` : "Maintain form cues and increase volume gradually."}`,
      });
    }

    // ── 2. SESSION POWER — from selected session summary ─────────────────────
    if (sessionSummary && (sessionSummary.mode ?? "power").toLowerCase() === "power") {
      const si      = sessionSummary.quality?.strength_index;
      const peakIdx = si?.max  ?? null;
      const avgIdx  = si?.mean ?? null;
      const cadence = sessionSummary.cadence_hz_avg;
      const events  = sessionSummary.num_events ?? 0;
      const dur     = sessionSummary.session_duration_ms;
      const angle   = sessionSummary.angles_deg?.mean ?? sessionSummary.angles_deg?.avg;
      if (peakIdx != null && avgIdx != null) {
        const gap       = Math.round(peakIdx - avgIdx);
        const rateKps   = dur && dur > 0 ? ((events / (dur / 1000)) * 60).toFixed(1) : null;
        const angleNote = angle != null
          ? angle > 10  ? `avg angle ${angle.toFixed(0)}° — possible form lean`
          : angle < -10 ? `avg angle ${angle.toFixed(0)}° — check shoulder drop`
          : `avg angle ${angle.toFixed(0)}° (neutral)` : null;
        out.push({
          tag: "Power",
          priority: gap > 200 ? "high" : "medium",
          headline: `Selected session: peak ${Math.round(peakIdx)} / avg ${Math.round(avgIdx)} (+${gap} pt gap)`,
          numbers: [
            { label: "Peak index", value: `${Math.round(peakIdx)}`, deltaDir: peakIdx > 700 ? "up" : peakIdx < 400 ? "down" : "neutral" },
            { label: "Avg index",  value: `${Math.round(avgIdx)}` },
            { label: "Events",     value: `${events}${rateKps ? ` · ${rateKps}/min` : ""}` },
            ...(cadence != null ? [{ label: "Cadence", value: `${Number(cadence).toFixed(1)} Hz` }] : []),
          ],
          cue: gap > 200
            ? `High peak-to-avg spread (${gap} pts) — athlete is flashing power but not sustaining it. Drill 8-count continuous combos with no rest to compress the gap. ${angleNote ? `Also: ${angleNote}.` : ""}`
            : avgIdx < 350
            ? `Average output is low (${Math.round(avgIdx)} / 1000). Cue explosive hip rotation and full extension — don't just count reps, demand intent. ${angleNote ? `Note: ${angleNote}.` : ""}`
            : `Output is consistent. ${rateKps ? `Rate: ${rateKps} strikes/min — ` : ""}${Number(rateKps) > 30 ? "strong pace, now focus on target precision." : "build rate with short burst intervals."} ${angleNote ?? ""}`,
        });
      }
    }

    // ── 3. ACCURACY — from accuracy leaderboard ──────────────────────────────
    if (accuracyRows.length > 0) {
      const best   = accuracyRows[0];
      const worst  = accuracyRows[accuracyRows.length - 1];
      const avgPct = Math.round(accuracyRows.reduce((s, r) => s + r.accuracyPct, 0) / accuracyRows.length);
      out.push({
        tag: "Accuracy",
        priority: avgPct < 60 ? "high" : avgPct < 78 ? "medium" : "low",
        headline: `Group accuracy avg: ${avgPct}% · best: ${best.name.split(" ")[0]} at ${best.accuracyPct}%`,
        numbers: [
          { label: "Best",       value: `${best.accuracyPct}%`,  delta: best.avgOffsetCm > 0 ? `${best.avgOffsetCm} offset` : undefined, deltaDir: "up" },
          { label: "Needs work", value: `${worst.accuracyPct}%`, delta: worst.avgOffsetCm > 0 ? `${worst.avgOffsetCm} offset` : undefined, deltaDir: worst.accuracyPct < 55 ? "down" : "neutral" },
          { label: "Group avg",  value: `${avgPct}%` },
        ],
        cue: avgPct < 60
          ? `Group accuracy needs immediate attention (${avgPct}%). Start every session with 3×10 slow-speed target-lock reps before adding power. ${worst.name.split(" ")[0]} (${worst.accuracyPct}%) should work target isolation drills daily until above 65%.`
          : avgPct < 78
          ? `Accuracy is building. Introduce combination drills that require switching target zones mid-combo — this forces recalibration under fatigue.`
          : `Strong group accuracy (${avgPct}%). Challenge athletes with reduced target size or moving target sequences to push precision further.`,
      });
    }

    // ── 4. ACCURACY — from selected session ──────────────────────────────────
    if (sessionSummary && (sessionSummary.mode ?? "power").toLowerCase() === "accuracy") {
      const q      = sessionSummary.quality;
      const score  = q?.accuracy_pct ?? q?.score;
      const offset = q?.avg_offset_mm ?? (q?.avg_offset_cm != null ? q.avg_offset_cm * 10 : null);
      const events = sessionSummary.num_events ?? 0;
      const com    = sessionSummary.center_of_mass_mm;
      const comX   = com && typeof com === "object" && "x" in com ? Number(com.x) : null;
      const comY   = com && typeof com === "object" && "y" in com ? Number(com.y) : null;
      const biasTxt = comX != null && comY != null
        ? Math.abs(comX) > 15 ? `center-of-mass bias: ${comX > 0 ? "right" : "left"} (${Math.abs(comX).toFixed(0)} mm off-center)`
        : Math.abs(comY) > 15 ? `center-of-mass bias: ${comY > 0 ? "high" : "low"} (${Math.abs(comY).toFixed(0)} mm off-center)`
        : null : null;
      if (score != null) {
        out.push({
          tag: "Accuracy",
          priority: score < 60 ? "high" : score < 78 ? "medium" : "low",
          headline: `Session accuracy: ${Number(score).toFixed(1)}%${offset != null ? ` · avg offset ${Number(offset).toFixed(0)} mm` : ""}`,
          numbers: [
            { label: "Score",   value: `${Number(score).toFixed(1)}%`, deltaDir: score > 75 ? "up" : score < 55 ? "down" : "neutral" },
            ...(offset != null ? [{ label: "Avg offset", value: `${Number(offset).toFixed(0)} mm` }] : []),
            { label: "Strikes", value: `${events}` },
            ...(biasTxt ? [{ label: "Bias", value: biasTxt }] : []),
          ],
          cue: score < 55
            ? `Significant accuracy deficit. ${biasTxt ? `${biasTxt.charAt(0).toUpperCase() + biasTxt.slice(1)} — ` : ""}Slow the pace by 40%, lock eyes on target before initiating the strike, and only add speed once 3 consecutive hits land inside target zone.`
            : score < 78
            ? `Accuracy is moderate. ${biasTxt ? `Consistent ${biasTxt} — address with form correction.` : "Work target-entry angle — ensure elbow is driving toward center, not fanning."}`
            : `Excellent session accuracy. Push to higher difficulty: tighter target, longer combination, or reaction mode to maintain challenge.`,
        });
      }
    }

    // ── 5. REACTION — from reaction leaderboard ───────────────────────────────
    if (reactionRows.length > 0) {
      const best     = reactionRows[0];
      const slowest  = reactionRows[reactionRows.length - 1];
      const avgReact = Math.round(reactionRows.reduce((s, r) => s + r.avgReactionMs, 0) / reactionRows.length);
      const gapMs    = slowest.avgReactionMs - best.avgReactionMs;
      out.push({
        tag: "Reaction",
        priority: avgReact > 700 ? "high" : avgReact > 500 ? "medium" : "low",
        headline: `Avg group reaction: ${avgReact} ms · best: ${best.name.split(" ")[0]} at ${best.avgReactionMs} ms`,
        numbers: [
          { label: "Fastest avg",  value: `${best.avgReactionMs} ms`,    delta: `best ${best.bestReactionMs} ms`, deltaDir: "up" },
          { label: "Slowest avg",  value: `${slowest.avgReactionMs} ms`, deltaDir: slowest.avgReactionMs > 700 ? "down" : "neutral" },
          { label: "Group spread", value: `${gapMs} ms gap` },
          { label: "Attempts",     value: `${reactionRows.reduce((s, r) => s + r.attempts, 0)} total` },
        ],
        cue: avgReact > 700
          ? `Group reaction times are slow (${avgReact} ms avg). Focus on visual cue recognition drills — start with predictable signals, then introduce random delays. ${slowest.name.split(" ")[0]} (${slowest.avgReactionMs} ms) should work anticipation reduction: no pre-loading before the signal.`
          : avgReact > 500
          ? `Reaction times are developing. Introduce competitive pairs drill: athlete must beat their previous best each rep. Target sub-${Math.round(avgReact * 0.85)} ms avg for next session.`
          : `Strong reaction group (${avgReact} ms avg). Increase cognitive load — multi-target or color-coded cues — to push further improvement.`,
      });
    }

    // ── 6. REACTION — from selected session ──────────────────────────────────
    if (sessionSummary && (sessionSummary.mode ?? "power").toLowerCase() === "reaction") {
      const q        = sessionSummary.quality;
      const bestRt   = q?.best_reaction_ms;
      const avgRt    = q?.avg_reaction_ms;
      const attempts = q?.attempts ?? sessionSummary.num_events;
      if (avgRt != null) {
        const fatigueDelta = q?.reaction_fatigue_delta_ms ?? null;
        out.push({
          tag: "Reaction",
          priority: avgRt > 700 ? "high" : avgRt > 500 ? "medium" : "low",
          headline: `Session avg reaction: ${Math.round(avgRt)} ms · best: ${bestRt != null ? Math.round(bestRt) : "—"} ms`,
          numbers: [
            { label: "Avg",      value: `${Math.round(avgRt)} ms`, deltaDir: avgRt < 400 ? "up" : avgRt > 700 ? "down" : "neutral" },
            { label: "Best",     value: bestRt != null ? `${Math.round(bestRt)} ms` : "—", deltaDir: "up" },
            { label: "Attempts", value: attempts != null ? String(attempts) : "—" },
            ...(fatigueDelta != null ? [{ label: "Fatigue drift", value: `+${Math.round(fatigueDelta)} ms`, deltaDir: "down" as const }] : []),
          ],
          cue: avgRt > 700
            ? `Slow reaction session (${Math.round(avgRt)} ms avg). Check if athlete is anticipating — add unpredictable cue timing. Cue: stay loose, don't pre-tense.`
            : avgRt > 500
            ? `Moderate reaction time. Gap between best (${bestRt != null ? Math.round(bestRt) : "—"} ms) and average (${Math.round(avgRt)} ms) shows inconsistency. Drill: 3 consecutive sub-${Math.round(avgRt * 0.9)} ms responses before rest.`
            : `Excellent reaction session. Best rep: ${bestRt != null ? Math.round(bestRt) : "—"} ms — use this as the benchmark target going forward.`,
        });
      }
    }

    // ── 7. VOLUME — from group leaderboard ───────────────────────────────────
    if (volumeInsightRows.length > 0) {
      const best    = volumeInsightRows[0];
      const worst   = volumeInsightRows[volumeInsightRows.length - 1];
      const avgHits = Math.round(volumeInsightRows.reduce((s, r) => s + r.avgWindowHits, 0) / volumeInsightRows.length * 10) / 10;
      const fatiguingAthletes = volumeInsightRows.filter(r => r.avgSiFatigueSlope != null && r.avgSiFatigueSlope < -2);
      const hasFatigueAlert   = fatiguingAthletes.length > 0;
      out.push({
        tag: "Volume",
        priority: hasFatigueAlert ? "high" : avgHits < 6 ? "high" : avgHits < 10 ? "medium" : "low",
        headline: hasFatigueAlert
          ? `${fatiguingAthletes[0].name.split(" ")[0]} showing SI fatigue drop across windows`
          : `Group avg volume: ${avgHits} events/window · best: ${best.name.split(" ")[0]} at ${best.bestWindowHits}`,
        numbers: [
          { label: "Best avg/win",  value: `${best.avgWindowHits}`,  delta: best.name.split(" ")[0], deltaDir: "up" },
          { label: "Group avg/win", value: `${avgHits}`, deltaDir: avgHits >= 10 ? "up" : avgHits < 6 ? "down" : "neutral" },
          { label: "Lowest avg",    value: `${worst.avgWindowHits}`, delta: worst.name.split(" ")[0], deltaDir: worst.avgWindowHits < 6 ? "down" : "neutral" },
          ...(hasFatigueAlert ? [{ label: "SI slope", value: `${fatiguingAthletes[0].avgSiFatigueSlope} / win`, deltaDir: "down" as const }] : []),
        ],
        cue: hasFatigueAlert
          ? `${fatiguingAthletes.map(a => a.name.split(" ")[0]).join(", ")} ${fatiguingAthletes.length === 1 ? "is" : "are"} losing power across windows (slope: ${fatiguingAthletes[0].avgSiFatigueSlope} SI/window). Shorten windows to 4 s and add 30 s rest between — prioritise quality output per window over raw hit count.`
          : avgHits < 6
          ? `Low volume output (${avgHits} events/window avg). Athletes may be pacing themselves. Drill rapid 5-strike combos then rest — aim for 8+ events/window before adding resistance.`
          : `Good volume output. Push the group to sustain output in later windows — set a target of ${Math.round(avgHits * 0.9)} hits minimum in every window, including the last.`,
      });
    }

    // ── 8. VOLUME — from selected session ────────────────────────────────────
    if (sessionSummary && (sessionSummary.mode ?? "power").toLowerCase() === "volume") {
      const q         = sessionSummary.quality;
      const bestWin   = q?.best_window_hits  ?? null;
      const avgWin    = q?.avg_window_hits    ?? null;
      const totalWins = q?.total_windows      ?? null;
      const slope     = q?.si_fatigue_slope   ?? null;
      const siTrend   = q?.si_trend as "fatigue" | "building" | "stable" | undefined;
      if (avgWin != null) {
        const isFatiguing = siTrend === "fatigue" || (slope != null && slope < -2);
        out.push({
          tag: "Volume",
          priority: isFatiguing ? "high" : avgWin < 6 ? "high" : avgWin < 10 ? "medium" : "low",
          headline: `Volume session: ${avgWin} avg events/window · best window: ${bestWin ?? "—"}`,
          numbers: [
            { label: "Avg / window", value: `${avgWin}`, deltaDir: avgWin >= 10 ? "up" : avgWin < 6 ? "down" : "neutral" },
            { label: "Best window",  value: bestWin != null ? String(bestWin) : "—", deltaDir: "up" },
            ...(totalWins != null ? [{ label: "Windows", value: String(totalWins) }] : []),
            ...(slope != null ? [{ label: "SI slope", value: `${slope > 0 ? "+" : ""}${slope} / win`, deltaDir: (isFatiguing ? "down" : slope > 1 ? "up" : "neutral") as "up" | "down" | "neutral" }] : []),
          ],
          cue: isFatiguing
            ? `Power dropped across windows (SI slope ${slope != null ? slope : "negative"}). Athlete is reaching failure before session ends. Cut to 3 windows max, rest 45 s between, and rebuild endurance base over 2–3 weeks.`
            : avgWin < 6
            ? `Low volume (${avgWin} events/window). The athlete is pacing too conservatively. Cue all-out effort for each window — fatigue is expected, it's the point.`
            : siTrend === "building"
            ? `Output built across windows — great conditioning sign. Introduce a 6th window or tighten rest to 20 s to keep pushing adaptation.`
            : `Solid volume session. Next target: beat ${bestWin ?? avgWin} hits in at least two windows.`,
        });
      }
    }

    // ── 9. TARGET — from group leaderboard ───────────────────────────────────
    if (targetInsightRows.length > 0) {
      const best   = targetInsightRows[0];
      const worst  = targetInsightRows[targetInsightRows.length - 1];
      const avgAcc = Math.round(targetInsightRows.reduce((s, r) => s + r.avgAccuracyPct, 0) / targetInsightRows.length * 10) / 10;
      const rtRows = targetInsightRows.filter(r => r.avgReactionMsCorrect != null);
      const avgRt  = rtRows.length > 0 ? Math.round(rtRows.reduce((s, r) => s + (r.avgReactionMsCorrect ?? 0), 0) / rtRows.length) : null;
      out.push({
        tag: "Target",
        priority: avgAcc < 55 ? "high" : avgAcc < 72 ? "medium" : "low",
        headline: `Group target accuracy: ${avgAcc}% · best: ${best.name.split(" ")[0]} at ${best.avgAccuracyPct}%`,
        numbers: [
          { label: "Best",       value: `${best.avgAccuracyPct}%`,  delta: best.name.split(" ")[0], deltaDir: "up" },
          { label: "Needs work", value: `${worst.avgAccuracyPct}%`, delta: worst.name.split(" ")[0], deltaDir: worst.avgAccuracyPct < 55 ? "down" : "neutral" },
          { label: "Group avg",  value: `${avgAcc}%`, deltaDir: avgAcc >= 72 ? "up" : avgAcc < 55 ? "down" : "neutral" },
          ...(avgRt != null ? [{ label: "Avg RT (correct)", value: `${avgRt} ms` }] : []),
        ],
        cue: avgAcc < 55
          ? `Zone accuracy is critically low (${avgAcc}%). Athletes are reacting before processing the cue. Slow the signal interval to 3 s minimum and walk through each zone verbally before adding speed. ${worst.name.split(" ")[0]} (${worst.avgAccuracyPct}%) needs dedicated zone-recognition work before group drills.`
          : avgAcc < 72
          ? `Target accuracy is developing. Introduce combo cues (two consecutive zones) to force zone switching — this exposes gaps in spatial awareness faster than single-zone drills.`
          : `Strong group zone accuracy (${avgAcc}%). Progress to double-zone combos and mixed-speed cues.${avgRt != null ? ` Keep pushing RT — group avg correct reaction is ${avgRt} ms.` : ""}`,
      });
    }

    // ── 10. TARGET — from selected session ───────────────────────────────────
    if (sessionSummary && (sessionSummary.mode ?? "power").toLowerCase() === "target") {
      const q        = sessionSummary.quality;
      const accPct   = q?.target_accuracy_pct         ?? null;
      const attempts = q?.attempts                    ?? null;
      const correct  = q?.correct_hits                ?? null;
      const bestRt   = q?.best_reaction_ms_correct    ?? q?.best_reaction_ms ?? null;
      const avgRtC   = q?.avg_reaction_ms_correct     ?? null;
      const avgRtAll = q?.avg_reaction_ms_all          ?? null;
      if (accPct != null) {
        const rtSlow = avgRtC != null && avgRtC > 700;
        const accLow = Number(accPct) < 60;
        out.push({
          tag: "Target",
          priority: (accLow || rtSlow) ? "high" : Number(accPct) < 75 ? "medium" : "low",
          headline: `Target session: ${Number(accPct).toFixed(1)}% zone accuracy${avgRtC != null ? ` · ${Math.round(avgRtC)} ms avg RT` : ""}`,
          numbers: [
            { label: "Accuracy",       value: `${Number(accPct).toFixed(1)}%`, deltaDir: Number(accPct) >= 75 ? "up" : Number(accPct) < 60 ? "down" : "neutral" },
            { label: "Correct / Att",  value: correct != null && attempts != null ? `${correct} / ${attempts}` : "—" },
            ...(avgRtC  != null ? [{ label: "Avg RT (correct)", value: `${Math.round(avgRtC)} ms`, deltaDir: (avgRtC < 400 ? "up" : avgRtC > 700 ? "down" : "neutral") as "up" | "down" | "neutral" }] : []),
            ...(bestRt  != null ? [{ label: "Best RT",          value: `${Math.round(bestRt)} ms`, deltaDir: "up" as const }] : []),
            ...(avgRtAll != null && avgRtC != null && avgRtAll - avgRtC > 80
              ? [{ label: "RT penalty (wrong zone)", value: `+${Math.round(avgRtAll - avgRtC)} ms`, deltaDir: "down" as const }] : []),
          ],
          cue: accLow
            ? `Zone accuracy is critically low (${Number(accPct).toFixed(1)}%). Athlete may be reacting before fully processing the cue. Pause after each signal, verbally confirm the zone, then strike. Slow the cadence until accuracy exceeds 65%.`
            : rtSlow && avgRtC != null
            ? `Accuracy is solid but correct-zone reaction is slow (${Math.round(avgRtC)} ms). The processing-to-movement gap is the bottleneck. Drill shadow-movement on the cue (no contact) to isolate the cognitive step.`
            : Number(accPct) < 75
            ? `Good effort — accuracy at ${Number(accPct).toFixed(1)}%. ${avgRtAll != null && avgRtC != null && avgRtAll - avgRtC > 80 ? `The ${Math.round(avgRtAll - avgRtC)} ms RT penalty on wrong-zone hits shows zone confusion under pressure. ` : ""}Add 2-zone combo cues in the next session.`
            : `Excellent target session — accuracy and reaction both on point. Increase difficulty: shorten the cue-to-signal window or introduce a distractor cue before the real one.`,
        });
      }
    }

    // ── 11. CONSISTENCY — cadence + full mode spread ──────────────────────────
    if (recentSessions.length >= 3) {
      const last7days = recentSessions.filter(s =>
        (Date.now() - new Date(s.timestamp).getTime()) < 7 * 24 * 60 * 60 * 1000
      );
      const modeBreakdown: Record<string, number> = {};
      for (const s of recentSessions) {
        const m = (s.mode ?? "power").toLowerCase();
        modeBreakdown[m] = (modeBreakdown[m] ?? 0) + 1;
      }
      const total    = recentSessions.length;
      const powPct   = Math.round(((modeBreakdown["power"]    ?? 0) / total) * 100);
      const accPct   = Math.round(((modeBreakdown["accuracy"] ?? 0) / total) * 100);
      const reactPct = Math.round(((modeBreakdown["reaction"] ?? 0) / total) * 100);
      const volPct   = Math.round(((modeBreakdown["volume"]   ?? 0) / total) * 100);
      const tgtPct   = Math.round(((modeBreakdown["target"]   ?? 0) / total) * 100);

      // Detect longest gap between sessions (flag if > 10 days)
      const sortedDates = recentSessions
        .map(s => new Date(s.timestamp).getTime())
        .sort((a, b) => b - a);
      const maxGapDays = sortedDates.length >= 2
        ? Math.max(...sortedDates.slice(0, -1).map((d, i) => (d - sortedDates[i + 1]) / 86400000))
        : 0;

      const missingModes: string[] = [];
      if (volPct   === 0) missingModes.push("Volume");
      if (tgtPct   === 0) missingModes.push("Target");
      if (reactPct === 0) missingModes.push("Reaction");
      if (accPct   === 0) missingModes.push("Accuracy");

      out.push({
        tag: "Consistency",
        priority: (last7days.length === 0 || maxGapDays > 10) ? "high" : last7days.length < 2 ? "medium" : "low",
        headline: `${total} sessions logged · ${last7days.length} in the last 7 days`,
        numbers: [
          { label: "Power",    value: `${powPct}%`,   delta: `${modeBreakdown["power"]    ?? 0}`, deltaDir: "neutral" },
          { label: "Accuracy", value: `${accPct}%`,   delta: `${modeBreakdown["accuracy"] ?? 0}`, deltaDir: "neutral" },
          { label: "Reaction", value: `${reactPct}%`, delta: `${modeBreakdown["reaction"] ?? 0}`, deltaDir: "neutral" },
          { label: "Volume",   value: `${volPct}%`,   delta: `${modeBreakdown["volume"]   ?? 0}`, deltaDir: "neutral" },
          { label: "Target",   value: `${tgtPct}%`,   delta: `${modeBreakdown["target"]   ?? 0}`, deltaDir: "neutral" },
          { label: "Last 7d",  value: `${last7days.length} sessions`, deltaDir: last7days.length >= 3 ? "up" : last7days.length === 0 ? "down" : "neutral" },
        ],
        cue: last7days.length === 0
          ? `No sessions in the last 7 days — training has stalled. Re-engage with a light Power session to rebuild habit before adding intensity.`
          : maxGapDays > 10
          ? `There was a ${Math.round(maxGapDays)}-day gap in recent training. Consistency beats intensity — schedule at least 3 sessions per week.`
          : powPct > 80
          ? `Almost all sessions are Power (${powPct}%). Introduce ${missingModes.slice(0, 2).join(" and ")} sessions — a balanced mix builds more complete athletes.`
          : missingModes.length > 0
          ? `Good session cadence. Consider adding ${missingModes.join(" and ")} mode${missingModes.length > 1 ? "s" : ""} to round out training stimulus.`
          : `Well-balanced training mix across all modes. Maintain the cadence and start tracking trends across session types.`,
      });
    }

    if (out.length === 0) {
      out.push({
        tag: "Consistency",
        priority: "medium",
        headline: "No session data yet",
        numbers: [],
        cue: "Record your first session to start generating data-driven coaching insights. Connect a device, run a Power session, and come back here to see power, accuracy, and tempo breakdowns.",
      });
    }

    return out.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
  }, [strengthRows, accuracyRows, reactionRows, volumeInsightRows, targetInsightRows, recentSessions, sessionSummary]);

  // ---------- Theme awareness ----------
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme") !== "light"
      : true
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setIsDark(el.getAttribute("data-theme") !== "light");
    });
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // ---------- Recent Sessions filters ----------
  const [sessionModeFilter, setSessionModeFilter] = useState<string>("all");
  const [sessionAthleteFilter, setSessionAthleteFilter] = useState<string>("all");
  const [sessionPage, setSessionPage] = useState(0);
  const SESSION_PAGE_SIZE = 10;

  // Jump from any leaderboard row to the Recent Sessions tab,
  // pre-filtered to that athlete. The tab wrapper has a keyed
  // fade/slide animation that runs automatically on tab change.
  const goToSessionsForAthlete = useCallback((name: string) => {
    const clean = (name ?? "").trim();
    if (!clean) return;
    setSessionAthleteFilter(clean);
    setSessionModeFilter("all");
    setSessionPage(0);
    setActiveTab("recent");
    // Defer scroll until after the tab content mounts so we don't
    // jump before the new panel is laid out.
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  }, []);

  // Athletes who appear in recentSessions (for the athlete filter dropdown)
  const sessionAthletes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of recentSessions) {
      const key = `${s.athleteFirstName} ${s.athleteLastName}`.trim();
      if (key && key !== "— " && key !== "—") seen.set(key, key);
    }
    return Array.from(seen.values()).sort();
  }, [recentSessions]);

  const [analysisAthleteId, setAnalysisAthleteId]     = useState<string | null>(null);
  const [analysisAthleteName, setAnalysisAthleteName] = useState<string>("—");
  const [analysisSessions, setAnalysisSessions]       = useState<AthleteSessionRow[]>([]);
  const [analysisLoading, setAnalysisLoading]         = useState(false);
  const [analysisSection, setAnalysisSection]         = useState<"power" | "accuracy" | "reaction" | "form">("power");
  const [radarWindow, setRadarWindow]                  = useState<"30d" | "90d" | "all">("30d");

  // Ref for scrolling to the In-Depth Analysis card
  const analysisCardRef = useRef<HTMLDivElement>(null);

  // Popover state — which session avatar is hovered + pointer position
  const [avatarPopover, setAvatarPopover] = useState<{ sessionId: string; x: number; y: number } | null>(null);

  // Athlete list for the analysis dropdown — pulled from the athletes state (loaded when athletes tab visited)
  // but also enriched from recentSessions so it works even before the athletes tab is visited
  const analysisAthleteOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    // From the full athletes list (if loaded)
    for (const a of athletes) {
      map.set(a.id, { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [athletes]);

  // Fetch all sessions for the selected athlete whenever analysisAthleteId changes
  useEffect(() => {
    if (!analysisAthleteId || !programId || !supabase) return;
    setAnalysisLoading(true);
    setAnalysisSessions([]);

    (async () => {
      try {
        const { data: analysisRows, error } = await fetchSessionRows({
          athleteIds: [analysisAthleteId],
        });

        if (error) throw error;
        // Oldest-first for the per-axis trend maths further down.
        const data = (analysisRows ?? []).sort((a: any, b: any) =>
          String(a.date_of_record ?? "").localeCompare(String(b.date_of_record ?? "")));
        setAnalysisSessions(
          (data ?? []).map((r: any) => ({
            session_id:         r.session_id,
            date_of_record:     r.date_of_record ?? "",
            mode:               r.mode ?? "power",
            num_events:         r.num_events ?? null,
            session_duration_ms: r.session_duration_ms ?? null,
            cadence_hz_avg:     r.cadence_hz_avg ?? null,
            peak_force_stats:   r.peak_force_stats ?? null,
            quality:            r.quality ?? null,
            angles_deg:         r.angles_deg ?? null,
            iei_ms:             r.iei_ms ?? null,
          }))
        );
      } catch { /* silent */ } finally {
        setAnalysisLoading(false);
      }
    })();
  }, [analysisAthleteId, programId]);

  // Derive metrics from analysisSessions
  const athleteAnalysis = useMemo(() => {
    if (!analysisSessions.length) return null;

    const stdSessions  = analysisSessions.filter(s => s.mode.toLowerCase() === "power");
    const accSessions  = analysisSessions.filter(s => s.mode.toLowerCase() === "accuracy");
    const reactSessions= analysisSessions.filter(s => s.mode.toLowerCase() === "reaction");

    // ── Strength trend (standard sessions, chronological) ──────────────────
    const strengthTrend = stdSessions.map(s => {
      const si = s.quality?.strength_index;
      if (si?.max != null)  return { date: s.date_of_record, peak: Math.round(si.max), avg: Math.round(si.mean ?? si.max) };
      const pfs = s.peak_force_stats;
      const peakMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? pfs.peak_v * 1000 : null);
      const avgMv  = pfs?.avg_mv  ?? (pfs?.avg_v  != null ? pfs.avg_v  * 1000 : null);
      if (peakMv == null) return null;
      return { date: s.date_of_record, peak: Math.round((peakMv / 3320) * 1000), avg: avgMv != null ? Math.round((avgMv / 3320) * 1000) : null };
    }).filter(Boolean) as { date: string; peak: number; avg: number | null }[];

    // ── Consistency score (peak-to-avg ratio across standard sessions) ──────
    const consistencyPct = strengthTrend.length > 0
      ? Math.round(strengthTrend.reduce((s, r) => s + (r.avg != null && r.peak > 0 ? r.avg / r.peak : 0), 0) / strengthTrend.length * 100)
      : null;

    // ── Fatigue proxy — compare first half vs second half strength of stdSessions ──
    let fatigueNote: string | null = null;
    if (strengthTrend.length >= 4) {
      const half = Math.floor(strengthTrend.length / 2);
      const earlyAvg = strengthTrend.slice(0, half).reduce((s, r) => s + r.peak, 0) / half;
      const lateAvg  = strengthTrend.slice(-half).reduce((s, r) => s + r.peak, 0) / half;
      const delta    = Math.round(lateAvg - earlyAvg);
      fatigueNote = delta > 30 ? `+${delta} pts trend up` : delta < -30 ? `${delta} pts trend down` : "stable across sessions";
    }

    // ── Cadence trend (standard sessions) ──────────────────────────────────
    const cadenceTrend = stdSessions
      .filter(s => s.cadence_hz_avg != null)
      .map(s => ({ date: s.date_of_record, hz: Number(s.cadence_hz_avg) }));

    // ── Accuracy metrics ────────────────────────────────────────────────────
    const accMetrics = accSessions.map(s => {
      const score  = s.quality?.accuracy_pct ?? s.quality?.score ?? null;
      const offset = s.quality?.avg_offset_mm ?? (s.quality?.avg_offset_cm != null ? s.quality.avg_offset_cm * 10 : null);
      return score != null ? { date: s.date_of_record, score: Number(score), offset: offset != null ? Number(offset) : null } : null;
    }).filter(Boolean) as { date: string; score: number; offset: number | null }[];

    const latestAccScore  = accMetrics.length > 0 ? accMetrics[accMetrics.length - 1].score  : null;
    const earliestAccScore = accMetrics.length > 1 ? accMetrics[0].score : null;
    const accDrift = latestAccScore != null && earliestAccScore != null ? Math.round(latestAccScore - earliestAccScore) : null;

    // ── Reaction metrics ────────────────────────────────────────────────────
    const reactMetrics = reactSessions.map(s => {
      const avgRt  = s.quality?.avg_reaction_ms  ?? null;
      const bestRt = s.quality?.best_reaction_ms ?? null;
      return avgRt != null ? { date: s.date_of_record, avg: Math.round(avgRt), best: bestRt != null ? Math.round(bestRt) : null } : null;
    }).filter(Boolean) as { date: string; avg: number; best: number | null }[];

    const latestReactAvg   = reactMetrics.length > 0 ? reactMetrics[reactMetrics.length - 1].avg  : null;
    const earliestReactAvg = reactMetrics.length > 1  ? reactMetrics[0].avg : null;
    const reactDrift = latestReactAvg != null && earliestReactAvg != null ? Math.round(latestReactAvg - earliestReactAvg) : null; // negative = improvement

    // ── Angle bias ──────────────────────────────────────────────────────────
    const angleReadings = analysisSessions
      .map(s => s.angles_deg?.mean ?? s.angles_deg?.avg ?? null)
      .filter((v): v is number => v != null);
    const avgAngle = angleReadings.length > 0 ? angleReadings.reduce((a, b) => a + b, 0) / angleReadings.length : null;

    // ── Mode breakdown ──────────────────────────────────────────────────────
    const total     = analysisSessions.length;
    const stdCount  = stdSessions.length;
    const accCount  = accSessions.length;
    const reactCount= reactSessions.length;

    // ── Volume ──────────────────────────────────────────────────────────────
    const totalEvents = analysisSessions.reduce((s, r) => s + (r.num_events ?? 0), 0);
    const totalDurMs  = analysisSessions.reduce((s, r) => s + (r.session_duration_ms ?? 0), 0);

    return {
      total, stdCount, accCount, reactCount,
      totalEvents, totalDurMs,
      strengthTrend, consistencyPct, fatigueNote,
      cadenceTrend,
      accMetrics, latestAccScore, accDrift,
      reactMetrics, latestReactAvg, reactDrift,
      avgAngle,
    };
  }, [analysisSessions]);

  // Trigger athletes fetch when analysis athlete dropdown opens (athletes may not be loaded yet)
  useEffect(() => {
    if (!programId || !supabase || athletes.length > 0) return;
    supabase!
      .from("athletes")
      .select("id, first_name, last_name, height, weight, sport, position")
      .eq("program_id", programId)
      .order("last_name")
      .then(({ data }) => { if (data) setAthletes(data as any); });
  }, [programId, athletes.length]);

  const filteredSessions = useMemo(() => {
    setSessionPage(0);
    return recentSessions.filter((s) => {
      const modeMatch = sessionModeFilter === "all" || (s.mode ?? "power").toLowerCase() === sessionModeFilter;
      const athleteName = `${s.athleteFirstName} ${s.athleteLastName}`.trim();
      const athleteMatch = sessionAthleteFilter === "all" || athleteName === sessionAthleteFilter;
      return modeMatch && athleteMatch;
    });
  }, [recentSessions, sessionModeFilter, sessionAthleteFilter]);

  const totalSessionPages = Math.ceil(filteredSessions.length / SESSION_PAGE_SIZE);
  const pagedSessions = filteredSessions.slice(
    sessionPage * SESSION_PAGE_SIZE,
    (sessionPage + 1) * SESSION_PAGE_SIZE
  );
  const [athleteImprovedMetric, setAthleteImprovedMetric] = useState<MetricKey>("strength");
  const [athleteImprovedRows,   setAthleteImprovedRows]   = useState<AthleteImprovedRow[]>([]);
  const [athleteImprovedLoading,setAthleteImprovedLoading]= useState(false);

  useEffect(() => {
    if (!programId || !supabase) return;
    setAthleteImprovedLoading(true);
    setAthleteImprovedRows([]);

    (async () => {
      try {
        const isForm = athleteImprovedMetric === "form";
        const modeFilter = athleteImprovedMetric === "strength" ? "power"
                         : athleteImprovedMetric === "form"     ? null  // all modes
                         : athleteImprovedMetric;

        const { data: improvedRows } = await fetchSessionRows({
          mode: modeFilter,
          rangeDays: leaderRangeDays,
        });

        // Oldest-first: Most Improved compares the first half of each
        // athlete's history against the last.
        const data = (improvedRows ?? [])
          .filter((r: any) => r.athlete_id)
          .sort((a: any, b: any) =>
            String(a.date_of_record ?? "").localeCompare(String(b.date_of_record ?? "")));
        if (!data.length) return;

        // Group by athlete
        const byAthlete = new Map<string, { name: string; vals: number[] }>();
        for (const row of data as any[]) {
          const id = row.athlete_id;
          if (!id) continue;
          const name = athleteNameOf(row, "Unknown");
          let val: number | null = null;
          if (athleteImprovedMetric === "strength") {
            const si = row.quality?.strength_index;
            if (si?.max != null) val = Math.round(si.max);
            else { const pMv = row.peak_force_stats?.peak_mv ?? null; if (pMv != null) val = Math.round((pMv / 3320) * 1000); }
          } else if (athleteImprovedMetric === "accuracy") {
            val = row.quality?.accuracy_pct ?? row.quality?.score ?? null;
            if (val != null) val = Math.round(Number(val) * 10) / 10;
          } else if (athleteImprovedMetric === "reaction") {
            val = row.quality?.avg_reaction_ms ?? null;
            if (val != null) val = Math.round(val);
          } else {
            // form: use abs(angle) — improvement = abs moving toward 0
            const angle = row.angles_deg?.mean ?? row.angles_deg?.avg ?? null;
            if (angle != null) val = Math.round(Math.abs(Number(angle)) * 10) / 10;
          }
          if (val == null) continue;
          if (!byAthlete.has(id)) byAthlete.set(id, { name, vals: [] });
          byAthlete.get(id)!.vals.push(val);
        }

        const improved: AthleteImprovedRow[] = [];
        for (const [athleteId, { name, vals }] of byAthlete) {
          if (vals.length < 4) continue;
          const half  = Math.floor(vals.length / 2);
          const early = vals.slice(0, half).reduce((s, v) => s + v, 0) / half;
          const late  = vals.slice(-half).reduce((s, v) => s + v, 0) / half;
          // form & reaction: lower = better, so delta = early - late (positive = improved)
          const delta = (athleteImprovedMetric === "reaction" || athleteImprovedMetric === "form")
            ? Math.round((early - late) * 10) / 10
            : Math.round(late - early);
          improved.push({ athleteId, name, metric: athleteImprovedMetric, delta, from: Math.round(early * 10) / 10, to: Math.round(late * 10) / 10, sessions: vals.length });
        }
        improved.sort((a, b) => b.delta - a.delta);
        setAthleteImprovedRows(improved.slice(0, 5));
      } finally {
        setAthleteImprovedLoading(false);
      }
    })();
  }, [programId, athleteImprovedMetric, leaderRangeDays]);

  const [chartMetric,      setChartMetric]      = useState<ChartMetric>("strength");
  const [compareMode,      setCompareMode]       = useState<CompareMode>("athlete-athlete");
  const [chartEntityA,     setChartEntityA]      = useState<ChartEntity | null>(null);
  const [chartEntityB,     setChartEntityB]      = useState<ChartEntity | null>(null);
  const [chartDataA,       setChartDataA]        = useState<WeekPoint[]>([]);
  const [chartDataB,       setChartDataB]        = useState<WeekPoint[]>([]);
  const [chartLoadingA,    setChartLoadingA]     = useState(false);
  const [chartLoadingB,    setChartLoadingB]     = useState(false);
  const [chartHoverIdx,    setChartHoverIdx]     = useState<number | null>(null);

  // Derive entity options based on compareMode
  const chartAthleteOptions = useMemo<ChartEntity[]>(() =>
    athletes.map(a => ({ kind: "athlete" as EntityKind, id: a.id, label: `${a.first_name} ${a.last_name}`.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [athletes]
  );
  const chartTeamOptions = useMemo<ChartEntity[]>(() => {
    const core = teams
      .filter(t => t.team_type === "core")
      .map(t => ({ kind: "team" as EntityKind, id: t.id, label: t.name, teamType: "core" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const sub = teams
      .filter(t => t.team_type !== "core")
      .map(t => ({ kind: "team" as EntityKind, id: t.id, label: t.name, teamType: "sub" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...core, ...sub];
  }, [teams]);

  function chartEntityOptionsFor(slot: "A" | "B"): ChartEntity[] {
    if (compareMode === "athlete-athlete") return chartAthleteOptions;
    if (compareMode === "team-team")       return chartTeamOptions;
    // athlete-team: A = athlete, B = team
    return slot === "A" ? chartAthleteOptions : chartTeamOptions;
  }

  // Fetch data for a single entity + metric → weekly aggregated points
  async function fetchChartData(entity: ChartEntity, metric: ChartMetric): Promise<WeekPoint[]> {
    if (!supabase || !programId) return [];

    // For sub-teams: resolve athlete IDs from team_members first
    let athleteIds: string[] | null = null;
    const teamInfo = entity.kind === "team" ? teams.find(t => t.id === entity.id) : null;
    const isSubTeam = teamInfo != null && teamInfo.team_type !== "core";

    if (isSubTeam) {
      const { data: members } = await supabase
        .from("team_members")
        .select("athlete_id")
        .eq("team_id", entity.id)
        .not("athlete_id", "is", null);
      athleteIds = (members ?? []).map((m: any) => m.athlete_id).filter(Boolean);
      if (athleteIds.length === 0) return [];
    }

    // Scope this entity within the tier-scoped result. An athlete and a
    // sub-team both narrow by athlete id; a core team narrows by team id.
    const modeFilter =
      metric === "strength" ? "power" :
      metric === "accuracy" ? "accuracy" :
      metric === "reaction" ? "reaction" : null;

    const { data: chartRows, error } = await fetchSessionRows({
      mode: modeFilter,
      athleteIds:
        entity.kind === "athlete" ? [entity.id] : (isSubTeam ? athleteIds : null),
      coreTeamId: entity.kind === "team" && !isSubTeam ? entity.id : null,
    });
    if (error || !chartRows) return [];

    // Oldest-first so the weekly buckets below build in order.
    const data = chartRows.sort((a: any, b: any) =>
      String(a.date_of_record ?? "").localeCompare(String(b.date_of_record ?? "")));

    // Group into ISO weeks and aggregate
    const weekMap = new Map<string, number[]>();
    for (const row of data as any[]) {
      const d = new Date(row.date_of_record ?? 0);
      // ISO week key: YYYY-WW
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
      const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

      let val: number | null = null;
      if (metric === "strength") {
        const si = row.quality?.strength_index;
        if (si?.max != null) val = Math.round(si.max);
        else {
          const pfs = row.peak_force_stats;
          const peakMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? pfs.peak_v * 1000 : null);
          if (peakMv != null) val = Math.round((peakMv / 3320) * 1000);
        }
      } else if (metric === "accuracy") {
        val = row.quality?.accuracy_pct ?? row.quality?.score ?? null;
        if (val != null) val = Math.round(Number(val) * 10) / 10;
      } else if (metric === "reaction") {
        val = row.quality?.avg_reaction_ms ?? null;
        if (val != null) val = Math.round(val);
      } else if (metric === "volume") {
        val = row.num_events ?? 0;
      }

      if (val != null) {
        if (!weekMap.has(key)) weekMap.set(key, []);
        weekMap.get(key)!.push(val);
      }
    }

    // Average within each week, sort chronologically
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, vals]) => ({
        week,
        value: metric === "volume"
          ? vals.reduce((s, v) => s + v, 0)           // sum for volume
          : Math.round(vals.reduce((s, v) => s + v, 0) / vals.length), // avg for others
      }));
  }

  // Re-fetch when entity or metric changes
  useEffect(() => {
    if (!chartEntityA) { setChartDataA([]); return; }
    setChartLoadingA(true);
    fetchChartData(chartEntityA, chartMetric)
      .then(setChartDataA)
      .finally(() => setChartLoadingA(false));
  }, [chartEntityA, chartMetric, programId]);

  useEffect(() => {
    if (!chartEntityB) { setChartDataB([]); return; }
    setChartLoadingB(true);
    fetchChartData(chartEntityB, chartMetric)
      .then(setChartDataB)
      .finally(() => setChartLoadingB(false));
  }, [chartEntityB, chartMetric, programId]);

  // Reset selections when compare mode changes
  useEffect(() => {
    setChartEntityA(null);
    setChartEntityB(null);
    setChartDataA([]);
    setChartDataB([]);
  }, [compareMode]);

  // Ensure teams + athletes are loaded when charts section is visible
  useEffect(() => {
    if (!programId || !supabase) return;
    if (athletes.length === 0) {
      supabase!.from("athletes").select("id, first_name, last_name, height, weight, sport, position")
        .eq("program_id", programId).order("last_name")
        .then(({ data }) => { if (data) setAthletes(data as any); });
    }
    if (teams.length === 0) {
      supabase!.from("teams")
        .select("id, name, team_type, parent_team_id, created_by, program_id, team_members(athlete_id)")
        .eq("program_id", programId).order("name")
        .then(({ data }) => {
          if (data) setTeams((data as any[]).map((t: any) => ({
            ...t,
            member_count: (t.team_members ?? []).filter((m: any) => m.athlete_id !== null).length,
            team_members: undefined,
          })));
        });
    }
  }, [programId, athletes.length, teams.length]);

  return {
    navigate,
    ent,
    retained,
    activeTab,
    setActiveTab,
    showCreateAthlete,
    setShowCreateAthlete,
    editAthleteTarget,
    setEditAthleteTarget,
    showCreateTeam,
    setShowCreateTeam,
    selectedTeam,
    setSelectedTeam,
    showEditProfile,
    setShowEditProfile,
    showProgram,
    setShowProgram,
    profile,
    setProfile,
    programId,
    userRole,
    coreTeamId,
    currentUserId,
    athletes,
    setAthletes,
    athletesLoading,
    setAthletesLoading,
    athletesError,
    athleteFilter,
    setAthleteFilter,
    athleteProgressMap,
    athleteProgressLoading,
    athleteModeStatsMap,
    teams,
    setTeams,
    teamsLoading,
    teamsError,
    hits,
    series,
    recentSessions,
    recentSessionsLoading,
    recentSessionsError,
    selectedSessionId,
    setSelectedSessionId,
    heatmapCells,
    replayEvents,
    heatmapLoading,
    sessionSummary,
    heatmapViewMode,
    setHeatmapViewMode,
    replayTimeMs,
    activeEventIdx,
    isReplaying,
    replaySpeed,
    setReplaySpeed,
    heatmapRipples,
    scheduleFrom,
    startReplay,
    pauseReplay,
    resumeReplay,
    resetReplay,
    seekTo,
    replayHeatmap,
    maxReplayHits,
    activeEvent,
    modeAccent,
    modeGlow,
    pressureToColor,
    pressureToGlow,
    summaryStats,
    formatSessionTime,
    insights,
    leaderDateRange,
    setLeaderDateRange,
    availableRanges,
    leaderMetric,
    setLeaderMetric,
    strengthRows,
    reactionRows,
    accuracyRows,
    volumeInsightRows,
    targetInsightRows,
    strengthLoading,
    reactionLoading,
    accuracyLoading,
    teamLeaderMetric,
    setTeamLeaderMetric,
    teamLeaderRows,
    teamLeaderLoading,
    teamImprovedMetric,
    setTeamImprovedMetric,
    teamImprovedRows,
    teamImprovedLoading,
    coachInsights,
    isDark,
    sessionModeFilter,
    setSessionModeFilter,
    sessionAthleteFilter,
    setSessionAthleteFilter,
    sessionPage,
    setSessionPage,
    SESSION_PAGE_SIZE,
    goToSessionsForAthlete,
    sessionAthletes,
    analysisAthleteId,
    setAnalysisAthleteId,
    analysisAthleteName,
    setAnalysisAthleteName,
    analysisSessions,
    setAnalysisSessions,
    analysisLoading,
    analysisSection,
    setAnalysisSection,
    radarWindow,
    setRadarWindow,
    analysisCardRef,
    avatarPopover,
    setAvatarPopover,
    analysisAthleteOptions,
    athleteAnalysis,
    filteredSessions,
    totalSessionPages,
    pagedSessions,
    athleteImprovedMetric,
    setAthleteImprovedMetric,
    athleteImprovedRows,
    athleteImprovedLoading,
    chartMetric,
    setChartMetric,
    compareMode,
    setCompareMode,
    chartEntityA,
    setChartEntityA,
    chartEntityB,
    setChartEntityB,
    chartDataA,
    chartDataB,
    chartLoadingA,
    chartLoadingB,
    chartHoverIdx,
    setChartHoverIdx,
    chartEntityOptionsFor,
  };
}
