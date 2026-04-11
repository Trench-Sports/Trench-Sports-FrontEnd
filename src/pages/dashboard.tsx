// src/pages/dashboard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProfileHeader, { Profile } from "../components/profileHeader";
import CreateAthleteModal from "../components/createAthlete";
import EditAthleteModal from "../components/editAthlete";
import EditProfileModal from "../components/editProfile";
import ProgramModal from "../components/program";
import ManageTeamModal from "../components/manageTeam";
import { supabase } from "../supabaseClient";
import StrikeCompass from "../components/strikeCompass";

type Insight = { title: string; body: string; tag: "Power" | "Accuracy" | "Tempo" | "Recovery" };

type RecentSession = {
  id: string;
  timestamp: string;
  mode: string;
  athleteFirstName: string;
  athleteLastName: string;
  athleteId: string | null;
};

type HeatmapCell = { r: number; c: number; intensity: number }; // intensity 0–1

// One event as fetched from the events table — groups all cells hit in that frame
type ReplayCell  = { r: number; c: number; mv: number };
type ReplayEvent = {
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

type SessionSummaryData = {
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

type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  height: string | null;
  weight: string | null;
  sport: string | null;
  position: string | null;
};

type Team = {
  id: string;
  name: string;
  team_type: string;
  parent_team_id: string | null;
  created_by: string | null;
  program_id: string;
  member_count?: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}


type TabKey = "recent" | "insights" | "athletes";
type MetricKey = "strength" | "reaction" | "accuracy" | "form" | "volume" | "target";

type LeaderRow =
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

export default function Dashboard() {
  const navigate = useNavigate();

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

      // For coaches, find their core team so we can scope session queries
      let coachCoreTeamId: string | null = null;
      if (role === "coach") {
        const { data: memberRow } = await supabase!
          .from("team_members")
          .select("team_id, teams!inner(team_type)")
          .eq("coach_user_id", user.id)
          .eq("teams.team_type", "core")
          .maybeSingle();
        coachCoreTeamId = (memberRow as any)?.team_id ?? null;
      }

      setProgramId(pid);
      setUserRole(role);
      setCoreTeamId(coachCoreTeamId);
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
    // Coaches must have their core team resolved before we can scope the query
    if (userRole === "coach" && coreTeamId === null) return;

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
  }, [activeTab, programId, userRole, coreTeamId]);

  // ---------- Athlete progress badges ----------
  type AthleteProgress = {
    trend:   "up" | "stable" | "down";
    delta:   number;
    metric:  "strength" | "accuracy" | "reaction" | "targetAccuracy" | "targetReaction";
    unit:    string;
    sessions: number;
  };
  const [athleteProgressMap, setAthleteProgressMap] = useState<Map<string, AthleteProgress>>(new Map());
  const [athleteProgressLoading, setAthleteProgressLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "athletes" || !programId || !userRole || !supabase) return;
    // Coaches must have their core team resolved before we can scope the query
    if (userRole === "coach" && coreTeamId === null) return;

    setAthleteProgressLoading(true);

    (async () => {
      try {
        // Fetch all sessions across all three modes in one round-trip
        let progressQuery = supabase!
          .from("session_summaries")
          .select("athlete_id, date_of_record, mode, quality, peak_force_stats")
          .eq("program_id", programId!)
          .not("athlete_id", "is", null)
          .order("date_of_record", { ascending: true });

        // Coaches are scoped to their core team; admins see the whole program
        if (userRole === "coach" && coreTeamId) {
          progressQuery = progressQuery.eq("core_team_id", coreTeamId);
        }

        const { data } = await progressQuery;

        if (!data) return;

        // Group by athlete → mode → vals[]
        type ModeVals = { strength: number[]; accuracy: number[]; reaction: number[]; targetAccuracy: number[]; targetReaction: number[] };
        const byAthlete = new Map<string, ModeVals>();

        for (const row of data as any[]) {
          const id   = row.athlete_id;
          const mode = (row.mode ?? "power").toLowerCase();
          if (!id) continue;

          if (!byAthlete.has(id)) byAthlete.set(id, { strength: [], accuracy: [], reaction: [], targetAccuracy: [], targetReaction: [] });
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
          }
        }

        // Compute progress per athlete — pick metric with most sessions (≥4)
        const progressMap = new Map<string, AthleteProgress>();

        for (const [athleteId, modes] of byAthlete) {
          // Pick the metric with the most sessions that has ≥4 data points
          const candidates: { metric: "strength" | "accuracy" | "reaction" | "targetAccuracy" | "targetReaction"; vals: number[]; unit: string; lowerIsBetter: boolean }[] = [
            { metric: "strength",       vals: modes.strength,       unit: "pts", lowerIsBetter: false },
            { metric: "accuracy",       vals: modes.accuracy,       unit: "%",   lowerIsBetter: false },
            { metric: "reaction",       vals: modes.reaction,       unit: "ms",  lowerIsBetter: true  },
            { metric: "targetAccuracy", vals: modes.targetAccuracy, unit: "%",   lowerIsBetter: false },
            { metric: "targetReaction", vals: modes.targetReaction, unit: "ms",  lowerIsBetter: true  },
          ].filter(c => c.vals.length >= 4).sort((a, b) => b.vals.length - a.vals.length);

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
    // Coaches must have their core team resolved before we can scope the query
    if (userRole === "coach" && coreTeamId === null) return;

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
    // Coaches must have their core team resolved before we can scope the query
    if (userRole === "coach" && coreTeamId === null) return;

    async function fetchRecentSessions() {
      setRecentSessionsLoading(true);
      setRecentSessionsError("");
      try {
        let query = supabase!
          .from("session_summaries")
          .select("session_id, date_of_record, mode, athlete_id, athletes(first_name, last_name)")
          .eq("program_id", programId!)
          .order("date_of_record", { ascending: false });

        // Coaches are scoped to their core team; admins see the whole program
        if (userRole === "coach" && coreTeamId) {
          query = query.eq("core_team_id", coreTeamId);
        }

        const { data, error } = await query;
        if (error) throw error;

        setRecentSessions(
          (data ?? []).map((row: any) => ({
            id: row.session_id,
            timestamp: row.date_of_record ?? "",
            mode: row.mode ?? "Power",
            athleteFirstName: row.athletes?.first_name ?? "—",
            athleteLastName: row.athletes?.last_name ?? "",
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
  }, [programId, userRole, coreTeamId]);

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
        // 1. Grab the full summary row
        const { data: summary } = await supabase!
          .from("session_summaries")
          .select("heatmap, mode, num_events, session_duration_ms, peak_force_stats, impulse_stats, duration_ms_stats, angles_deg, most_contacted_cell_rc, center_of_mass_mm, cadence_hz_avg, iei_ms, quality")
          .eq("session_id", selectedSessionId!)
          .maybeSingle();

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

        // 2. Fetch ordered events with all cells — grouped per event for true-time replay
        const { data: events } = await supabase!
          .from("events")
          .select("event_id, t_start_ms, strength_index, temporal, impulse_index, rise_time_ms, duration_ms, angle_deg, reaction_time_ms, accuracy, event_cells(r, c, v_min)")
          .eq("session_id", selectedSessionId!)
          .order("t_start_ms", { ascending: true });

        if (events && events.length > 0) {
          const tZero: number = (events[0] as any).t_start_ms ?? 0;
          const replayEvs: ReplayEvent[] = (events as any[]).map(ev => ({
            eventId:    ev.event_id,
            tMs:        (ev.t_start_ms ?? tZero) - tZero,
            cells:      (ev.event_cells ?? []).map((c: any) => ({
              r:  c.r,
              c:  c.c,
              mv: Math.round((c.v_min ?? 0) * 1000),
            })),
            si:         ev.strength_index?.value ?? null,
            cellCount:  ev.temporal?.cell_count  ?? (ev.event_cells?.length ?? 0),
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

  type SummaryStatItem = { label: string; value: string; accent?: boolean };

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

  // ---------- Leaderboard ----------
  type LeaderDateRange = 7 | 30 | 90 | "all";
  const [leaderDateRange, setLeaderDateRange] = useState<LeaderDateRange>(30);
  const leaderCutoff = useMemo<string | null>(() => {
    if (leaderDateRange === "all") return null;
    const d = new Date();
    d.setDate(d.getDate() - leaderDateRange);
    return d.toISOString();
  }, [leaderDateRange]);

  const [leaderMetric, setLeaderMetric] = useState<MetricKey>("strength");
  const [strengthRows, setStrengthRows] = useState<Extract<LeaderRow, { metric: "strength" }>[]>([]);
  const [reactionRows, setReactionRows] = useState<Extract<LeaderRow, { metric: "reaction" }>[]>([]);
  const [accuracyRows, setAccuracyRows] = useState<Extract<LeaderRow, { metric: "accuracy" }>[]>([]);

  // ---------- Volume leaderboard (insights only) ----------
  type VolumeInsightRow = {
    athleteId: string;
    name: string;
    avgWindowHits: number;
    bestWindowHits: number;
    avgSiFatigueSlope: number | null;
    avgSi: number | null;
    sessions: number;
    numEvents: number;
  };
  const [volumeInsightRows, setVolumeInsightRows] = useState<VolumeInsightRow[]>([]);

  // ---------- Target leaderboard (insights only) ----------
  type TargetInsightRow = {
    athleteId: string;
    name: string;
    avgAccuracyPct: number;
    avgReactionMsCorrect: number | null;
    attempts: number;
    sessions: number;
  };
  const [targetInsightRows, setTargetInsightRows] = useState<TargetInsightRow[]>([]);

  // Single loading flag covering all five leaderboard queries
  const [strengthLoading, setStrengthLoading] = useState(false);
  const reactionLoading  = strengthLoading;
  const accuracyLoading  = strengthLoading;

  // ---------- Leaderboard — all five modes in one Promise.all ----------
  useEffect(() => {
    if (!programId || !userRole || !supabase) return;
    if (userRole === "coach" && coreTeamId === null) return;

    setStrengthLoading(true);
    setStrengthRows([]);
    setReactionRows([]);
    setAccuracyRows([]);
    setVolumeInsightRows([]);
    setTargetInsightRows([]);

    // Build all five queries with their filters applied
    let qStrength = supabase!
      .from("session_summaries")
      .select("athlete_id, quality, peak_force_stats, num_events, athletes(first_name, last_name)")
      .eq("program_id", programId)
      .eq("mode", "power")
      .not("peak_force_stats", "is", null);
    if (userRole === "coach" && coreTeamId) qStrength = qStrength.eq("core_team_id", coreTeamId);
    if (leaderCutoff) qStrength = qStrength.gte("date_of_record", leaderCutoff);

    let qReaction = supabase!
      .from("session_summaries")
      .select("athlete_id, num_events, quality, athletes(first_name, last_name)")
      .eq("program_id", programId)
      .eq("mode", "reaction");
    if (userRole === "coach" && coreTeamId) qReaction = qReaction.eq("core_team_id", coreTeamId);
    if (leaderCutoff) qReaction = qReaction.gte("date_of_record", leaderCutoff);

    let qAccuracy = supabase!
      .from("session_summaries")
      .select("athlete_id, quality, peak_force_stats, num_events, iei_ms, athletes(first_name, last_name)")
      .eq("program_id", programId)
      .eq("mode", "accuracy");
    if (userRole === "coach" && coreTeamId) qAccuracy = qAccuracy.eq("core_team_id", coreTeamId);
    if (leaderCutoff) qAccuracy = qAccuracy.gte("date_of_record", leaderCutoff);

    let qVolume = supabase!
      .from("session_summaries")
      .select("athlete_id, quality, num_events, athletes(first_name, last_name)")
      .eq("program_id", programId)
      .eq("mode", "volume");
    if (userRole === "coach" && coreTeamId) qVolume = qVolume.eq("core_team_id", coreTeamId);
    if (leaderCutoff) qVolume = qVolume.gte("date_of_record", leaderCutoff);

    let qTarget = supabase!
      .from("session_summaries")
      .select("athlete_id, quality, athletes(first_name, last_name)")
      .eq("program_id", programId)
      .eq("mode", "target");
    if (userRole === "coach" && coreTeamId) qTarget = qTarget.eq("core_team_id", coreTeamId);
    if (leaderCutoff) qTarget = qTarget.gte("date_of_record", leaderCutoff);

    (async () => {
      try {
        const [strengthRes, reactionRes, accuracyRes, volumeRes, targetRes] = await Promise.all([
          qStrength,
          qReaction,
          qAccuracy,
          qVolume,
          qTarget,
        ]);

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
            const name = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}` : "Unknown Athlete";
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
            const name = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}` : "Unknown Athlete";
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
            const name = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}` : "Unknown Athlete";
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
            const name    = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}` : "Unknown";
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
            const name = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}` : "Unknown";
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
  }, [programId, userRole, coreTeamId, leaderCutoff]);

  // ---------- Team Leaderboards ----------
  type TeamLeaderRow = {
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

  const [teamLeaderMetric, setTeamLeaderMetric] = useState<MetricKey>("strength");
  const [teamLeaderRows,   setTeamLeaderRows]   = useState<TeamLeaderRow[]>([]);
  const [teamLeaderLoading,setTeamLeaderLoading]= useState(false);

  // Most Improved per team — first 50% of sessions vs last 50%
  type TeamImprovedRow = { teamId: string; name: string; teamType: "core"|"sub"; delta: number; from: number; to: number; sessions: number };
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

        for (const team of allTeams) {
          const isCore = team.team_type === "core";

          let query = supabase!
            .from("session_summaries")
            .select("quality, peak_force_stats, num_events, impulse_stats")
            .eq("program_id", programId!)
            .eq("mode", modeFilter);

          if (isCore) {
            query = query.eq("core_team_id", team.id);
          } else {
            const ids = subTeamMembers.get(team.id) ?? [];
            if (ids.length === 0) continue;
            query = (query as any).in("athlete_id", ids);
          }
          if (leaderCutoff) query = query.gte("date_of_record", leaderCutoff);

          const { data } = await query;
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
  }, [programId, teams, teamLeaderMetric, leaderCutoff]);

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

        for (const team of teams) {
          const isCore = team.team_type === "core";
          let query = supabase!.from("session_summaries")
            .select("date_of_record, quality, peak_force_stats, angles_deg")
            .eq("program_id", programId!)
            .order("date_of_record", { ascending: true });

          if (modeFilter) query = (query as any).eq("mode", modeFilter);

          if (isCore) { query = query.eq("core_team_id", team.id); }
          else {
            const ids = subTeamMembers.get(team.id) ?? [];
            if (ids.length === 0) continue;
            query = (query as any).in("athlete_id", ids);
          }
          if (leaderCutoff) query = query.gte("date_of_record", leaderCutoff);

          const { data } = await query;
          if (!data || data.length < 4) continue;

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
  }, [programId, teams, teamImprovedMetric, leaderCutoff]);

  const leaderboardData = useMemo<LeaderRow[]>(() => {
    if (leaderMetric === "strength") return strengthRows;
    if (leaderMetric === "reaction") return reactionRows;
    if (leaderMetric === "accuracy") return accuracyRows;
    // volume and target use their own typed arrays rendered directly
    return [];
  }, [leaderMetric, strengthRows, reactionRows, accuracyRows]);

  // ---------- Coaching Insights (data-driven) ----------
  type CoachInsight = {
    tag: "Power" | "Accuracy" | "Reaction" | "Consistency" | "Fatigue" | "Tempo" | "Volume" | "Target";
    priority: "high" | "medium" | "low";
    headline: string;
    numbers: { label: string; value: string; delta?: string; deltaDir?: "up" | "down" | "neutral" }[];
    cue: string;
  };

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

  // Athletes who appear in recentSessions (for the athlete filter dropdown)
  const sessionAthletes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of recentSessions) {
      const key = `${s.athleteFirstName} ${s.athleteLastName}`.trim();
      if (key && key !== "— " && key !== "—") seen.set(key, key);
    }
    return Array.from(seen.values()).sort();
  }, [recentSessions]);

  // ---------- In-Depth Athlete Analysis ----------
  type AthleteSessionRow = {
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
        const { data, error } = await supabase!
          .from("session_summaries")
          .select("session_id, date_of_record, mode, num_events, session_duration_ms, cadence_hz_avg, peak_force_stats, quality, angles_deg, iei_ms")
          .eq("athlete_id", analysisAthleteId)
          .eq("program_id", programId)
          .order("date_of_record", { ascending: true });

        if (error) throw error;
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

  // Most Improved Athletes — derived from per-athlete session histories
  type AthleteImprovedRow = { athleteId: string; name: string; metric: MetricKey; delta: number; from: number; to: number; sessions: number };
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

        let query = supabase!
          .from("session_summaries")
          .select("athlete_id, date_of_record, quality, peak_force_stats, angles_deg, athletes(first_name, last_name)")
          .eq("program_id", programId!)
          .not("athlete_id", "is", null)
          .order("date_of_record", { ascending: true });

        if (modeFilter) query = (query as any).eq("mode", modeFilter);
        if (leaderCutoff) query = query.gte("date_of_record", leaderCutoff);

        const { data } = await query;
        if (!data) return;

        // Group by athlete
        const byAthlete = new Map<string, { name: string; vals: number[] }>();
        for (const row of data as any[]) {
          const id = row.athlete_id;
          if (!id) continue;
          const name = row.athletes ? `${row.athletes.first_name} ${row.athletes.last_name}`.trim() : "Unknown";
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
  }, [programId, athleteImprovedMetric, leaderCutoff]);

  // ─────────────────────────────────────────────────────────────────────────
  // Charts & Graphs
  // ─────────────────────────────────────────────────────────────────────────
  type ChartMetric = "strength" | "accuracy" | "reaction" | "volume";
  type CompareMode = "athlete-athlete" | "athlete-team" | "team-team";
  type EntityKind  = "athlete" | "team";
  type ChartEntity = { kind: EntityKind; id: string; label: string };

  // Per-week data point
  type WeekPoint = { week: string; value: number | null }; // week = "YYYY-WW"

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

    // Build query scoped to this entity
    let query = supabase
      .from("session_summaries")
      .select("date_of_record, mode, num_events, quality, peak_force_stats, session_duration_ms")
      .eq("program_id", programId)
      .order("date_of_record", { ascending: true });

    if (entity.kind === "athlete") {
      query = query.eq("athlete_id", entity.id);
    } else if (isSubTeam && athleteIds) {
      // Sub-team: sessions belonging to any member athlete
      query = (query as any).in("athlete_id", athleteIds);
    } else {
      // Core team: sessions directly scoped by core_team_id
      query = query.eq("core_team_id", entity.id);
    }

    // Scope mode for metric
    if (metric === "strength") query = (query as any).eq("mode", "power");
    if (metric === "accuracy") query = (query as any).eq("mode", "accuracy");
    if (metric === "reaction") query = (query as any).eq("mode", "reaction");

    const { data, error } = await query;
    if (error || !data) return [];

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

  // ── Skeleton helper — shape-matched shimmer blocks ──────────────────────
  const Skel = ({ w, h = 14, r = 6, style }: { w: number | string; h?: number; r?: number; style?: React.CSSProperties }) => (
    <div className="ts-skel" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
  );

  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      className={`ts-tabBtn ${activeTab === key ? "isActive" : ""}`}
      onClick={() => setActiveTab(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="ts-dash">
      <CreateAthleteModal
        open={showCreateAthlete}
        onClose={() => setShowCreateAthlete(false)}
        onCreated={(athlete) => {
          console.log("[dashboard] Athlete created:", athlete);
          // Append to the list immediately if the athletes tab is active
          setAthletes((prev) => [...prev, athlete as Athlete].sort((a, b) =>
            a.last_name.localeCompare(b.last_name)
          ));
        }}
      />

      <EditAthleteModal
        open={Boolean(editAthleteTarget)}
        athlete={editAthleteTarget}
        onClose={() => setEditAthleteTarget(null)}
        onSaved={(updated) => {
          // Merge the updated fields back into the athletes list in place
          setAthletes((prev) =>
            prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
          );
          setEditAthleteTarget(null);
        }}
      />

      <ManageTeamModal
        open={showCreateTeam || Boolean(selectedTeam)}
        onClose={() => { setShowCreateTeam(false); setSelectedTeam(null); }}
        team={selectedTeam}
        onSaved={(saved) => {
          if (selectedTeam) {
            // Update in place
            setTeams((prev) => prev.map((t) => t.id === saved.id ? { ...t, ...saved, member_count: t.member_count } : t));
          } else {
            // Append new and re-sort
            setTeams((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
          }
          setShowCreateTeam(false);
          setSelectedTeam(null);
        }}
      />

      <EditProfileModal
        open={showEditProfile}
        onClose={() => setShowEditProfile(false)}
        onSaved={(updated) => setProfile(updated)}
      />

      <ProgramModal
        open={showProgram}
        onClose={() => setShowProgram(false)}
      />

      {/* PROFILE HEADER — null while fetching, populates once Supabase responds */}
      <ProfileHeader
        profile={profile}
        onEdit={() => setShowEditProfile(true)}
        onShare={() => alert("Open share sheet")}
        onViewProgram={() => setShowProgram(true)}
      />

      <div className="ts-dashTop">
        <div className="ts-dashHead">
          <h1 className="ts-dashTitle">Dashboard</h1>

          {/* TABS */}
          <div className="ts-tabsRow" role="tablist" aria-label="Dashboard sections">
            <div className="ts-tabs">
              {tabBtn("recent", "Recent Session")}
              {tabBtn("insights", "Insights and Analysis")}
              {tabBtn("athletes", "Individual Athletes")}
            </div>
          </div>

          <p className="ts-dashSub">Realtime training metrics + AI-ready analysis.</p>
        </div>

        <div className="ts-dashActions">
          <button className="ts-btn ts-btnGhost" onClick={() => navigate("/session")}>
            New Session
          </button>
          <button
            type="button"
            className="ts-btn ts-btnSecondary ts-addAthleteBtn"
            onClick={() => setShowCreateAthlete(true)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Add Athlete
          </button>
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === "recent" ? (
        <>
          {/* MAIN GRID */}
          <div className="ts-dashGrid ts-dashMain">
            {/* Recent Sessions */}
            <div className="ts-card">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Recent Sessions</div>
                <div className="ts-cardMeta">
                  {recentSessionsLoading ? "Loading…" : filteredSessions.length > 0 ? `${sessionPage * SESSION_PAGE_SIZE + 1}–${Math.min((sessionPage + 1) * SESSION_PAGE_SIZE, filteredSessions.length)} of ${filteredSessions.length}` : "0 sessions"}
                </div>
              </div>

              {/* Filters row */}
              {!recentSessionsLoading && recentSessions.length > 0 && (() => {
                // Theme-adaptive colour tokens — all filter chrome derives from these
                const ink       = isDark ? "255,255,255" : "20,20,40";
                const subtleBg  = isDark ? `rgba(${ink},0.04)`  : `rgba(${ink},0.05)`;
                const subtleBdr = isDark ? `rgba(${ink},0.12)`  : `rgba(${ink},0.14)`;
                const idleFg    = isDark ? `rgba(${ink},0.45)`  : `rgba(${ink},0.45)`;
                const activeFg  = isDark ? `rgba(${ink},0.95)`  : `rgba(${ink},0.92)`;
                const activeBg  = isDark ? `rgba(${ink},0.10)`  : `rgba(${ink},0.09)`;
                const activeBdr = isDark ? `rgba(${ink},0.30)`  : `rgba(${ink},0.28)`;
                const clearFg   = isDark ? `rgba(${ink},0.40)`  : `rgba(${ink},0.40)`;
                const clearFgHover = isDark ? `rgba(${ink},0.70)` : `rgba(${ink},0.72)`;
                const clearBdr     = isDark ? `rgba(${ink},0.14)` : `rgba(${ink},0.16)`;
                const clearBdrHover= isDark ? `rgba(${ink},0.28)` : `rgba(${ink},0.30)`;


                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>

                    {/* ── Row 1: Athlete dropdown + optional Clear ── */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

                      {/* Athlete dropdown — fills remaining space */}
                      <div style={{ position: "relative", display: "flex", flex: 1, minWidth: 0 }}>
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.55, flexShrink: 0 }}>
                          <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                          <path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        </svg>
                        <select
                          value={sessionAthleteFilter}
                          onChange={(e) => setSessionAthleteFilter(e.target.value)}
                          style={{
                            width: "100%",
                            background: sessionAthleteFilter !== "all" ? "rgba(180,0,255,0.14)" : subtleBg,
                            border: sessionAthleteFilter !== "all"
                              ? "1px solid rgba(180,0,255,0.45)"
                              : `1px solid ${subtleBdr}`,
                            borderRadius: 10,
                            color: sessionAthleteFilter !== "all" ? "rgba(210,140,255,0.95)" : "inherit",
                            font: "inherit",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "7px 14px 7px 30px",
                            cursor: "pointer",
                            outline: "none",
                            appearance: "none",
                            boxSizing: "border-box",
                            boxShadow: sessionAthleteFilter !== "all" ? "0 0 0 1px rgba(180,0,255,0.2)" : "none",
                            transition: "background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
                          }}
                        >
                          <option value="all">All Athletes</option>
                          {sessionAthletes.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Clear button — only when a filter is active */}
                      {(sessionModeFilter !== "all" || sessionAthleteFilter !== "all") && (
                        <button
                          type="button"
                          onClick={() => { setSessionModeFilter("all"); setSessionAthleteFilter("all"); }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            flexShrink: 0,
                            background: "transparent",
                            border: `1px solid ${clearBdr}`,
                            borderRadius: 10,
                            color: clearFg,
                            font: "inherit",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "7px 11px",
                            cursor: "pointer",
                            letterSpacing: "0.04em",
                            transition: "color 140ms ease, border-color 140ms ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = clearFgHover;
                            (e.currentTarget as HTMLButtonElement).style.borderColor = clearBdrHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = clearFg;
                            (e.currentTarget as HTMLButtonElement).style.borderColor = clearBdr;
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                          Clear
                        </button>
                      )}
                    </div>

                    {/* ── Row 2: Mode pills — equal-width cells, always fill card ── */}
                    <div style={{
                      display: "flex",
                      width: "100%",
                      background: subtleBg,
                      border: `1px solid ${subtleBdr}`,
                      borderRadius: 10,
                      padding: 3,
                      gap: 2,
                      boxSizing: "border-box",
                    }}>
                      {([
                        { value: "all",      label: "All",      icon: null },
                        { value: "power",    label: "Power",    icon: "💥" },
                        { value: "accuracy", label: "Accuracy", icon: "🎯" },
                        { value: "reaction", label: "Reaction", icon: "⚡️" },
                        { value: "volume",   label: "Volume",   icon: "🥊" },
                        { value: "target",   label: "Target",   icon: "🏹" },
                      ] as { value: string; label: string; icon: string | null }[]).map(({ value, label, icon }) => {
                        const isActive   = sessionModeFilter === value;
                        const isAccented = isActive && value !== "all";
                        const accentColor = value === "accuracy" ? "#00dcff" : value === "reaction" ? "#ffcc00" : value === "volume" ? "#ff6a00" : value === "target" ? "#00ff88" : "#b400ff";
                        const accentBg    = value === "accuracy" ? "rgba(0,220,255,0.14)"  : value === "reaction" ? "rgba(255,200,0,0.14)"  : value === "volume" ? "rgba(255,106,0,0.14)"  : value === "target" ? "rgba(0,255,136,0.14)"  : "rgba(180,0,255,0.18)";
                        const accentBdr   = value === "accuracy" ? "rgba(0,220,255,0.40)"  : value === "reaction" ? "rgba(255,200,0,0.38)"  : value === "volume" ? "rgba(255,106,0,0.40)"  : value === "target" ? "rgba(0,255,136,0.38)"  : "rgba(180,0,255,0.45)";
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSessionModeFilter(value)}
                            style={{
                              flex: "1 1 0",           // equal width regardless of label length
                              minWidth: 0,             // allow shrinking below content size
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              padding: "6px 4px",
                              borderRadius: 7,
                              border: isActive
                                ? `1px solid ${isAccented ? accentBdr : activeBdr}`
                                : "1px solid transparent",
                              background: isActive
                                ? (isAccented ? accentBg : activeBg)
                                : "transparent",
                              color: isActive
                                ? (isAccented ? accentColor : activeFg)
                                : idleFg,
                              font: "inherit",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              letterSpacing: "0.01em",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                            }}
                          >
                            <span className="ts-filterModeIcon" style={{ fontSize: 11, lineHeight: 1, flexShrink: 0 }}>{icon ?? ""}</span>
                            <span className="ts-filterModeLabel">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {recentSessionsError ? (
                <div className="ts-athleteError">{recentSessionsError}</div>
              ) : recentSessionsLoading ? (
                <div className="ts-recentSessionsList" style={{ gap: 6 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 2px" }}>
                      <Skel w={36} h={36} r={50} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <Skel w={`${55 + (i % 3) * 15}%`} h={12} />
                        <Skel w="38%" h={10} />
                      </div>
                      <Skel w={68} h={24} r={999} />
                      <Skel w={14} h={14} r={4} />
                    </div>
                  ))}
                </div>
              ) : recentSessions.length === 0 ? (
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  padding: "36px 16px",
                  textAlign: "center",
                }}>
                  <div style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "rgba(180,0,255,0.10)",
                    border: "1px solid rgba(180,0,255,0.22)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}>
                    🥊
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>No sessions yet</div>
                    <div style={{ fontSize: 12, opacity: 0.50, lineHeight: 1.5, maxWidth: 220 }}>
                      Head to the{" "}
                      <button
                        type="button"
                        onClick={() => navigate("/session")}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "rgba(180,0,255,0.90)",
                          fontWeight: 700,
                          fontSize: "inherit",
                          cursor: "pointer",
                          textDecoration: "underline",
                          textUnderlineOffset: 2,
                        }}
                      >
                        Session page
                      </button>
                      {" "}to record your first session with an athlete.
                    </div>
                  </div>
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="ts-athleteEmpty">No sessions match the selected filters.</div>
              ) : (
                <>
                  {/* ── Avatar popover ── */}
                  {avatarPopover && (() => {
                    const session = recentSessions.find(s => s.id === avatarPopover.sessionId);
                    if (!session?.athleteId) return null;

                    const athleteId = session.athleteId;
                    const fullName  = `${session.athleteFirstName} ${session.athleteLastName}`.trim();

                    // Pull stats from existing leaderboard data
                    const strengthRow = strengthRows.find(r => r.athleteId === athleteId);
                    const reactionRow = reactionRows.find(r => r.athleteId === athleteId);
                    const accuracyRow = accuracyRows.find(r => r.athleteId === athleteId);

                    // Count sessions + last session from recentSessions
                    const athleteSessions = recentSessions.filter(s => s.athleteId === athleteId);
                    const sessionCount    = athleteSessions.length;
                    const lastSession     = athleteSessions[0]; // already sorted newest first

                    const ink    = isDark ? "255,255,255" : "20,20,40";
                    const bg     = isDark ? "rgba(18,10,28,0.97)" : "rgba(255,255,255,0.98)";
                    const border = isDark ? "rgba(180,0,255,0.35)" : "rgba(20,20,40,0.14)";

                    return (
                      <div
                        onMouseEnter={() => {/* keep open while hovering popover */}}
                        onMouseLeave={() => setAvatarPopover(null)}
                        style={{
                          position: "fixed",
                          left: Math.min(avatarPopover.x + 12, window.innerWidth - 240),
                          top:  Math.min(avatarPopover.y - 8, window.innerHeight - 220),
                          zIndex: 9999,
                          width: 224,
                          borderRadius: 12,
                          background: bg,
                          border: `1px solid ${border}`,
                          boxShadow: isDark
                            ? "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(180,0,255,0.12)"
                            : "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
                          backdropFilter: "blur(16px)",
                          overflow: "hidden",
                          pointerEvents: "auto",
                          animation: "tsPopoverIn 120ms ease",
                        }}
                      >
                        {/* Header */}
                        <div style={{ padding: "11px 13px 9px", borderBottom: `1px solid rgba(${ink},0.07)`, display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, rgba(180,0,255,0.30), rgba(180,0,255,0.12))", border: "1px solid rgba(180,0,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "rgba(210,140,255,0.95)", flexShrink: 0 }}>
                            {session.athleteFirstName[0]}{session.athleteLastName[0]}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: `rgba(${ink},0.92)` }}>{fullName}</div>
                            <div style={{ fontSize: 10, opacity: 0.45, marginTop: 1 }}>
                              {sessionCount} session{sessionCount !== 1 ? "s" : ""}{lastSession ? ` · ${formatSessionTime(lastSession.timestamp)}` : ""}
                            </div>
                          </div>
                        </div>

                        {/* Stats */}
                        <div style={{ padding: "8px 13px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
                          {strengthRow ? (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>💥 Peak strength</span>
                              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(180,0,255,0.90)" }}>{strengthRow.peakIndex} <span style={{ fontSize: 10, opacity: 0.45 }}>/1000</span></span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>💥 Strength</span>
                              <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                            </div>
                          )}
                          {reactionRow ? (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>⚡️ Avg reaction</span>
                              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{reactionRow.avgReactionMs} <span style={{ fontSize: 10, opacity: 0.45 }}>ms</span></span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>⚡️ Reaction</span>
                              <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                            </div>
                          )}
                          {accuracyRow ? (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>🎯 Accuracy</span>
                              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{accuracyRow.accuracyPct}<span style={{ fontSize: 10, opacity: 0.45 }}>%</span></span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.50 }}>🎯 Accuracy</span>
                              <span style={{ fontSize: 11, opacity: 0.30 }}>no data</span>
                            </div>
                          )}
                        </div>

                        {/* CTA */}
                        <div style={{ padding: "0 13px 11px" }}>
                          <div style={{ fontSize: 10, opacity: 0.38, textAlign: "center", paddingTop: 6, borderTop: `1px solid rgba(${ink},0.06)` }}>
                            Click avatar to open full analysis ↓
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="ts-recentSessionsList">
                    {pagedSessions.map((session) => (
                      <div
                        key={session.id}
                        className={`ts-recentSessionRow${selectedSessionId === session.id ? " isSelected" : ""}`}
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          resetReplay();
                        }}
                      >
                        {/* Avatar — hover for popover, click to jump to analysis */}
                        <div
                          className="ts-recentSessionAvatar"
                          style={{ cursor: session.athleteId ? "pointer" : "default", position: "relative" }}
                          onMouseEnter={(e) => {
                            if (!session.athleteId) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setAvatarPopover({ sessionId: session.id, x: rect.right, y: rect.top });
                          }}
                          onMouseLeave={() => setAvatarPopover(null)}
                          onClick={(e) => {
                            if (!session.athleteId) return;
                            e.stopPropagation();
                            const athleteName = `${session.athleteFirstName} ${session.athleteLastName}`.trim();
                            setAnalysisAthleteId(session.athleteId);
                            setAnalysisAthleteName(athleteName);
                            setAnalysisSection("power");
                            setAvatarPopover(null);
                            // Double rAF — first frame commits state, second frame paints, then scroll
                            requestAnimationFrame(() => requestAnimationFrame(() => {
                              analysisCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }));
                          }}
                        >
                          {session.athleteFirstName[0]}{session.athleteLastName[0]}
                        </div>
                        {/* Info: desktop = [text | mode-pill] row; mobile = stacked */}
                        <div className="ts-recentSessionInfo">
                          <div className="ts-recentSessionText">
                            <div className="ts-recentSessionAthlete">
                              {session.athleteFirstName} {session.athleteLastName}
                            </div>
                            <div className="ts-recentSessionMeta">{formatSessionTime(session.timestamp)}</div>
                          </div>
                          <div
                            className="ts-recentSessionMode"
                            style={(() => {
                              const m = (session.mode ?? "power").toLowerCase();
                              const color = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "volume" ? "#ff6a00" : m === "target" ? "#00ff88" : "#b400ff";
                              return { background: `${color}14`, border: `1px solid ${color}44`, color };
                            })()}
                          >
                            {(() => {
                              const m = (session.mode ?? "power").toLowerCase();
                              const icon = m === "accuracy" ? "🎯" : m === "reaction" ? "⚡️" : m === "volume" ? "🥊" : m === "target" ? "🏹" : "💥";
                              return `${icon} ${m.charAt(0).toUpperCase() + m.slice(1)}`;
                            })()}
                          </div>
                        </div>
                        <div className="ts-recentSessionChevron">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Pagination ── */}
                  {totalSessionPages > 1 && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.08)"}`,
                    }}>
                      <button
                        type="button"
                        disabled={sessionPage === 0}
                        onClick={() => setSessionPage((p) => p - 1)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          borderRadius: 9,
                          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,40,0.14)"}`,
                          background: "transparent",
                          color: sessionPage === 0
                            ? (isDark ? "rgba(255,255,255,0.20)" : "rgba(20,20,40,0.22)")
                            : (isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.75)"),
                          font: "inherit",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: sessionPage === 0 ? "not-allowed" : "pointer",
                          opacity: sessionPage === 0 ? 0.45 : 1,
                          transition: "color 140ms ease, background 140ms ease, border-color 140ms ease",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Previous
                      </button>

                      {/* Page dots */}
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        {Array.from({ length: totalSessionPages }).map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSessionPage(i)}
                            style={{
                              width: i === sessionPage ? 20 : 7,
                              height: 7,
                              borderRadius: 999,
                              border: "none",
                              background: i === sessionPage
                                ? "#b400ff"
                                : (isDark ? "rgba(255,255,255,0.18)" : "rgba(20,20,40,0.18)"),
                              cursor: "pointer",
                              padding: 0,
                              transition: "width 200ms ease, background 200ms ease",
                            }}
                            aria-label={`Page ${i + 1}`}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={sessionPage >= totalSessionPages - 1}
                        onClick={() => setSessionPage((p) => p + 1)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          borderRadius: 9,
                          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,40,0.14)"}`,
                          background: "transparent",
                          color: sessionPage >= totalSessionPages - 1
                            ? (isDark ? "rgba(255,255,255,0.20)" : "rgba(20,20,40,0.22)")
                            : (isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.75)"),
                          font: "inherit",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: sessionPage >= totalSessionPages - 1 ? "not-allowed" : "pointer",
                          opacity: sessionPage >= totalSessionPages - 1 ? 0.45 : 1,
                          transition: "color 140ms ease, background 140ms ease, border-color 140ms ease",
                        }}
                      >
                        Next
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Impact Heatmap */}
            <div className="ts-card ts-heatmapCard">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Impact Heatmap</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {sessionSummary && (
                    <div className="ts-summaryModePill" data-mode={(sessionSummary.mode ?? "power").toLowerCase()}>
                      {(sessionSummary.mode ?? "power").charAt(0).toUpperCase() + (sessionSummary.mode ?? "power").slice(1)}
                    </div>
                  )}
                  {/* Heatmap view mode toggle — show only for power mode (not accuracy) (not accuracy) */}
                  {selectedSessionId && replayEvents.length > 0 && (() => {
                    const mode = (sessionSummary?.mode ?? "power").toLowerCase();
                    // Only show toggle for standard and power modes; accuracy always uses history mode
                    const showToggle = mode !== "accuracy";
                    if (!showToggle) return null;
                    const toggleInk = isDark ? "255,255,255" : "20,20,40";
                    return (
                      <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        background: `rgba(${toggleInk},0.04)`,
                        border: `1px solid rgba(${toggleInk},0.10)`,
                        borderRadius: 7,
                        padding: "2px 4px",
                        gap: 1,
                      }}>
                        {(["live", "history"] as const).map((viewMode) => (
                          <button
                            key={viewMode}
                            type="button"
                            onClick={() => setHeatmapViewMode(viewMode)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 5,
                              border: heatmapViewMode === viewMode ? `1px solid ${modeAccent}` : "1px solid transparent",
                              background: heatmapViewMode === viewMode ? `${modeAccent}15` : "transparent",
                              color: heatmapViewMode === viewMode ? modeAccent : `rgba(${toggleInk},0.50)`,
                              font: "inherit",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                              textTransform: "capitalize",
                            }}
                          >
                            {viewMode === "live" ? "Live" : "History"}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="ts-cardMeta">
                    {heatmapLoading
                      ? "Loading…"
                      : selectedSessionId
                      ? replayEvents.length > 0
                        ? `${activeEventIdx + 1} / ${replayEvents.length} events`
                        : `${heatmapCells.length} zones`
                      : "12 × 8 Grid"}
                  </div>
                </div>
              </div>

              {/* Replay controls + timeline scrubber */}
              {selectedSessionId && !heatmapLoading && replayEvents.length > 0 && (() => {
                const totalMs  = sessionSummary?.session_duration_ms
                               ?? replayEvents[replayEvents.length - 1]?.tMs
                               ?? 1;
                const pct      = Math.min(1, replayTimeMs / totalMs);
                const fmtMs    = (ms: number) => {
                  const s = Math.floor(ms / 1000);
                  const m = Math.floor(s / 60);
                  return m > 0 ? `${m}:${String(s % 60).padStart(2,"0")}` : `${s}s`;
                };
                const notStarted = activeEventIdx === -1 && !isReplaying;

                return (
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>

                    {/* Row 1: transport buttons + speed */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {notStarted ? (
                        <button className="ts-replayBtn ts-replayBtnPrimary" onClick={startReplay}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 1.5l8 4.5-8 4.5V1.5Z" fill="currentColor"/>
                          </svg>
                          Play
                        </button>
                      ) : isReplaying ? (
                        <button className="ts-replayBtn" onClick={pauseReplay}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <rect x="1.5" y="1.5" width="3" height="9" rx="1" fill="currentColor"/>
                            <rect x="7.5" y="1.5" width="3" height="9" rx="1" fill="currentColor"/>
                          </svg>
                          Pause
                        </button>
                      ) : (
                        <button className="ts-replayBtn ts-replayBtnPrimary" onClick={resumeReplay}
                          disabled={activeEventIdx >= replayEvents.length - 1}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 1.5l8 4.5-8 4.5V1.5Z" fill="currentColor"/>
                          </svg>
                          Resume
                        </button>
                      )}

                      <button className="ts-replayBtn" onClick={resetReplay}
                        disabled={notStarted}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M1.5 6a4.5 4.5 0 1 1 1.1 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                          <path d="M1.5 9.5V6h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Reset
                      </button>

                      <div className="ts-replaySpeed">
                        <span className="ts-replaySpeedLabel">Speed</span>
                        {([0.5, 1, 2] as const).map(s => (
                          <button
                            key={s}
                            className={`ts-replaySpeedBtn${replaySpeed === s ? " isActive" : ""}`}
                            onClick={() => {
                              setReplaySpeed(s);
                              // If mid-replay, reschedule remaining events at new speed
                              if (isReplaying) {
                                const nextIdx = activeEventIdx + 1;
                                if (nextIdx < replayEvents.length) {
                                  scheduleFrom(nextIdx, replayEvents[nextIdx].tMs, s);
                                }
                              }
                            }}
                          >
                            {s === 0.5 ? "0.5×" : s === 1 ? "1×" : "2×"}
                          </button>
                        ))}
                      </div>

                      {/* Time counter */}
                      <div style={{ marginLeft: "auto", fontSize: 11, fontVariantNumeric: "tabular-nums",
                        opacity: 0.55, display: "flex", gap: 3, alignItems: "center" }}>
                        <span style={{ opacity: 0.9 }}>{fmtMs(replayTimeMs)}</span>
                        <span style={{ opacity: 0.4 }}>/</span>
                        <span>{fmtMs(totalMs)}</span>
                      </div>
                    </div>

                    {/* Row 2: timeline scrubber */}
                    <div className="ts-replayTimeline"
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        seekTo(Math.round(ratio * totalMs));
                      }}
                    >
                      {/* Track fill */}
                      <div className="ts-replayTrackFill" style={{
                        width: `${pct * 100}%`,
                        background: `linear-gradient(90deg, ${modeAccent}99, ${modeAccent})`,
                      }} />

                      {/* Event dots */}
                      {replayEvents.map((ev, idx) => {
                        const dotPct = (ev.tMs / totalMs) * 100;
                        const isFired  = idx <= activeEventIdx;
                        const isActive = idx === activeEventIdx;
                        // Size dot by SI: bigger = stronger hit
                        const siNorm   = ev.si != null ? ev.si / 1000 : 0.4;
                        const dotSize  = 5 + Math.round(siNorm * 5); // 5–10px
                        return (
                          <div
                            key={ev.eventId}
                            className="ts-replayDot"
                            title={`Event ${idx + 1} · ${fmtMs(ev.tMs)}${ev.si != null ? ` · SI ${ev.si}` : ""}${ev.cellCount ? ` · ${ev.cellCount} cells` : ""}`}
                            onClick={(e) => { e.stopPropagation(); seekTo(ev.tMs); }}
                            style={{
                              left:      `${dotPct}%`,
                              width:     dotSize,
                              height:    dotSize,
                              marginTop: -(dotSize / 2),
                              // Fired (on/behind playhead): solid mode color
                              // Unfired (ahead of playhead): mode color at ~25% opacity
                              background: isFired ? modeAccent : `${modeAccent}40`,
                              boxShadow:  isActive ? `0 0 0 3px ${modeAccent}44` : "none",
                              transform:  isActive ? "translate(-50%,-50%) scale(1.5)" : "translate(-50%,-50%) scale(1)",
                              zIndex:     isActive ? 3 : 1,
                            }}
                          />
                        );
                      })}

                      {/* Playhead */}
                      <div className="ts-replayHead" style={{ left: `${pct * 100}%` }} />
                    </div>

                    {/* Row 3: active event info strip */}
                    {activeEvent && (
                      <div style={{ display: "flex", gap: 12, fontSize: 11,
                        color: modeAccent, fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
                        <span>Event {activeEventIdx + 1} of {replayEvents.length}</span>
                        {activeEvent.si   != null && <span>SI {activeEvent.si}</span>}
                        {activeEvent.cellCount > 0  && <span>{activeEvent.cellCount} cells</span>}
                      </div>
                    )}

                  </div>
                );
              })()}

              {/* Body: empty state OR two-column bag + stats */}
              {!selectedSessionId ? (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  padding: "20px 16px", marginTop: 8,
                  borderRadius: 12,
                  border: "1px dashed rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.015)",
                }}>
                  <svg width="16" height="16" viewBox="0 0 30 30" fill="none" style={{ opacity: 0.30, flexShrink: 0 }}>
                    <rect x="2" y="2" width="7" height="7" rx="2" fill="currentColor"/>
                    <rect x="11.5" y="2" width="7" height="7" rx="2" fill="currentColor" opacity="0.5"/>
                    <rect x="21" y="2" width="7" height="7" rx="2" fill="currentColor"/>
                    <rect x="2" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.4"/>
                    <rect x="11.5" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.9"/>
                    <rect x="21" y="11.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.3"/>
                    <rect x="2" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.6"/>
                    <rect x="11.5" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.2"/>
                    <rect x="21" y="21" width="7" height="7" rx="2" fill="currentColor" opacity="0.7"/>
                  </svg>
                  <span style={{ fontSize: 13, opacity: 0.45, fontWeight: 500 }}>Select a session to view its heatmap</span>
                </div>
              ) : (
                <div className="ts-heatmapBody">

                  {/* ── Left: bag ── */}
                  <div className="ts-heatmapBagCol">
                    <div
                      className="ts-dash-bagWrap"
                      style={{
                        boxShadow: !heatmapLoading
                          ? `0 0 40px -10px ${modeGlow.replace("0.55","0.30")}, inset 0 0 60px -20px ${modeGlow.replace("0.55","0.10")}`
                          : "none",
                        borderColor: !heatmapLoading
                          ? modeAccent + "55"
                          : "var(--panel-border, rgba(255,255,255,0.10))",
                      }}
                    >
                      {/* Bag label */}
                      <div style={{
                        position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                        opacity: 0.28, pointerEvents: "none", zIndex: 4, whiteSpace: "nowrap",
                        color: "currentColor",
                      }}>
                        Heavy Bag — 12 × 8 Grid
                      </div>

                      {/* Target mode zone overlay — highlights cued zone on active event */}
                      {(() => {
                        const m = (sessionSummary?.mode ?? "power").toLowerCase();
                        if (m !== "target" || !activeEvent?.targetZone) return null;
                        const z = activeEvent.targetZone;
                        // Map zone to grid row/col ranges (1-indexed, matching ESP32)
                        const rowRange = z.row === "top" ? [9,12] : z.row === "middle" ? [5,8] : [1,4];
                        // Column direction is mirrored: C8 renders leftmost, C1 rightmost
                        const colRange = z.col === "left" ? [7,8] : z.col === "center" ? [3,6] : [1,2];
                        const correct  = activeEvent.zoneCorrect;
                        const zColor   = correct === true  ? "#00ff88"
                                       : correct === false ? "#ff6060"
                                       : "#00ff88";
                        // Compute overlay position relative to the 12-row × 8-col grid
                        // Grid padding: 28px top, 6px bottom/sides
                        const padTop = 28; const padBot = 6; const padSide = 6;
                        const rowFrac = (ri: number) => (12 - ri + 0.5) / 12;  // visual top fraction for row ri
                        const colFrac = (ci: number) => (8 - ci + 0.5) / 8;    // visual left fraction (mirrored: C8=left)
                        const top1 = rowFrac(rowRange[1]);   // top edge = highest row (largest r = higher on grid)
                        const top2 = rowFrac(rowRange[0] - 1);
                        const left1 = colFrac(colRange[1]);   // left edge = highest col number (renders leftmost)
                        const left2 = colFrac(colRange[0] - 1);
                        return (
                          <div style={{
                            position: "absolute",
                            top:    `calc(${padTop}px + (100% - ${padTop + padBot}px) * ${top1})`,
                            left:   `calc(${padSide}px + (100% - ${padSide * 2}px) * ${left1})`,
                            width:  `calc((100% - ${padSide * 2}px) * ${left2 - left1})`,
                            height: `calc((100% - ${padTop + padBot}px) * ${top2 - top1})`,
                            border: `2px solid ${zColor}`,
                            background: `${zColor}18`,
                            borderRadius: 6,
                            pointerEvents: "none",
                            zIndex: 6,
                            transition: "border-color 200ms, background 200ms",
                            boxShadow: `0 0 12px 2px ${zColor}44`,
                          }} />
                        );
                      })()}

                      {/* Loading overlay */}
                      {heatmapLoading && (
                        <div style={{
                          position: "absolute", inset: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: "rgba(7,7,10,0.65)", backdropFilter: "blur(4px)",
                          borderRadius: 16, zIndex: 5, pointerEvents: "none",
                        }}>
                          <div style={{ fontSize: 13, opacity: 0.55 }}>Loading heatmap…</div>
                        </div>
                      )}

                      {/* Hit grid — 12 rows × 8 cols */}
                      <div style={{ position: "absolute", inset: 0 }}>
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(8, 1fr)",
                          gridTemplateRows: "repeat(12, 1fr)",
                          gap: 3,
                          padding: "28px 6px 6px",
                          width: "100%",
                          height: "100%",
                          boxSizing: "border-box",
                        }}>
                          {Array.from({ length: 12 }, (_, ri) =>
                            Array.from({ length: 8 }, (_, ci) => {
                              const r = 12 - ri;
                              const c = 8 - ci;   // mirrors session.tsx: C8 left, C1 right
                              const key = `${r}-${c}`;
                              let intensity = 0;
                              let kpa = 0;

                              // In history view, always show cumulative replay heatmap
                              if (heatmapViewMode === "history" && replayEvents.length > 0) {
                                const hits = replayHeatmap.get(key) ?? 0;
                                intensity = hits / maxReplayHits;
                                kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                              } else if (replayEvents.length > 0) {
                                // Live mode: only show cells from the most recent event (not cumulative)
                                // This lets users see if they're hitting the same spot or different spots
                                const isInActiveEvent = activeEvent?.cells.some(
                                  cell => cell.r === r && cell.c === c
                                ) ?? false;
                                if (isInActiveEvent) {
                                  intensity = 1.0; // Most recent hit is full intensity
                                  kpa = 90;
                                }
                              } else {
                                // No replay: use static heatmap cells
                                const cell = heatmapCells.find((hc) => hc.r === r && hc.c === c);
                                intensity = cell?.intensity ?? 0;
                                kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                              }

                              const isAlive = intensity > 0;
                              const color = isAlive ? pressureToColor(kpa) : null;
                              const glow  = isAlive ? pressureToGlow(kpa) : null;
                              // isJustHit: any cell in the active event matches this grid cell
                              const isJustHit = activeEvent?.cells.some(
                                cell => cell.r === r && cell.c === c
                              ) ?? false;

                              return (
                                <div
                                  key={key}
                                  className="ts-sim-cell ts-dash-cell"
                                  title={`R${String(r).padStart(2,"0")} C${String(c).padStart(2,"0")}${isAlive ? ` · ${Math.round(intensity * 100)}%` : ""}`}
                                  style={{
                                    borderRadius: 4,
                                    background: isAlive
                                      ? `${color}${Math.round((0.20 + intensity * 0.55) * 255).toString(16).padStart(2,"0")}`
                                      : "rgba(255,255,255,0.03)",
                                    boxShadow: isAlive ? `0 0 10px 2px ${glow}` : "none",
                                    border: isAlive
                                      ? `1px solid ${color}${Math.round(intensity * 0.6 * 255).toString(16).padStart(2,"0")}`
                                      : undefined,
                                    transform: isJustHit ? "scale(1.12)" : isAlive && intensity > 0.7 ? "scale(1.06)" : "scale(1)",
                                    transition: "background 80ms, box-shadow 80ms, transform 80ms, border-color 80ms",
                                    position: "relative",
                                  }}
                                />
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Impact ripples */}
                      {heatmapRipples.map(ripple => {
                        // Grid renders rows top→bottom as R12→R1 with padding: "28px 6px 6px".
                        // ri = visual row index (0 = top = R12), so ri = 12 - ripple.r
                        const gridPadTop    = 28; // matches padding "28px 6px 6px"
                        const gridPadBottom = 6;
                        const gridPadSide   = 6;
                        const ri = 12 - ripple.r; // 0-based from top
                        const leftVal = `calc(${gridPadSide}px + (100% - ${gridPadSide * 2}px) * ${(8 - ripple.c + 0.5) / 8})`;
                        const topVal  = `calc(${gridPadTop}px + (100% - ${gridPadTop + gridPadBottom}px) * ${(ri + 0.5) / 12})`;
                        return (
                          <div key={ripple.id} style={{
                            position: "absolute", left: leftVal, top: topVal,
                            transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 10,
                          }}>
                            <div style={{
                              width: 14, height: 14, borderRadius: "50%",
                              background: ripple.color, boxShadow: `0 0 16px 6px ${ripple.color}`,
                              animation: "tsCorePulse 0.9s ease-out forwards",
                            }} />
                            <div style={{
                              position: "absolute", left: "50%", top: "50%",
                              width: 14, height: 14, borderRadius: "50%",
                              border: `2px solid ${ripple.color}`,
                              animation: "tsRipple 0.9s ease-out forwards",
                            }} />
                          </div>
                        );
                      })}

                      {/* Volume mode window badge */}
                      {(() => {
                        const m = (sessionSummary?.mode ?? "power").toLowerCase();
                        if (m !== "volume" || !activeEvent || activeEvent.volWindowIdx === null) return null;
                        return (
                          <div style={{
                            position: "absolute", top: 8, right: 8,
                            display: "flex", gap: 4, zIndex: 7, pointerEvents: "none",
                          }}>
                            <div style={{
                              fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                              padding: "2px 7px", borderRadius: 999,
                              background: "rgba(255,106,0,0.18)",
                              border: "1px solid rgba(255,106,0,0.45)",
                              color: "#ff6a00",
                            }}>
                              W{(activeEvent.volWindowIdx ?? 0) + 1}
                            </div>
                            {activeEvent.volHitSeq != null && (
                              <div style={{
                                fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                                padding: "2px 7px", borderRadius: 999,
                                background: "rgba(255,106,0,0.10)",
                                border: "1px solid rgba(255,106,0,0.28)",
                                color: "rgba(255,140,60,0.9)",
                              }}>
                                #{activeEvent.volHitSeq}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Bottom glow */}
                      <div style={{
                        position: "absolute", inset: 0, pointerEvents: "none",
                        background: `radial-gradient(ellipse at 50% 100%, ${modeGlow.replace("0.55","0.18")} 0%, transparent 65%)`,
                        transition: "opacity 500ms", opacity: !heatmapLoading ? 1 : 0.25,
                        borderRadius: 16,
                      }} />
                    </div>
                  </div>

                  {/* ── Right: session stats ── */}
                  <div className="ts-heatmapStatsCol">
                    <div style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                      textTransform: "uppercase", opacity: 0.40, marginBottom: 10,
                    }}>
                      Session Stats
                    </div>

                    {heatmapLoading ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                            <Skel w={`${45 + (i % 3) * 12}%`} h={11} />
                            <Skel w="22%" h={13} />
                          </div>
                        ))}
                      </div>
                    ) : summaryStats.length === 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.40, padding: "8px 0" }}>No data available</div>
                    ) : (
                      <div className="ts-summaryList">
                        {summaryStats.map((stat) => (
                          <div
                            key={stat.label}
                            className={`ts-summaryRow${stat.accent ? " isAccent" : ""}`}
                            style={stat.accent ? {
                              background: modeAccent + "12",
                              borderColor: modeAccent + "30",
                            } : undefined}
                          >
                            <span className="ts-summaryRowLabel">{stat.label}</span>
                            <span
                              className="ts-summaryRowValue"
                              style={stat.accent ? { color: modeAccent } : undefined}
                            >{stat.value}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Event Stats — matches Session Stats row style, live-updates on replay ── */}
                    {replayEvents.length > 0 && (() => {
                      const mode     = (sessionSummary?.mode ?? "power").toLowerCase();
                      const ev       = activeEvent;
                      const hasEvent = ev !== null;

                      // Value helpers
                      const evSI      = ev?.si         != null ? String(ev.si)                        : "—";
                      const evImpulse = ev?.impulse    != null ? String(ev.impulse)                   : "—";
                      const evCells   = ev             != null ? String(ev.cellCount || ev.cells.length) : "—";
                      const evAngle   = ev?.angleDeg   != null ? `${ev.angleDeg}°`                    : "—";
                      const evDur     = ev?.durationMs != null ? `${ev.durationMs} ms`                : "—";
                      const evRise    = ev?.riseMs     != null ? `${ev.riseMs} ms`                    : "—";

                      // Accuracy: pull from quality if available
                      const accPct    = sessionSummary?.quality?.accuracy_pct ?? sessionSummary?.quality?.score;
                      const evAccuracy = accPct != null ? `${Number(accPct).toFixed(1)}%` : "—";

                      // Reaction time: use the dedicated column, not duration as a proxy
                      const evReactionTime = ev?.reactionTimeMs != null ? `${ev.reactionTimeMs} ms` : "—";

                      type StatRow = { label: string; value: string; accent?: boolean };
                      let eventStatRows: StatRow[];

                      if (mode === "accuracy") {
                        eventStatRows = [
                          { label: "Accuracy",        value: evAccuracy,  accent: true },
                          { label: "Cells Hit",        value: evCells },
                          { label: "Strength Index",   value: evSI },
                          { label: "Duration",         value: evDur },
                          { label: "Angle",            value: evAngle },
                        ];
                      } else if (mode === "reaction") {
                        eventStatRows = [
                          { label: "Reaction Time",    value: evReactionTime,  accent: true },
                          { label: "Duration",         value: evDur },
                          { label: "Rise Time",        value: evRise },
                          { label: "Angle",            value: evAngle },
                        ];
                      } else if (mode === "target") {
                        const zoneLabel = (z: { row: string; col: string } | null) =>
                          z ? `${z.row.charAt(0).toUpperCase() + z.row.slice(1)} ${z.col.charAt(0).toUpperCase() + z.col.slice(1)}` : "—";
                        const evTargetZone  = ev?.targetZone  ? zoneLabel(ev.targetZone)  : "—";
                        const evZoneHit     = ev?.zoneHit     ? zoneLabel(ev.zoneHit)     : "—";
                        const evZoneCorrect = ev?.zoneCorrect != null
                          ? ev.zoneCorrect ? "✓ Correct" : "✗ Wrong"
                          : "—";
                        const correctColor  = ev?.zoneCorrect === true  ? "#00ff88"
                                            : ev?.zoneCorrect === false ? "#ff6060"
                                            : undefined;
                        eventStatRows = [
                          { label: "Zone Cued",       value: evTargetZone,   accent: true },
                          { label: "Zone Hit",        value: evZoneHit },
                          { label: "Result",          value: evZoneCorrect },
                          { label: "Reaction Time",   value: evReactionTime },
                          { label: "Strength Index",  value: evSI },
                          { label: "Cells Hit",       value: evCells },
                        ];
                        // Inject correctColor override — we'll handle it in the render below
                        (eventStatRows[2] as any).__color = correctColor;
                      } else if (mode === "volume") {
                        const evWindow  = ev?.volWindowIdx != null ? `Window ${ev.volWindowIdx + 1}` : "—";
                        const evHitSeq  = ev?.volHitSeq    != null ? `${ev.volHitSeq}`                : "—";

                        // SI vs window average — shows whether this hit is above or below
                        // the window mean, giving per-hit fatigue context during replay
                        const winData   = sessionSummary?.quality?.windows as any[] | undefined;
                        const winEntry  = winData?.find((w: any) => w.window_idx === ev?.volWindowIdx);
                        const winAvgSi  = winEntry?.avg_si as number | undefined;
                        const siNum     = ev?.si != null ? Number(ev.si) : null;
                        const siVsAvg   = siNum != null && winAvgSi != null
                          ? (() => {
                              const diff = Math.round(siNum - winAvgSi);
                              return diff > 0 ? `+${diff} vs avg` : diff < 0 ? `${diff} vs avg` : "= avg";
                            })()
                          : "—";

                        eventStatRows = [
                          { label: "Strength Index",  value: evSI,      accent: true },
                          { label: "vs Window Avg",   value: siVsAvg },
                          { label: "Window",          value: evWindow },
                          { label: "Hit #",           value: evHitSeq },
                          { label: "Cells Hit",       value: evCells },
                          { label: "Duration",        value: evDur },
                        ];
                      } else {
                        // power / default
                        eventStatRows = [
                          { label: "Strength Index",   value: evSI,        accent: true },
                          { label: "Impulse Index",    value: evImpulse },
                          { label: "Cells Hit",        value: evCells },
                          { label: "Angle",            value: evAngle },
                        ];
                      }

                      return (
                        <div style={{ marginTop: 14 }}>
                          {/* Header — same style as "Session Stats" label above */}
                          <div style={{
                            display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                          }}>
                            <div style={{
                              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                              textTransform: "uppercase", opacity: 0.40,
                            }}>
                              Event Stats
                            </div>
                            {/* Live pulse dot */}
                            <div style={{
                              width: 5, height: 5, borderRadius: "50%",
                              background: hasEvent ? modeAccent : "rgba(255,255,255,0.18)",
                              boxShadow: hasEvent ? `0 0 5px 2px ${modeAccent}55` : "none",
                              transition: "background 200ms, box-shadow 200ms",
                            }} />
                          </div>

                          {/* Rows — identical markup to ts-summaryRow */}
                          <div className="ts-summaryList">
                            {eventStatRows.map((row) => {
                              const customColor = (row as any).__color;
                              return (
                                <div
                                  key={row.label}
                                  className={`ts-summaryRow${row.accent ? " isAccent" : ""}`}
                                  style={row.accent ? {
                                    background: modeAccent + "12",
                                    borderColor: modeAccent + "30",
                                  } : undefined}
                                >
                                  <span className="ts-summaryRowLabel">{row.label}</span>
                                  <span
                                    className="ts-summaryRowValue"
                                    style={{
                                      color: customColor ?? (row.accent ? modeAccent : undefined),
                                      opacity: hasEvent ? 1 : 0.30,
                                      transition: "opacity 200ms ease",
                                    }}
                                  >
                                    {row.value}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Strike View 3D — hidden on phone/tablet (≤1024px) ── */}
                    <div className="ts-strikeCompassWrap">
                      {sessionSummary && (
                        <StrikeCompass
                          activeEvent={activeEvent ?? null}
                          activeAngle={activeEvent?.angleDeg ?? null}
                          anglesDeg={sessionSummary.angles_deg}
                          isReplaying={isReplaying}
                          modeAccent={modeAccent}
                          modeGlow={modeGlow}
                          isDark={isDark}
                        />
                      )}
                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* AI Insights */}
            <div className="ts-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Coaching Insights</div>
                <div className="ts-cardMeta">
                  {coachInsights.filter(i => i.priority === "high").length > 0
                    ? `${coachInsights.filter(i => i.priority === "high").length} high-priority`
                    : `${coachInsights.length} insight${coachInsights.length !== 1 ? "s" : ""}`}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto", minHeight: 0 }}>
                {coachInsights.map((insight, idx) => {
                  const tagColors: Record<string, { bg: string; border: string; color: string }> = {
                    Power:       { bg: "rgba(180,0,255,0.10)",  border: "rgba(180,0,255,0.30)",  color: "rgba(210,140,255,0.95)" },
                    Accuracy:    { bg: "rgba(0,220,255,0.09)",  border: "rgba(0,220,255,0.28)",  color: "rgba(80,220,255,0.95)"  },
                    Reaction:    { bg: "rgba(255,200,0,0.09)",  border: "rgba(255,200,0,0.28)",  color: "rgba(255,210,60,0.95)"  },
                    Consistency: { bg: "rgba(80,220,160,0.09)", border: "rgba(80,220,160,0.26)", color: "rgba(80,220,160,0.95)"  },
                    Fatigue:     { bg: "rgba(255,100,80,0.09)", border: "rgba(255,100,80,0.26)", color: "rgba(255,130,110,0.95)" },
                    Tempo:       { bg: "rgba(255,170,0,0.09)",  border: "rgba(255,170,0,0.26)",  color: "rgba(255,190,60,0.95)"  },
                    Volume:      { bg: "rgba(255,106,0,0.09)",  border: "rgba(255,106,0,0.28)",  color: "rgba(255,140,60,0.95)"  },
                    Target:      { bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.26)",  color: "rgba(0,210,100,0.95)"   },
                  };
                  const priorityDot: Record<string, string> = {
                    high:   "#ff5f5f",
                    medium: "#ffcc00",
                    low:    "rgba(255,255,255,0.22)",
                  };
                  const tc = tagColors[insight.tag] ?? tagColors.Power;
                  const ink = isDark ? "255,255,255" : "20,20,40";

                  return (
                    <div key={idx} style={{
                      borderRadius: 12,
                      border: `1px solid rgba(${ink},${isDark ? "0.08" : "0.10"})`,
                      background: `rgba(${ink},${isDark ? "0.03" : "0.025"})`,
                      overflow: "hidden",
                    }}>
                      {/* Header row */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px 8px",
                        borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`,
                      }}>
                        {/* Priority dot */}
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                          background: priorityDot[insight.priority],
                          boxShadow: insight.priority === "high" ? "0 0 6px #ff5f5faa" : "none",
                        }} />
                        {/* Tag pill */}
                        <div style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: "0.07em",
                          textTransform: "uppercase", padding: "2px 8px",
                          borderRadius: 999, background: tc.bg, border: `1px solid ${tc.border}`, color: tc.color,
                          flexShrink: 0,
                        }}>
                          {insight.tag}
                        </div>
                        {/* Headline */}
                        <div style={{
                          fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0,
                          color: `rgba(${ink},0.90)`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {insight.headline}
                        </div>
                      </div>

                      {/* Numbers row */}
                      {insight.numbers.length > 0 && (
                        <div style={{
                          display: "flex", gap: 0,
                          borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`,
                          overflowX: "auto",
                        }}>
                          {insight.numbers.map((n, ni) => (
                            <div key={ni} style={{
                              flex: "1 0 auto",
                              padding: "8px 14px",
                              borderRight: ni < insight.numbers.length - 1
                                ? `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})` : "none",
                              minWidth: 80,
                            }}>
                              <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.45, marginBottom: 3, whiteSpace: "nowrap" }}>
                                {n.label}
                              </div>
                              <div style={{
                                fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                                color: n.deltaDir === "up"
                                  ? tc.color
                                  : n.deltaDir === "down"
                                  ? (isDark ? "rgba(255,100,80,0.90)" : "rgba(200,50,40,0.90)")
                                  : `rgba(${ink},0.88)`,
                                lineHeight: 1.2,
                              }}>
                                {n.value}
                              </div>
                              {n.delta && (
                                <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2, whiteSpace: "nowrap" }}>
                                  {n.delta}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Coaching cue */}
                      <div style={{
                        padding: "9px 14px 11px",
                        display: "flex", alignItems: "flex-start", gap: 8,
                      }}>
                        {/* Whistle / coach icon */}
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                          style={{ flexShrink: 0, marginTop: 1, opacity: 0.45 }}>
                          <circle cx="5.5" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                          <path d="M8.5 6l3-3M8.5 5h3v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.78, color: `rgba(${ink},0.88)` }}>
                          {insight.cue}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* In-Depth Athlete Analysis */}
            <div ref={analysisCardRef} className="ts-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">In-Depth Analysis</div>
                <div className="ts-cardMeta">
                  {analysisAthleteId
                    ? analysisLoading ? "Loading…"
                    : `${analysisSessions.length} session${analysisSessions.length !== 1 ? "s" : ""} · ${analysisAthleteName}`
                    : "Select an athlete"}
                </div>
              </div>

              {/* Athlete picker */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                    style={{ position: "absolute", left: 10, pointerEvents: "none", opacity: 0.5, flexShrink: 0 }}>
                    <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <select
                    value={analysisAthleteId ?? ""}
                    onChange={(e) => {
                      const id   = e.target.value;
                      const name = analysisAthleteOptions.find(a => a.id === id)?.name ?? "—";
                      setAnalysisAthleteId(id || null);
                      setAnalysisAthleteName(name);
                    }}
                    style={{
                      background: analysisAthleteId ? "rgba(180,0,255,0.14)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(20,20,40,0.05)"),
                      border: analysisAthleteId ? "1px solid rgba(180,0,255,0.45)" : `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(20,20,40,0.14)"}`,
                      borderRadius: 10,
                      color: analysisAthleteId ? "rgba(210,140,255,0.95)" : "inherit",
                      font: "inherit", fontSize: 12, fontWeight: 700,
                      padding: "7px 14px 7px 30px",
                      cursor: "pointer", outline: "none", appearance: "none",
                      minWidth: 180,
                      transition: "background 150ms ease, border-color 150ms ease",
                    }}
                  >
                    <option value="">Select athlete…</option>
                    {analysisAthleteOptions.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                {analysisAthleteId && (
                  <button
                    type="button"
                    onClick={() => { setAnalysisAthleteId(null); setAnalysisAthleteName("—"); setAnalysisSessions([]); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: "transparent",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(20,20,40,0.14)"}`,
                      borderRadius: 10, color: isDark ? "rgba(255,255,255,0.40)" : "rgba(20,20,40,0.40)",
                      font: "inherit", fontSize: 11, fontWeight: 700, padding: "7px 11px", cursor: "pointer",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                    Clear
                  </button>
                )}
              </div>

              {/* Empty / loading states */}
              {!analysisAthleteId && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.32, fontSize: 13, textAlign: "center", padding: "0 16px" }}>
                  Choose an athlete above to see their individual breakdown across all session types.
                </div>
              )}
              {analysisAthleteId && analysisLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Overview strip skeleton */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderRadius: 10, overflow: "hidden", border: `1px solid rgba(128,128,128,0.1)` }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{ padding: "10px 12px", borderRight: i < 2 ? "1px solid rgba(128,128,128,0.1)" : "none" }}>
                        <Skel w="50%" h={9} style={{ marginBottom: 6 }} />
                        <Skel w="65%" h={15} />
                      </div>
                    ))}
                  </div>
                  {/* Tab buttons skeleton */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skel key={i} w="100%" h={52} r={10} />
                    ))}
                  </div>
                  {/* Stat rows skeleton */}
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                      <Skel w={`${40 + (i % 3) * 14}%`} h={11} />
                      <Skel w="20%" h={13} />
                    </div>
                  ))}
                </div>
              )}
              {analysisAthleteId && !analysisLoading && analysisSessions.length === 0 && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.35, fontSize: 13, textAlign: "center", padding: "0 16px" }}>
                  No sessions recorded yet for {analysisAthleteName}.
                </div>
              )}

              {/* Full analysis */}
              {analysisAthleteId && !analysisLoading && athleteAnalysis && (() => {
                const a   = athleteAnalysis;
                const ink = isDark ? "255,255,255" : "20,20,40";
                const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`;

                function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
                  if (values.length < 2) return <span style={{ opacity: 0.3, fontSize: 11 }}>not enough data</span>;
                  const W = 160, H = height;
                  const min = Math.min(...values), max = Math.max(...values);
                  const range = Math.max(max - min, 1);
                  const pts = values.map((v, i) => {
                    const x = (i / (values.length - 1)) * W;
                    const y = H - ((v - min) / range) * (H - 6) - 3;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  const dotPts = values.map((v, i) => ({
                    x: (i / (values.length - 1)) * W,
                    y: H - ((v - min) / range) * (H - 6) - 3,
                  }));
                  return (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
                      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
                      {dotPts.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} opacity="0.7"/>
                      ))}
                    </svg>
                  );
                }

                function StatRow({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "good" | "warn" | "bad" }) {
                  const valColor = highlight === "good" ? (isDark ? "rgba(80,220,160,0.95)" : "rgba(20,140,90,0.95)")
                                 : highlight === "warn" ? (isDark ? "rgba(255,200,60,0.95)" : "rgba(180,120,0,0.95)")
                                 : highlight === "bad"  ? (isDark ? "rgba(255,100,80,0.95)" : "rgba(180,50,30,0.95)")
                                 : `rgba(${ink},0.88)`;
                  return (
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: divider }}>
                      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.5 }}>{label}</span>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: valColor }}>{value}</span>
                        {sub && <span style={{ fontSize: 10, opacity: 0.4 }}>{sub}</span>}
                      </span>
                    </div>
                  );
                }

                const totalMins = Math.round(a.totalDurMs / 60000);
                const durFmt    = totalMins >= 60 ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : `${totalMins}m`;

                // Section config — drives the accordion tabs
                type SectionKey = "power" | "accuracy" | "reaction" | "form";
                const sections: { key: SectionKey; icon: string; label: string; count?: number; accent: string; accentBg: string; accentBdr: string; hasData: boolean }[] = [
                  { key: "power",    icon: "💥", label: "Power",        count: a.stdCount,   accent: "#b400ff", accentBg: "rgba(180,0,255,0.09)",  accentBdr: "rgba(180,0,255,0.25)", hasData: a.strengthTrend.length > 0 },
                  { key: "accuracy", icon: "🎯", label: "Accuracy",     count: a.accCount,   accent: "#00dcff", accentBg: "rgba(0,220,255,0.07)",   accentBdr: "rgba(0,220,255,0.22)", hasData: a.accMetrics.length > 0 },
                  { key: "reaction", icon: "⚡️", label: "Reaction",     count: a.reactCount, accent: "#ffcc00", accentBg: "rgba(255,200,0,0.07)",   accentBdr: "rgba(255,200,0,0.22)", hasData: a.reactMetrics.length > 0 },
                  { key: "form",     icon: "📐", label: "Form & Angle", count: undefined,    accent: isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)", accentBg: `rgba(${ink},0.05)`, accentBdr: `rgba(${ink},0.14)`, hasData: a.avgAngle != null },
                ];

                const activeSection = sections.find(s => s.key === analysisSection) ?? sections[0];

                return (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

                    {/* ── Overview strip ── */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 0, borderRadius: 10, overflow: "hidden",
                      border: divider, marginBottom: 14, flexShrink: 0,
                    }}>
                      {[
                        { label: "Sessions",  value: String(a.total) },
                        { label: "Strikes",   value: a.totalEvents.toLocaleString() },
                        { label: "Bag Time",  value: durFmt },
                      ].map((item, i, arr) => (
                        <div key={item.label} style={{
                          padding: "10px 12px",
                          borderRight: i < arr.length - 1 ? divider : "none",
                          background: `rgba(${ink},${isDark ? "0.03" : "0.02"})`,
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, marginBottom: 3 }}>{item.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Accordion tab row ── */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 4, marginBottom: 12, flexShrink: 0,
                    }}>
                      {sections.map(sec => {
                        const isActive = analysisSection === sec.key;
                        return (
                          <button
                            key={sec.key}
                            type="button"
                            onClick={() => setAnalysisSection(sec.key)}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              gap: 3, padding: "8px 4px",
                              borderRadius: 10,
                              border: isActive ? `1px solid ${sec.accentBdr}` : `1px solid rgba(${ink},${isDark ? "0.10" : "0.10"})`,
                              background: isActive ? sec.accentBg : `rgba(${ink},${isDark ? "0.03" : "0.02"})`,
                              cursor: "pointer", font: "inherit",
                              transition: "background 150ms ease, border-color 150ms ease",
                              opacity: !sec.hasData && !isActive ? 0.42 : 1,
                            }}
                          >
                            <span style={{ fontSize: 15, lineHeight: 1 }}>{sec.icon}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 800, letterSpacing: "0.04em",
                              textTransform: "uppercase", lineHeight: 1,
                              color: isActive ? sec.accent : `rgba(${ink},0.55)`,
                              transition: "color 150ms ease",
                            }}>{sec.label}</span>
                            {sec.count != null && (
                              <span style={{ fontSize: 9, opacity: 0.38, lineHeight: 1 }}>{sec.count} sess.</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Active section content (scrollable) ── */}
                    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

                      {/* POWER */}
                      {analysisSection === "power" && (
                        <div>
                          {a.strengthTrend.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No power sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Consistency score" value={a.consistencyPct != null ? `${a.consistencyPct}%` : "—"} sub="avg/peak ratio" highlight={a.consistencyPct == null ? undefined : a.consistencyPct >= 80 ? "good" : a.consistencyPct >= 60 ? "warn" : "bad"} />
                              <StatRow label="Latest peak index" value={String(a.strengthTrend[a.strengthTrend.length - 1].peak)} sub="/ 1000" highlight={a.strengthTrend[a.strengthTrend.length - 1].peak >= 700 ? "good" : a.strengthTrend[a.strengthTrend.length - 1].peak >= 450 ? "warn" : "bad"} />
                              <StatRow label="Session trend" value={a.fatigueNote ?? "—"} highlight={a.fatigueNote?.includes("up") ? "good" : a.fatigueNote?.includes("down") ? "bad" : "warn"} />
                              {a.cadenceTrend.length > 0 && <StatRow label="Avg cadence" value={`${(a.cadenceTrend.reduce((s, r) => s + r.hz, 0) / a.cadenceTrend.length).toFixed(1)} Hz`} />}
                              {a.strengthTrend.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Peak strength index over time</div>
                                  <Sparkline values={a.strengthTrend.map(r => r.peak)} color="#b400ff" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(180,0,255,0.08)", border: "1px solid rgba(180,0,255,0.18)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.consistencyPct != null && a.consistencyPct < 65
                                  ? `Consistency is low (${a.consistencyPct}%). Drill 8-count continuous combos to raise the floor.`
                                  : a.fatigueNote?.includes("down")
                                  ? `Output trending down. Prioritize recovery and focus on quality over quantity next session.`
                                  : a.fatigueNote?.includes("up")
                                  ? `Strength trending up. Add 10% volume or intensity next session.`
                                  : `Output is stable. Introduce power-interval training to break the plateau.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* ACCURACY */}
                      {analysisSection === "accuracy" && (
                        <div>
                          {a.accMetrics.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No accuracy sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Latest score" value={a.latestAccScore != null ? `${a.latestAccScore.toFixed(1)}%` : "—"} highlight={a.latestAccScore == null ? undefined : a.latestAccScore >= 80 ? "good" : a.latestAccScore >= 60 ? "warn" : "bad"} />
                              {a.accDrift != null && <StatRow label="Accuracy drift" value={`${a.accDrift > 0 ? "+" : ""}${a.accDrift}%`} sub="first → latest" highlight={a.accDrift > 5 ? "good" : a.accDrift < -5 ? "bad" : "warn"} />}
                              {a.accMetrics[a.accMetrics.length - 1]?.offset != null && <StatRow label="Avg offset (latest)" value={`${a.accMetrics[a.accMetrics.length - 1].offset!.toFixed(0)} mm`} highlight={a.accMetrics[a.accMetrics.length - 1].offset! < 20 ? "good" : a.accMetrics[a.accMetrics.length - 1].offset! < 40 ? "warn" : "bad"} />}
                              {a.accMetrics.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Accuracy % over time</div>
                                  <Sparkline values={a.accMetrics.map(r => r.score)} color="#00dcff" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(0,220,255,0.07)", border: "1px solid rgba(0,220,255,0.18)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.latestAccScore != null && a.latestAccScore < 60
                                  ? `Score below 60% — slow to target-lock fundamentals. 3×10 deliberate reps before adding speed every session.`
                                  : a.accDrift != null && a.accDrift < -8
                                  ? `Accuracy regressing (${a.accDrift}%). Reintroduce slow-speed form work before adding power.`
                                  : a.accDrift != null && a.accDrift > 8
                                  ? `Accuracy improving (+${a.accDrift}%). Introduce tighter targets or longer combos to maintain challenge.`
                                  : `Accuracy is stable. Add moving-target or reaction-accuracy combos to push further.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* REACTION */}
                      {analysisSection === "reaction" && (
                        <div>
                          {a.reactMetrics.length === 0 ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No reaction sessions recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Latest avg reaction" value={a.latestReactAvg != null ? `${a.latestReactAvg} ms` : "—"} highlight={a.latestReactAvg == null ? undefined : a.latestReactAvg < 400 ? "good" : a.latestReactAvg < 650 ? "warn" : "bad"} />
                              <StatRow label="Best ever reaction" value={a.reactMetrics.reduce((b, r) => r.best != null && r.best < b ? r.best : b, Infinity) < Infinity ? `${a.reactMetrics.reduce((b, r) => r.best != null && r.best < b ? r.best : b, Infinity)} ms` : "—"} highlight="good" />
                              {a.reactDrift != null && <StatRow label="Reaction drift" value={`${a.reactDrift > 0 ? "+" : ""}${a.reactDrift} ms`} sub="first → latest" highlight={a.reactDrift < -20 ? "good" : a.reactDrift > 20 ? "bad" : "warn"} />}
                              {a.reactMetrics.length >= 2 && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Avg reaction ms over time (lower = better)</div>
                                  <Sparkline values={a.reactMetrics.map(r => r.avg)} color="#ffcc00" />
                                </div>
                              )}
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.20)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {a.latestReactAvg != null && a.latestReactAvg > 700
                                  ? `Reaction time is slow. Start with predictable-cue drills, then add random timing once avg drops below 600 ms.`
                                  : a.reactDrift != null && a.reactDrift > 30
                                  ? `Reaction slowing (+${a.reactDrift} ms). Vary cue signal timing to prevent anticipation.`
                                  : a.reactDrift != null && a.reactDrift < -30
                                  ? `Reaction improving (${a.reactDrift} ms). Push with multi-cue sequences.`
                                  : `Reaction is stable. Introduce random-delay cues and mixed-target sessions to break ceiling.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* FORM & ANGLE */}
                      {analysisSection === "form" && (
                        <div>
                          {a.avgAngle == null ? (
                            <div style={{ opacity: 0.35, fontSize: 12, padding: "16px 0" }}>No angle data recorded yet.</div>
                          ) : (
                            <>
                              <StatRow label="Avg strike angle" value={`${a.avgAngle.toFixed(1)}°`} highlight={Math.abs(a.avgAngle) < 8 ? "good" : Math.abs(a.avgAngle) < 16 ? "warn" : "bad"} />
                              <StatRow label="Bias direction" value={Math.abs(a.avgAngle) < 5 ? "Neutral" : a.avgAngle > 0 ? "Leans right / forward" : "Leans left / back"} highlight={Math.abs(a.avgAngle) < 5 ? "good" : "warn"} />
                              <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: `rgba(${ink},0.05)`, border: `1px solid rgba(${ink},0.12)`, fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                                {Math.abs(a.avgAngle) < 6
                                  ? `Angle is neutral — good form consistency. Monitor for drift under fatigue.`
                                  : Math.abs(a.avgAngle) < 14
                                  ? `Slight ${a.avgAngle > 0 ? "forward/right" : "back/left"} bias (${a.avgAngle.toFixed(1)}°). Cue: square shoulders, drive elbow through center of target.`
                                  : `Significant angle bias (${a.avgAngle.toFixed(1)}°). Address with form-only drills before adding power — injury risk is elevated.`}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                    </div>

                    {/* ── Performance Radar Chart ── */}
                    {(() => {
                      // ── Helper: derive 5 axis scores from a session slice ────────────
                      function computeAxes(sessions: typeof analysisSessions) {
                        const std   = sessions.filter(s => s.mode.toLowerCase() === "power");
                        const acc   = sessions.filter(s => s.mode.toLowerCase() === "accuracy");
                        const react = sessions.filter(s => s.mode.toLowerCase() === "reaction");

                        const strPeaks = std.map(s => {
                          const si = s.quality?.strength_index;
                          if (si?.max != null) return Math.round(si.max);
                          const pfs = s.peak_force_stats;
                          const pMv = pfs?.peak_mv ?? (pfs?.peak_v != null ? pfs.peak_v * 1000 : null);
                          return pMv != null ? Math.round((pMv / 3320) * 1000) : null;
                        }).filter((v): v is number => v != null);
                        const latestPeak  = strPeaks.length > 0 ? strPeaks[strPeaks.length - 1] : null;
                        const powerScore  = latestPeak != null ? Math.min(100, Math.round(latestPeak / 10)) : null;

                        const accScores   = acc.map(s => {
                          const v = s.quality?.accuracy_pct ?? s.quality?.score ?? null;
                          return v != null ? Math.min(100, Math.round(Number(v))) : null;
                        }).filter((v): v is number => v != null);
                        const accuracyScore = accScores.length > 0 ? accScores[accScores.length - 1] : null;

                        const reactAvgs   = react.map(s => s.quality?.avg_reaction_ms ?? null).filter((v): v is number => v != null);
                        const latestReact = reactAvgs.length > 0 ? reactAvgs[reactAvgs.length - 1] : null;
                        const reactionScore = latestReact != null
                          ? Math.max(0, Math.min(100, Math.round(((800 - latestReact) / 600) * 100))) : null;

                        const conPairs = std.map(s => {
                          const si = s.quality?.strength_index;
                          return si?.max != null && si?.mean != null ? si.mean / si.max : null;
                        }).filter((v): v is number => v != null);
                        const consistencyScore = conPairs.length > 0
                          ? Math.round(conPairs.reduce((a, b) => a + b, 0) / conPairs.length * 100) : null;

                        const volumeScore = Math.min(100, Math.round((sessions.length / 20) * 100));

                        return [
                          { label: "Power",       score: powerScore,       color: "#b400ff", noDataLabel: "Need power sessions" },
                          { label: "Accuracy",    score: accuracyScore,    color: "#00dcff", noDataLabel: "Need accuracy sessions" },
                          { label: "Reaction",    score: reactionScore,    color: "#ffcc00", noDataLabel: "Need reaction sessions" },
                          { label: "Consistency", score: consistencyScore, color: "#00ff88", noDataLabel: "Need 2+ power sessions" },
                          { label: "Volume",      score: volumeScore,      color: "#ff6a00", noDataLabel: "" },
                        ];
                      }

                      // ── Window slices ────────────────────────────────────────────────
                      const cut30 = new Date(); cut30.setDate(cut30.getDate() - 30);
                      const cut90 = new Date(); cut90.setDate(cut90.getDate() - 90);
                      const sessions30d = analysisSessions.filter(s => s.date_of_record >= cut30.toISOString());
                      const sessions90d = analysisSessions.filter(s => s.date_of_record >= cut90.toISOString());
                      const sessionsAll = analysisSessions;

                      // Active polygon is always 30d (most recent performance)
                      type RadarAxis = { label: string; score: number | null; color: string; noDataLabel: string };
                      const axes: RadarAxis[]      = computeAxes(sessions30d);
                      // Ghost / baseline polygon is the comparison window
                      const ghostAxes: RadarAxis[] = radarWindow === "all"
                        ? computeAxes(sessionsAll)
                        : computeAxes(sessions90d);
                      const ghostLabel = radarWindow === "all" ? "All time" : "90d";

                      const hasAnyData = axes.some(ax => ax.score != null) || sessionsAll.length > 0;

                      // Composite score from 30d active window
                      const scoredAxes = axes.filter(ax => ax.score != null);
                      const compositeScore = scoredAxes.length > 0
                        ? Math.round(scoredAxes.reduce((s, ax) => s + ax.score!, 0) / scoredAxes.length) : null;
                      const compositeTier  = compositeScore == null ? null
                        : compositeScore >= 75 ? "Elite"
                        : compositeScore >= 55 ? "Advanced"
                        : compositeScore >= 35 ? "Developing"
                        : "Beginner";
                      const compositeColor = compositeScore == null ? "rgba(255,255,255,0.4)"
                        : compositeScore >= 75 ? "#00ff88"
                        : compositeScore >= 55 ? "#ffcc00"
                        : compositeScore >= 35 ? "#ff6a00"
                        : "#ff6060";

                      // SVG radar geometry
                      const CX = 155, CY = 140, R = 95;
                      const N = axes.length;
                      const angleStep = (2 * Math.PI) / N;
                      const angleFor = (i: number) => -Math.PI / 2 + i * angleStep;

                      function polarToXY(angle: number, radius: number) {
                        return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
                      }

                      function buildPath(axList: RadarAxis[]) {
                        return axList.map((ax, i) => {
                          const r = ((ax.score ?? 0) / 100) * R;
                          const p = polarToXY(angleFor(i), r);
                          return `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
                        }).join(" ") + " Z";
                      }

                      const activePath = buildPath(axes);
                      const ghostPath  = buildPath(ghostAxes);
                      const rings = [25, 50, 75, 100];

                      // Label positions
                      const LABEL_R = R + 24;

                      return (
                        <div style={{
                          marginTop: 20,
                          paddingTop: 16,
                          borderTop: divider,
                          flexShrink: 0,
                        }}>
                          {/* Header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.55, marginBottom: 2 }}>
                                Performance Profile
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                {/* Legend */}
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ width: 20, height: 2, background: "rgba(180,0,255,0.7)", borderRadius: 1 }} />
                                  <span style={{ fontSize: 10, opacity: 0.55 }}>30d (current)</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ width: 20, height: 2, background: isDark ? "rgba(255,255,255,0.25)" : "rgba(20,20,40,0.25)", borderRadius: 1, borderTop: `1px dashed ${isDark ? "rgba(255,255,255,0.35)" : "rgba(20,20,40,0.35)"}` }} />
                                  <span style={{ fontSize: 10, opacity: 0.45 }}>{ghostLabel} (baseline)</span>
                                </div>
                              </div>
                            </div>
                            {/* Window toggle */}
                            <div style={{
                              display: "inline-flex", alignItems: "center",
                              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)",
                              border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`,
                              borderRadius: 8, padding: 2, gap: 2,
                            }}>
                              {(["90d", "all"] as const).map(w => {
                                const isActive = radarWindow === w;
                                return (
                                  <button
                                    key={w}
                                    type="button"
                                    onClick={() => setRadarWindow(w)}
                                    style={{
                                      padding: "4px 10px", borderRadius: 6, border: "none",
                                      background: isActive
                                        ? (isDark ? "rgba(180,0,255,0.22)" : "rgba(180,0,255,0.14)")
                                        : "transparent",
                                      color: isActive ? "rgba(210,140,255,0.95)" : (isDark ? "rgba(255,255,255,0.40)" : "rgba(20,20,40,0.40)"),
                                      font: "inherit", fontSize: 11, fontWeight: 700,
                                      cursor: "pointer", transition: "all 140ms ease",
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {w === "90d" ? "vs 90d" : "vs All"}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {!hasAnyData ? (
                            <div style={{ textAlign: "center", padding: "24px 0", opacity: 0.32, fontSize: 12 }}>
                              Record sessions across different modes to build your performance profile.
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                              {/* SVG radar */}
                              <div style={{ flexShrink: 0 }}>
                                <svg
                                  width={310} height={280}
                                  viewBox="0 0 310 280"
                                  style={{ display: "block", overflow: "visible" }}
                                >
                                  {/* Concentric grid rings */}
                                  {rings.map(pct => {
                                    const ringR = (pct / 100) * R;
                                    const ringPts = Array.from({ length: N }, (_, i) => {
                                      const p = polarToXY(angleFor(i), ringR);
                                      return `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
                                    }).join(" ") + " Z";
                                    return (
                                      <g key={pct}>
                                        <path d={ringPts} fill="none"
                                          stroke={`rgba(${isDark ? "255,255,255" : "20,20,40"},${pct === 100 ? "0.14" : "0.07"})`}
                                          strokeWidth={pct === 100 ? 1.2 : 0.8}
                                          strokeDasharray={pct === 100 ? undefined : "3 3"}
                                        />
                                        <text
                                          x={CX} y={CY - ringR - 3}
                                          textAnchor="middle" fontSize="8"
                                          fill={`rgba(${isDark ? "255,255,255" : "20,20,40"},0.25)`}
                                          fontFamily="inherit"
                                        >{pct}</text>
                                      </g>
                                    );
                                  })}

                                  {/* Spoke lines */}
                                  {axes.map((_, i) => {
                                    const outer = polarToXY(angleFor(i), R);
                                    return (
                                      <line key={i}
                                        x1={CX} y1={CY}
                                        x2={outer.x.toFixed(2)} y2={outer.y.toFixed(2)}
                                        stroke={`rgba(${isDark ? "255,255,255" : "20,20,40"},0.10)`}
                                        strokeWidth="1"
                                      />
                                    );
                                  })}

                                  {/* Ghost / baseline polygon — dashed outline, no fill */}
                                  <path
                                    d={ghostPath}
                                    fill="none"
                                    stroke={isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.20)"}
                                    strokeWidth="1.5"
                                    strokeDasharray="5 3"
                                    strokeLinejoin="round"
                                  />

                                  {/* Active / 30d polygon — solid fill */}
                                  <path
                                    d={activePath}
                                    fill="rgba(180,0,255,0.13)"
                                    stroke="rgba(180,0,255,0.65)"
                                    strokeWidth="2"
                                    strokeLinejoin="round"
                                  />

                                  {/* Per-axis colored score dots (30d active) */}
                                  {axes.map((ax, i) => {
                                    const score = ax.score ?? 0;
                                    const r = (score / 100) * R;
                                    const pt = polarToXY(angleFor(i), r);
                                    if (ax.score == null) return null;
                                    return (
                                      <circle key={i}
                                        cx={pt.x.toFixed(2)} cy={pt.y.toFixed(2)}
                                        r="4.5"
                                        fill={ax.color}
                                        stroke={isDark ? "rgba(10,10,14,0.9)" : "rgba(255,255,255,0.9)"}
                                        strokeWidth="1.5"
                                      />
                                    );
                                  })}

                                  {/* Composite score in center */}
                                  {compositeScore != null && (
                                    <g>
                                      <rect
                                        x={CX - 28} y={CY - 26}
                                        width={56} height={38}
                                        rx={8}
                                        fill={isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)"}
                                        stroke={compositeColor}
                                        strokeWidth="1.5"
                                        strokeOpacity="0.45"
                                      />
                                      <text
                                        x={CX} y={CY - 6}
                                        textAnchor="middle"
                                        fontSize="28" fontWeight="900"
                                        fill={compositeColor}
                                        fontFamily="inherit"
                                        style={{ filter: `drop-shadow(0 0 12px ${compositeColor}) drop-shadow(0 0 4px ${compositeColor})` }}
                                      >{compositeScore}</text>
                                      <text
                                        x={CX} y={CY + 9}
                                        textAnchor="middle"
                                        fontSize="7" fontWeight="800"
                                        fill={compositeColor}
                                        opacity="0.90"
                                        fontFamily="inherit"
                                        letterSpacing="0.10em"
                                      >{compositeTier?.toUpperCase()}</text>
                                    </g>
                                  )}

                                  {/* Axis labels — always middle-anchored, score stacks centered below */}
                                  {axes.map((ax, i) => {
                                    const angle = angleFor(i);
                                    const lp = polarToXY(angle, LABEL_R + 6);
                                    return (
                                      <g key={i}>
                                        <text
                                          x={lp.x.toFixed(2)} y={lp.y.toFixed(2)}
                                          textAnchor="middle"
                                          fontSize="10" fontWeight="700"
                                          fill={ax.score != null ? ax.color : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.28)`}
                                          fontFamily="inherit"
                                        >
                                          {ax.label}
                                        </text>
                                        {ax.score != null && (
                                          <text
                                            x={lp.x.toFixed(2)} y={(lp.y + 13).toFixed(2)}
                                            textAnchor="middle"
                                            fontSize="10" fontWeight="900"
                                            fill={ax.color}
                                            fontFamily="inherit"
                                          >
                                            {ax.score}
                                          </text>
                                        )}
                                      </g>
                                    );
                                  })}
                                </svg>
                              </div>

                              {/* Priority callouts */}
                              <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 7, paddingTop: 4 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.35, marginBottom: 2 }}>
                                  Priority Areas
                                </div>
                                {axes
                                  .filter(ax => ax.score != null)
                                  .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
                                  .map((ax, i) => {
                                    const score = ax.score!;
                                    const tier = score >= 75 ? "strong" : score >= 45 ? "developing" : "priority";
                                    const tierColor = tier === "strong"
                                      ? (isDark ? "rgba(80,220,160,0.9)" : "rgba(20,140,90,0.9)")
                                      : tier === "developing"
                                      ? (isDark ? "rgba(255,200,60,0.9)" : "rgba(160,110,0,0.9)")
                                      : (isDark ? "rgba(255,100,80,0.9)" : "rgba(180,50,30,0.9)");
                                    const tierBg = tier === "strong"
                                      ? (isDark ? "rgba(80,220,160,0.08)" : "rgba(20,140,90,0.06)")
                                      : tier === "developing"
                                      ? (isDark ? "rgba(255,200,60,0.07)" : "rgba(160,110,0,0.05)")
                                      : (isDark ? "rgba(255,100,80,0.09)" : "rgba(180,50,30,0.07)");

                                    return (
                                      <div key={ax.label} style={{
                                        display: "flex", alignItems: "center", gap: 8,
                                        padding: "7px 10px", borderRadius: 8,
                                        background: i === 0 ? tierBg : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.025)`,
                                        border: `1px solid ${i === 0 ? ax.color + "33" : `rgba(${isDark ? "255,255,255" : "20,20,40"},0.07)`}`,
                                      }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: ax.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 11, fontWeight: 700 }}>{ax.label}</span>
                                            {i === 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: tierBg, border: `1px solid ${ax.color}44`, color: tierColor, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                              {tier === "priority" ? "Focus here" : tier}
                                            </span>}
                                          </div>
                                          {/* Bar */}
                                          <div style={{ height: 4, borderRadius: 2, background: `rgba(${isDark ? "255,255,255" : "20,20,40"},0.08)` }}>
                                            <div style={{
                                              height: "100%", borderRadius: 2,
                                              width: `${score}%`,
                                              background: ax.color,
                                              transition: "width 600ms cubic-bezier(0.34,1.2,0.64,1)",
                                              boxShadow: i === 0 ? `0 0 8px 1px ${ax.color}55` : "none",
                                            }} />
                                          </div>
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 900, color: ax.color, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{score}</span>
                                      </div>
                                    );
                                  })}
                                {/* Missing data note */}
                                {axes.filter(ax => ax.score == null).length > 0 && (
                                  <div style={{ fontSize: 10, opacity: 0.32, marginTop: 4, lineHeight: 1.5 }}>
                                    {axes.filter(ax => ax.score == null).map(ax => ax.noDataLabel).filter(Boolean).join(" · ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}
            </div>

            {/* Charts & Graphs */}
            <div className="ts-card ts-span2 ts-chartsCard" style={{ gridColumn: "1 / -1" }}>
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Charts & Graphs</div>
                <div className="ts-cardMeta">
                  {chartEntityA && chartEntityB
                    ? `${chartEntityA.label} vs ${chartEntityB.label}`
                    : chartEntityA ? chartEntityA.label
                    : "Select entities to compare"}
                </div>
              </div>

              {(() => {
                const ink = isDark ? "255,255,255" : "20,20,40";
                const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.09"})`;

                // ── Metric labels & units ───────────────────────────────────
                const metricMeta: Record<ChartMetric, { label: string; unit: string; mode: string; description: string }> = {
                  strength: { label: "Strength Index",   unit: "/ 1000", mode: "Power sessions", description: "Peak strength index (0–1000) per week" },
                  accuracy: { label: "Accuracy Score",   unit: "%",      mode: "Accuracy sessions", description: "Avg accuracy % per week" },
                  reaction: { label: "Reaction Time",    unit: "ms",     mode: "Reaction sessions", description: "Avg reaction time per week (lower = better)" },
                  volume:   { label: "Strike Volume",    unit: "hits",   mode: "All sessions",      description: "Total strikes logged per week" },
                };
                const meta = metricMeta[chartMetric];

                // ── Entity colors ───────────────────────────────────────────
                const colorA = "#b400ff";
                const colorB = "#00dcff";

                // ── Merge week keys from both series ────────────────────────
                const allWeeks = Array.from(new Set([
                  ...chartDataA.map(p => p.week),
                  ...chartDataB.map(p => p.week),
                ])).sort();

                const mergedA = allWeeks.map(w => chartDataA.find(p => p.week === w)?.value ?? null);
                const mergedB = allWeeks.map(w => chartDataB.find(p => p.week === w)?.value ?? null);

                const allValues = [...mergedA, ...mergedB].filter((v): v is number => v != null);
                const yMin  = allValues.length > 0 ? Math.floor(Math.min(...allValues) * 0.92) : 0;
                const yMax  = allValues.length > 0 ? Math.ceil( Math.max(...allValues) * 1.06)  : 100;
                const yRange = Math.max(yMax - yMin, 1);

                // SVG dimensions
                const W = 860, H = 220, padL = 44, padR = 16, padT = 12, padB = 28;
                const chartW = W - padL - padR;
                const chartH = H - padT - padB;

                function xPos(i: number): number {
                  return padL + (allWeeks.length <= 1 ? chartW / 2 : (i / (allWeeks.length - 1)) * chartW);
                }
                function yPos(v: number): number {
                  return padT + chartH - ((v - yMin) / yRange) * chartH;
                }

                function buildPath(values: (number | null)[]): string {
                  const segments: string[] = [];
                  let inSeg = false;
                  values.forEach((v, i) => {
                    if (v == null) { inSeg = false; return; }
                    const x = xPos(i).toFixed(1), y = yPos(v).toFixed(1);
                    if (!inSeg) { segments.push(`M${x},${y}`); inSeg = true; }
                    else        { segments.push(`L${x},${y}`); }
                  });
                  return segments.join(" ");
                }

                // Y-axis gridlines
                const yTicks = 4;
                const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
                  Math.round(yMin + (yRange / yTicks) * i)
                );

                // X-axis label (show ~5 evenly spaced week labels)
                const xLabelIndices = allWeeks.length <= 6
                  ? allWeeks.map((_, i) => i)
                  : Array.from({ length: 5 }, (_, i) => Math.round(i * (allWeeks.length - 1) / 4));

                function fmtWeek(w: string): string {
                  const [yr, wk] = w.split("-W");
                  return `W${wk} '${yr.slice(2)}`;
                }

                const hasData = allWeeks.length > 0;
                const isLoading = chartLoadingA || chartLoadingB;

                // ── Hover tooltip values ─────────────────────────────────────
                const hoverA = chartHoverIdx != null ? mergedA[chartHoverIdx] : null;
                const hoverB = chartHoverIdx != null ? mergedB[chartHoverIdx] : null;
                const hoverWeek = chartHoverIdx != null ? allWeeks[chartHoverIdx] : null;

                return (
                  <div>
                    {/* ── Controls row ── */}
                    <div className="ts-chartControls" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 16 }}>

                      {/* Metric pills */}
                      <div className="ts-chartPillGroup" style={{ display: "inline-flex", background: `rgba(${ink},0.04)`, border: `1px solid rgba(${ink},0.11)`, borderRadius: 10, padding: 3, gap: 2 }}>
                        {(["strength","accuracy","reaction","volume"] as ChartMetric[]).map(m => {
                          const isActive = chartMetric === m;
                          const accentC  = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "volume" ? "rgba(80,220,160,0.95)" : "#b400ff";
                          const accentBg = m === "accuracy" ? "rgba(0,220,255,0.13)" : m === "reaction" ? "rgba(255,200,0,0.13)" : m === "volume" ? "rgba(80,220,160,0.12)" : "rgba(180,0,255,0.16)";
                          const accentBdr= m === "accuracy" ? "rgba(0,220,255,0.38)" : m === "reaction" ? "rgba(255,200,0,0.36)" : m === "volume" ? "rgba(80,220,160,0.30)" : "rgba(180,0,255,0.40)";
                          return (
                            <button key={m} type="button" onClick={() => setChartMetric(m)} style={{
                              padding: "5px 11px", borderRadius: 7, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent",
                              background: isActive ? accentBg : "transparent",
                              color: isActive ? accentC : `rgba(${ink},0.45)`,
                              font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                              textTransform: "capitalize", transition: "all 140ms ease", whiteSpace: "nowrap",
                            }}>
                              {metricMeta[m].label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Compare mode pills */}
                      <div className="ts-chartPillGroup" style={{ display: "inline-flex", background: `rgba(${ink},0.04)`, border: `1px solid rgba(${ink},0.11)`, borderRadius: 10, padding: 3, gap: 2 }}>
                        {([
                          { v: "athlete-athlete", shortLabel: "Ath vs Ath" },
                          { v: "athlete-team",shortLabel: "Ath vs Team" },
                          { v: "team-team", shortLabel: "Team vs Team" },
                        ] as { v: CompareMode; label: string; shortLabel: string }[]).map(({ v, label, shortLabel }) => {
                          const isActive = compareMode === v;
                          return (
                            <button key={v} type="button" onClick={() => setCompareMode(v)} style={{
                              padding: "5px 11px", borderRadius: 7,
                              border: isActive ? `1px solid rgba(${ink},0.28)` : "1px solid transparent",
                              background: isActive ? `rgba(${ink},0.09)` : "transparent",
                              color: isActive ? `rgba(${ink},0.90)` : `rgba(${ink},0.45)`,
                              font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                              transition: "all 140ms ease", whiteSpace: "nowrap",
                            }}>
                              <span className="ts-chartLabelFull">{label}</span>
                              <span className="ts-chartLabelShort">{shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Entity selectors ── */}
                    <div className="ts-chartEntityRow" style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
                      {(["A","B"] as const).map(slot => {
                        const entity   = slot === "A" ? chartEntityA : chartEntityB;
                        const setEntity= slot === "A" ? setChartEntityA : setChartEntityB;
                        const color    = slot === "A" ? colorA : colorB;
                        const opts     = chartEntityOptionsFor(slot);
                        const isAthleteSlot = compareMode === "athlete-athlete" || (compareMode === "athlete-team" && slot === "A");
                        const slotLabel = compareMode === "athlete-team" ? (slot === "A" ? "Athlete" : "Team") : compareMode === "team-team" ? "Team" : "Athlete";
                        return (
                          <div key={slot} className="ts-chartEntityItem" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {/* Color swatch */}
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}88` }} />
                            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                                style={{ position: "absolute", left: 9, pointerEvents: "none", opacity: 0.45, flexShrink: 0 }}>
                                {isAthleteSlot
                                  ? <><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M2 12c0-2.761 2.239-4 5-4s5 1.239 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>
                                  : <><rect x="2" y="5" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>
                                }
                              </svg>
                              <select
                                className="ts-chartEntitySelect"
                                value={entity?.id ?? ""}
                                onChange={e => {
                                  const id  = e.target.value;
                                  const opt = opts.find(o => o.id === id) ?? null;
                                  setEntity(opt);
                                }}
                                style={{
                                  background: entity ? `${color}18` : `rgba(${ink},0.05)`,
                                  border: entity ? `1px solid ${color}55` : `1px solid rgba(${ink},0.13)`,
                                  borderRadius: 10, color: entity ? color : "inherit",
                                  font: "inherit", fontSize: 12, fontWeight: 700,
                                  padding: "7px 12px 7px 27px",
                                  cursor: "pointer", outline: "none", appearance: "none",
                                  minWidth: 160, transition: "all 150ms ease",
                                }}
                              >
                                <option value="">{slotLabel} {slot}…</option>
                                {isAthleteSlot ? (
                                  opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)
                                ) : (
                                  <>
                                    {opts.filter((o: any) => o.teamType === "core").length > 0 && (
                                      <optgroup label="── Full Roster">
                                        {opts.filter((o: any) => o.teamType === "core").map(o => (
                                          <option key={o.id} value={o.id}>{o.label}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                    {opts.filter((o: any) => o.teamType !== "core").length > 0 && (
                                      <optgroup label="── Sub-Teams">
                                        {opts.filter((o: any) => o.teamType !== "core").map(o => (
                                          <option key={o.id} value={o.id}>{o.label}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                  </>
                                )}
                              </select>
                            </div>
                          </div>
                        );
                      })}

                      {/* Description */}
                      <span className="ts-chartDesc" style={{ fontSize: 11, opacity: 0.38, marginLeft: 4 }}>{meta.description} · {meta.mode}</span>
                    </div>

                    {/* ── Chart area ── */}
                    <div style={{
                      borderRadius: 12, border: divider,
                      background: `rgba(${ink},${isDark ? "0.025" : "0.018"})`,
                      padding: "16px 16px 10px",
                      position: "relative", overflow: "hidden",
                    }}>
                      {/* Legend */}
                      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                        {[
                          { entity: chartEntityA, color: colorA, loading: chartLoadingA },
                          { entity: chartEntityB, color: colorB, loading: chartLoadingB },
                        ].map(({ entity, color, loading }, i) => entity && (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <svg width="20" height="3" viewBox="0 0 20 3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={color} strokeWidth="2" strokeDasharray={i === 1 ? "4 2" : "none"}/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color, opacity: loading ? 0.5 : 1 }}>
                              {entity.label}{loading ? " (loading…)" : ""}
                            </span>
                          </div>
                        ))}
                        {/* Hover tooltip */}
                        {chartHoverIdx != null && hoverWeek && (
                          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", fontSize: 11, fontWeight: 700 }}>
                            <span style={{ opacity: 0.4 }}>{fmtWeek(hoverWeek)}</span>
                            {hoverA != null && <span style={{ color: colorA }}>{hoverA} <span style={{ opacity: 0.5, fontWeight: 600 }}>{meta.unit}</span></span>}
                            {hoverB != null && <span style={{ color: colorB }}>{hoverB} <span style={{ opacity: 0.5, fontWeight: 600 }}>{meta.unit}</span></span>}
                          </div>
                        )}
                      </div>

                      {/* SVG chart */}
                      {isLoading ? (
                        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
                          {/* Y-axis skeleton labels */}
                          {Array.from({ length: 5 }).map((_, i) => {
                            const y = padT + (chartH / 4) * i;
                            return (
                              <g key={i}>
                                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(128,128,128,0.08)" strokeWidth="1"/>
                                <rect x={0} y={y - 5} width={32} height={10} rx={3} className="ts-skel" />
                              </g>
                            );
                          })}
                          {/* X-axis skeleton labels */}
                          {Array.from({ length: 5 }).map((_, i) => {
                            const x = padL + (chartW / 4) * i;
                            return <rect key={i} x={x - 14} y={H - padB + 6} width={28} height={9} rx={3} className="ts-skel" />;
                          })}
                          {/* Skeleton line A */}
                          <rect x={padL} y={padT + chartH * 0.3} width={chartW} height={3} rx={2} className="ts-skel" style={{ opacity: 0.7 }} />
                          {/* Skeleton line B (dashed look — two segments) */}
                          <rect x={padL} y={padT + chartH * 0.55} width={chartW * 0.45} height={3} rx={2} className="ts-skel" style={{ opacity: 0.45 }} />
                          <rect x={padL + chartW * 0.55} y={padT + chartH * 0.55} width={chartW * 0.45} height={3} rx={2} className="ts-skel" style={{ opacity: 0.45 }} />
                        </svg>
                      ) : !chartEntityA && !chartEntityB ? (
                        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.28, fontSize: 13 }}>Select entities above to render the chart.</div>
                      ) : !hasData ? (
                        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.28, fontSize: 13 }}>No {meta.mode.toLowerCase()} found for the selected entities.</div>
                      ) : (
                        <svg
                          width="100%" viewBox={`0 0 ${W} ${H}`}
                          style={{ overflow: "visible", display: "block", cursor: "crosshair" }}
                          onMouseLeave={() => setChartHoverIdx(null)}
                          onMouseMove={e => {
                            if (!allWeeks.length) return;
                            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                            const mouseX = (e.clientX - rect.left) / rect.width * W;
                            const closestIdx = allWeeks.reduce((best, _, i) => {
                              const dx = Math.abs(xPos(i) - mouseX);
                              return dx < Math.abs(xPos(best) - mouseX) ? i : best;
                            }, 0);
                            setChartHoverIdx(closestIdx);
                          }}
                        >
                          {/* Y-axis gridlines + labels */}
                          {yTickVals.map(v => (
                            <g key={v}>
                              <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke={`rgba(${ink},${isDark ? "0.08" : "0.07"})`} strokeWidth="1"/>
                              <text x={padL - 6} y={yPos(v) + 4} textAnchor="end" fontSize="9" fill={`rgba(${ink},0.35)`}>{v}</text>
                            </g>
                          ))}

                          {/* X-axis labels */}
                          {xLabelIndices.map(i => (
                            <text key={i} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize="9" fill={`rgba(${ink},0.35)`}>
                              {fmtWeek(allWeeks[i])}
                            </text>
                          ))}

                          {/* Entity B line (dashed, behind A) */}
                          {chartEntityB && mergedB.some(v => v != null) && (
                            <>
                              <path d={buildPath(mergedB)} fill="none" stroke={colorB} strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
                              {mergedB.map((v, i) => v != null && (
                                <circle key={i} cx={xPos(i)} cy={yPos(v)} r={chartHoverIdx === i ? 5 : 3} fill={colorB} opacity={chartHoverIdx === i ? 1 : 0.7}/>
                              ))}
                            </>
                          )}

                          {/* Entity A line (solid, on top) */}
                          {chartEntityA && mergedA.some(v => v != null) && (
                            <>
                              <path d={buildPath(mergedA)} fill="none" stroke={colorA} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.90"/>
                              {mergedA.map((v, i) => v != null && (
                                <circle key={i} cx={xPos(i)} cy={yPos(v)} r={chartHoverIdx === i ? 5 : 3} fill={colorA} opacity={chartHoverIdx === i ? 1 : 0.7}/>
                              ))}
                            </>
                          )}

                          {/* Hover vertical line */}
                          {chartHoverIdx != null && (
                            <line
                              x1={xPos(chartHoverIdx)} y1={padT}
                              x2={xPos(chartHoverIdx)} y2={padT + chartH}
                              stroke={`rgba(${ink},0.22)`} strokeWidth="1" strokeDasharray="3 2"
                            />
                          )}
                        </svg>
                      )}
                    </div>

                    {/* ── Summary stats below chart ── */}
                    {(chartDataA.length > 0 || chartDataB.length > 0) && (() => {
                      function seriesSummary(data: WeekPoint[], color: string, entity: ChartEntity | null) {
                        if (!entity || data.length === 0) return null;
                        const vals = data.map(p => p.value).filter((v): v is number => v != null);
                        if (!vals.length) return null;
                        const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
                        const peak = Math.max(...vals);
                        const low  = Math.min(...vals);
                        const trend = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
                        return { entity, color, avg, peak, low, trend, count: data.length };
                      }
                      const summaries = [
                        seriesSummary(chartDataA, colorA, chartEntityA),
                        seriesSummary(chartDataB, colorB, chartEntityB),
                      ].filter(Boolean) as NonNullable<ReturnType<typeof seriesSummary>>[];

                      if (!summaries.length) return null;
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${summaries.length}, 1fr)`, gap: 10, marginTop: 14 }}>
                          {summaries.map(s => (
                            <div key={s.entity.id} style={{
                              borderRadius: 10, border: `1px solid ${s.color}28`,
                              background: `${s.color}09`, padding: "12px 14px",
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: s.color, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                                {s.entity.label}
                                <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 600, marginLeft: 2 }}>({s.count} weeks)</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                                {[
                                  { label: "Avg",   value: `${s.avg} ${meta.unit}` },
                                  { label: "Peak",  value: `${s.peak} ${meta.unit}` },
                                  { label: "Low",   value: `${s.low} ${meta.unit}` },
                                  { label: "Trend", value: s.trend != null ? `${s.trend > 0 ? "+" : ""}${s.trend} ${meta.unit}` : "—",
                                    color: s.trend == null ? undefined : (chartMetric === "reaction" ? (s.trend < 0 ? "rgba(80,220,160,0.95)" : "rgba(255,100,80,0.90)") : (s.trend > 0 ? "rgba(80,220,160,0.95)" : "rgba(255,100,80,0.90)")) },
                                ].map(stat => (
                                  <div key={stat.label}>
                                    <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.4, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
                                    <div style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: (stat as any).color ?? `rgba(${ink},0.88)` }}>{stat.value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      ) : activeTab === "insights" ? (() => {
        const isLoadingAny = strengthLoading || reactionLoading || accuracyLoading;
        const hasAnyData   = strengthRows.length > 0 || reactionRows.length > 0 || accuracyRows.length > 0;
        const ink          = isDark ? "255,255,255" : "20,20,40";

        // ── Full onboarding state — shown while loading finishes or when truly no data ──
        if (!isLoadingAny && !hasAnyData) return (
          <div className="ts-dashGrid ts-dashMain">
            <div style={{ gridColumn: "1 / -1" }}>

              {/* Hero prompt */}
              <div style={{
                borderRadius: 16,
                border: isDark ? "1px solid rgba(180,0,255,0.22)" : "1px solid rgba(180,0,255,0.18)",
                background: isDark ? "rgba(180,0,255,0.07)" : "rgba(180,0,255,0.04)",
                padding: "36px 40px",
                marginBottom: 20,
                display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap",
              }}>
                {/* Icon */}
                <div style={{
                  width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                  background: isDark ? "rgba(180,0,255,0.18)" : "rgba(180,0,255,0.12)",
                  border: "1px solid rgba(180,0,255,0.30)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
                }}>📊</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: isDark ? "rgba(210,140,255,0.95)" : "rgba(120,0,200,0.90)" }}>
                    Your leaderboards will appear here
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, opacity: 0.72, maxWidth: 560 }}>
                    Start recording sessions to unlock rankings, improvement trends, and team comparisons.
                    Each section has a minimum session threshold — here's what to aim for first.
                  </div>
                </div>
              </div>

              {/* Unlock cards grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  {
                    icon: "💥", label: "Athlete Leaderboard", accentColor: "#b400ff",
                    accentBg: isDark ? "rgba(180,0,255,0.10)" : "rgba(180,0,255,0.06)",
                    accentBdr: isDark ? "rgba(180,0,255,0.28)" : "rgba(180,0,255,0.20)",
                    steps: [
                      "Record Power sessions for your athletes",
                      "3+ sessions per athlete generates a Strength Index",
                      "Rankings update automatically after each session",
                    ],
                  },
                  {
                    icon: "🎯", label: "Accuracy Leaderboard", accentColor: "#00dcff",
                    accentBg: isDark ? "rgba(0,220,255,0.08)" : "rgba(0,220,255,0.05)",
                    accentBdr: isDark ? "rgba(0,220,255,0.25)" : "rgba(0,220,255,0.18)",
                    steps: [
                      "Record Accuracy sessions for your athletes",
                      "Each session logs accuracy % and avg offset",
                      "Scores aggregate across all accuracy sessions",
                    ],
                  },
                  {
                    icon: "⚡️", label: "Reaction Leaderboard", accentColor: "#ffcc00",
                    accentBg: isDark ? "rgba(255,200,0,0.08)" : "rgba(255,200,0,0.05)",
                    accentBdr: isDark ? "rgba(255,200,0,0.25)" : "rgba(255,200,0,0.18)",
                    steps: [
                      "Record Reaction sessions for your athletes",
                      "Avg and best reaction times are tracked per session",
                      "Top 5 athletes ranked by fastest avg response",
                    ],
                  },
                  {
                    icon: "📈", label: "Most Improved", accentColor: isDark ? "rgba(80,220,160,0.95)" : "rgba(15,130,80,0.90)",
                    accentBg: isDark ? "rgba(80,220,160,0.08)" : "rgba(15,130,80,0.05)",
                    accentBdr: isDark ? "rgba(80,220,160,0.24)" : "rgba(15,130,80,0.18)",
                    steps: [
                      "Requires 4+ sessions per athlete in any one mode",
                      "Compares first half vs last half of session history",
                      "Automatically updates as more sessions are recorded",
                    ],
                  },
                ].map(({ icon, label, accentColor, accentBg, accentBdr, steps }) => (
                  <div key={label} style={{
                    borderRadius: 12,
                    border: `1px solid ${accentBdr}`,
                    background: accentBg,
                    padding: "16px 18px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 18 }}>{icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: accentColor }}>{label}</span>
                    </div>
                    <ol style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      {steps.map((step, si) => (
                        <li key={si} style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.72 }}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              {/* Quick-start CTA */}
              <div style={{
                borderRadius: 12,
                border: `1px solid rgba(${ink},${isDark ? "0.08" : "0.09"})`,
                background: `rgba(${ink},${isDark ? "0.03" : "0.025"})`,
                padding: "14px 20px",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🚀</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Ready to get started?</div>
                    <div style={{ fontSize: 12, opacity: 0.55 }}>Head to the Recent Sessions tab and record your first Power session.</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="ts-btn ts-btnSecondary"
                  onClick={() => setActiveTab("recent")}
                  style={{ fontSize: 12, padding: "8px 16px", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Go to Recent Sessions →
                </button>
              </div>

            </div>
          </div>
        );

        // ── Normal populated state ──
        return (
        <div className="ts-dashGrid ts-dashMain">

          {/* ── DATE RANGE FILTER — controls all leaderboards + most improved ── */}
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.45 }}>Date Range</span>
              <span style={{ fontSize: 11, opacity: 0.32 }}>Applies to all leaderboards &amp; Most Improved</span>
            </div>
            <div style={{
              display: "inline-flex",
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`,
              borderRadius: 10, padding: 3, gap: 2,
            }}>
              {([7, 30, 90, "all"] as LeaderDateRange[]).map(r => {
                const isActive = leaderDateRange === r;
                const ink = isDark ? "255,255,255" : "20,20,40";
                return (
                  <button
                    key={String(r)}
                    type="button"
                    onClick={() => setLeaderDateRange(r)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 7,
                      border: isActive
                        ? isDark ? "1px solid rgba(180,0,255,0.55)" : `1px solid rgba(${ink},0.28)`
                        : "1px solid transparent",
                      background: isActive
                        ? isDark ? "rgba(180,0,255,0.18)" : `rgba(${ink},0.09)`
                        : "transparent",
                      color: isActive
                        ? isDark ? "rgba(210,140,255,0.96)" : `rgba(${ink},0.92)`
                        : `rgba(${ink},0.45)`,
                      font: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 140ms ease",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r === "all" ? "All time" : `${r}d`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── ATHLETE SECTION HEADER ── */}
          <div className="ts-span2" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45 }}>Athletes</div>
            <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.10)" }} />
          </div>

          {/* Athlete Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Athlete Leaderboard</div>
              <div className="ts-cardMeta">
                {leaderMetric === "strength"
                  ? strengthLoading ? "Loading…" : `${strengthRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}`
                  : leaderMetric === "reaction"
                  ? reactionLoading ? "Loading…" : reactionRows.length > 0 ? `${reactionRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : leaderMetric === "volume"
                  ? volumeInsightRows.length > 0 ? `${volumeInsightRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : leaderMetric === "target"
                  ? targetInsightRows.length > 0 ? `${targetInsightRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"
                  : accuracyLoading ? "Loading…" : accuracyRows.length > 0 ? `${accuracyRows.length} athletes · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"}
              </div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                {leaderMetric === "strength"
                  ? "Top athletes by Strength Index (0–1000), derived from peak & avg force across all power sessions."
                  : leaderMetric === "reaction"
                  ? "Top athletes by avg reaction time — lower is better. Best = fastest single response."
                  : leaderMetric === "volume"
                  ? "Top athletes by total hits across volume sessions, with avg Strength Index showing output quality."
                  : leaderMetric === "target"
                  ? "Top athletes by zone accuracy %. Avg RT is correct-zone reaction time only — lower is better."
                  : "Top athletes by Accuracy Score (0–100%) across all accuracy sessions."}
              </div>
              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="leaderMetric">Mode</label>
                <select id="leaderMetric" className="ts-select" value={leaderMetric} onChange={(e) => setLeaderMetric(e.target.value as MetricKey)}>
                  <option value="strength">💥 Power</option>
                  <option value="reaction">⚡️ Reaction</option>
                  <option value="accuracy">🎯 Accuracy</option>
                  <option value="volume">🥊 Volume</option>
                  <option value="target">🏹 Target</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Athlete Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">#</div>
                <div className="ts-leaderCell name" role="columnheader">Athlete</div>
                {leaderMetric === "strength" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Peak Index</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Index</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : leaderMetric === "reaction" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Reaction</div>
                  <div className="ts-leaderCell" role="columnheader">Best</div>
                  <div className="ts-leaderCell" role="columnheader">Attempts</div>
                </>) : leaderMetric === "volume" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Events / Win</div>
                  <div className="ts-leaderCell" role="columnheader">Avg SI</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : leaderMetric === "target" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy</div>
                  <div className="ts-leaderCell" role="columnheader">Avg RT (correct)</div>
                  <div className="ts-leaderCell" role="columnheader">Attempts</div>
                </>) : (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy %</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Offset</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>)}
              </div>

              {leaderMetric === "strength" ? (
                strengthLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={40} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : strengthRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>💥</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No strength data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Power sessions for your athletes. 3+ sessions per athlete generates a Strength Index ranking.</div>
                </div>)
                : strengthRows.map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Power profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.peakIndex}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.avgIndex}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              ) : leaderMetric === "reaction" ? (
                reactionLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={44} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={28} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : reactionRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>⚡️</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No reaction data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Reaction sessions to start tracking response times. Rankings show avg and best reaction ms per athlete.</div>
                </div>)
                : reactionRows.map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Reaction profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMs}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms avg</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.bestReactionMs}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms best</span></div>
                    <div className="ts-leaderCell" role="cell">{row.attempts}</div>
                  </div>
                ))
              ) : leaderMetric === "volume" ? (
                volumeInsightRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>🥊</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No volume data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Volume sessions to track hit counts and output quality per athlete.</div>
                </div>)
                : volumeInsightRows.slice(0, 5).map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Volume profile · {row.sessions} session{row.sessions !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgWindowHits}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>events/win</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      {row.avgSi != null
                        ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgSi}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></>
                        : <span style={{ opacity: 0.35 }}>—</span>}
                    </div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              ) : leaderMetric === "target" ? (
                targetInsightRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>🏹</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No target data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Target sessions to rank athletes by zone accuracy and correct-zone reaction time.</div>
                </div>)
                : targetInsightRows.slice(0, 5).map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Target profile · {row.attempts} attempt{row.attempts !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(0,220,110,0.95)" }}>{row.avgAccuracyPct}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      {row.avgReactionMsCorrect != null
                        ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMsCorrect}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></>
                        : <span style={{ opacity: 0.35 }}>—</span>}
                    </div>
                    <div className="ts-leaderCell" role="cell">{row.attempts}</div>
                  </div>
                ))
              ) : (
                accuracyLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <Skel w={`${30 + (i % 3) * 10}%`} h={13} />
                      <div style={{ marginLeft: "auto", display: "flex", gap: 24 }}>
                        <Skel w={36} h={13} />
                        <Skel w={40} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>)
                : accuracyRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>🎯</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No accuracy data yet</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 300, lineHeight: 1.6 }}>Record Accuracy sessions to track placement scores and avg offset. Each session logs accuracy % automatically.</div>
                </div>)
                : accuracyRows.map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Accuracy profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{row.accuracyPct}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                    <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.avgOffsetCm > 0 ? row.avgOffsetCm : "—"}</span>{row.avgOffsetCm > 0 && <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>offset</span>}</div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Athlete Most Improved */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">{athleteImprovedLoading ? "Loading…" : athleteImprovedRows.length > 0 ? `${athleteImprovedRows.length} athletes` : "needs more data"}</div>
            </div>

            {/* Metric selector */}
            <div style={{ display: "inline-flex", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)", border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`, borderRadius: 9, padding: 3, gap: 2, marginBottom: 14 }}>
              {(["strength","reaction","accuracy","form"] as MetricKey[]).map(m => {
                const isActive = athleteImprovedMetric === m;
                const accent   = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "form" ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                const accentBg = m === "accuracy" ? "rgba(0,220,255,0.12)" : m === "reaction" ? "rgba(255,200,0,0.12)" : m === "form" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.07)") : "rgba(180,0,255,0.16)";
                const accentBdr= m === "accuracy" ? "rgba(0,220,255,0.35)" : m === "reaction" ? "rgba(255,200,0,0.35)" : m === "form" ? (isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.22)") : "rgba(180,0,255,0.40)";
                return (
                  <button key={m} type="button" onClick={() => setAthleteImprovedMetric(m)} style={{ padding: "4px 10px", borderRadius: 6, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent", background: isActive ? accentBg : "transparent", color: isActive ? accent : isDark ? "rgba(255,255,255,0.45)" : "rgba(20,20,40,0.45)", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", transition: "all 130ms ease" }}>
                    {m === "strength" ? "💥" : m === "reaction" ? "⚡️" : m === "accuracy" ? "🎯" : "📐"} {m === "form" ? "Form" : m}
                  </button>
                );
              })}
            </div>

            {athleteImprovedLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={20} h={12} r={4} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                      <Skel w={`${40 + (i % 3) * 15}%`} h={12} />
                      <Skel w="55%" h={9} />
                    </div>
                    <Skel w={72} h={24} r={999} />
                  </div>
                ))}
              </div>
            ) : athleteImprovedRows.length === 0 ? (
              <div className="ts-mostImproved">
                <div className="ts-mostRow">
                  <div className="ts-miLabel">
                    <div className="ts-miTitle" style={{ fontSize: 13 }}>
                      {athleteImprovedMetric === "form" ? "📐 Form & Angle" : athleteImprovedMetric === "strength" ? "💥 Strength" : athleteImprovedMetric === "reaction" ? "⚡️ Reaction" : "🎯 Accuracy"}
                    </div>
                    <div className="ts-miSubtitle">needs 4+ sessions per athlete to compute trend</div>
                  </div>
                  <div className="ts-miBody"><div className="ts-miName" style={{ opacity: 0.3 }}>—</div></div>
                </div>
              </div>
            ) : (
              <div className="ts-mostImproved">
                {athleteImprovedRows.map((row, idx) => {
                  const isForm     = athleteImprovedMetric === "form";
                  const isPositive = row.delta > 0;
                  const accent = athleteImprovedMetric === "accuracy" ? "#00dcff" : athleteImprovedMetric === "reaction" ? "#ffcc00" : isForm ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                  const unit   = athleteImprovedMetric === "reaction" ? "ms" : athleteImprovedMetric === "accuracy" ? "%" : isForm ? "°" : "pts";
                  const fromVal = isForm ? `${row.from}°` : `${row.from}${unit}`;
                  const toVal   = isForm ? `${row.to}°`   : `${row.to}${unit}`;
                  const dirLabel= isForm ? (isPositive ? "↗ more neutral" : "↘ more biased") : (isPositive ? "▲" : "▼");
                  return (
                    <div key={row.athleteId} className="ts-mostRow">
                      <div className="ts-leaderCell rank" style={{ fontSize: 13, fontWeight: 800, opacity: 0.4, minWidth: 24 }}>{idx + 1}</div>
                      <div className="ts-miLabel" style={{ minWidth: 0, flex: 1 }}>
                        <div className="ts-miTitle" style={{ fontSize: 13 }}>{row.name}</div>
                        <div className="ts-miSubtitle">{fromVal} → {toVal}{isForm ? " avg bias" : ""} · {row.sessions} sessions</div>
                      </div>
                      <div className="ts-miPills">
                        <div className="ts-improvePill" style={{ color: isPositive ? accent : "rgba(255,100,80,0.90)", borderColor: isPositive ? `${accent}40` : "rgba(255,100,80,0.30)", background: isPositive ? `${accent}10` : "rgba(255,100,80,0.08)", fontSize: 12 }}>
                          {dirLabel} {isForm ? `${Math.abs(row.delta)}°` : `${Math.abs(row.delta)} ${unit}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── TEAM SECTION DIVIDER ── */}
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, paddingTop: 8, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45 }}>Teams</div>
            <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.10)" }} />
          </div>

          {/* Team Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Team Leaderboard</div>
              <div className="ts-cardMeta">{teamLeaderLoading ? "Loading…" : teamLeaderRows.length > 0 ? `${teamLeaderRows.length} teams · ${leaderDateRange === "all" ? "all time" : `last ${leaderDateRange}d`}` : "no data yet"}</div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                {teamLeaderMetric === "strength"
                  ? "Teams ranked by avg peak strength index across all power sessions. Core = full roster, Sub = smaller groups."
                  : teamLeaderMetric === "reaction"
                  ? "Teams ranked by avg reaction time across all reaction sessions — lower is better."
                  : teamLeaderMetric === "volume"
                  ? "Teams ranked by total hits across volume sessions. Avg SI shows collective output quality."
                  : teamLeaderMetric === "target"
                  ? "Teams ranked by zone accuracy % across target sessions. Avg RT is correct-zone reaction only."
                  : "Teams ranked by avg accuracy score across all accuracy sessions."}
              </div>
              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="teamLeaderMetric">Mode</label>
                <select id="teamLeaderMetric" className="ts-select" value={teamLeaderMetric} onChange={(e) => setTeamLeaderMetric(e.target.value as MetricKey)}>
                  <option value="strength">💥 Power</option>
                  <option value="reaction">⚡️ Reaction</option>
                  <option value="accuracy">🎯 Accuracy</option>
                  <option value="volume">🥊 Volume</option>
                  <option value="target">🏹 Target</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Team Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">#</div>
                <div className="ts-leaderCell name" role="columnheader">Team</div>
                {teamLeaderMetric === "strength" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Peak Index</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Index</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "reaction" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Reaction</div>
                  <div className="ts-leaderCell" role="columnheader">Best</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "volume" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Avg Events / Win</div>
                  <div className="ts-leaderCell" role="columnheader">Avg SI</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : teamLeaderMetric === "target" ? (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy</div>
                  <div className="ts-leaderCell" role="columnheader">Avg RT (correct)</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>) : (<>
                  <div className="ts-leaderCell" role="columnheader">Accuracy %</div>
                  <div className="ts-leaderCell" role="columnheader">Avg Offset</div>
                  <div className="ts-leaderCell" role="columnheader">Sessions</div>
                </>)}
              </div>

              {teamLeaderLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px" }}>
                      <Skel w={20} h={12} r={4} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Skel w={`${28 + (i % 3) * 10}%`} h={13} />
                          <Skel w={36} h={16} r={999} />
                        </div>
                        <Skel w="35%" h={9} />
                      </div>
                      <div style={{ display: "flex", gap: 24 }}>
                        <Skel w={40} h={13} />
                        <Skel w={36} h={13} />
                        <Skel w={24} h={13} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : teamLeaderRows.length === 0 ? (
                <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 22 }}>🏅</span>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65 }}>No team data for this mode</div>
                  <div style={{ fontSize: 12, opacity: 0.42, maxWidth: 320, lineHeight: 1.6 }}>Record sessions in this mode for athletes on your teams. Core teams aggregate all roster sessions; sub-teams pull from their member athletes.</div>
                </div>
              ) : teamLeaderRows.map((row, idx) => {
                const isCore = row.teamType === "core";
                const typePill = (
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 999, marginLeft: 6,
                    background: isCore ? "rgba(180,0,255,0.12)" : isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.06)",
                    border:     isCore ? "1px solid rgba(180,0,255,0.28)" : isDark ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(20,20,40,0.20)",
                    color:      isCore ? "rgba(210,140,255,0.90)" : isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.70)",
                    opacity: 1,
                  }}>
                    {isCore ? "core" : "sub"}
                  </span>
                );
                return (
                  <div key={row.teamId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName" style={{ display: "flex", alignItems: "center" }}>{row.name}{typePill}</div>
                      <div className="ts-leaderSub">{row.memberCount} members · {row.sessionCount} sessions</div>
                    </div>
                    {teamLeaderMetric === "strength" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.peakIndex ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(210,140,255,0.95)" }}>{row.avgIndex ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "reaction" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMs ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.bestReactionMs ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "volume" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.totalHits ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>events/win</span></div>
                      <div className="ts-leaderCell" role="cell">{row.avgSi != null ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,150,60,0.95)" }}>{row.avgSi}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span></> : <span style={{ opacity: 0.35 }}>—</span>}</div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : teamLeaderMetric === "target" ? (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(0,220,110,0.95)" }}>{row.targetAccuracyPct ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                      <div className="ts-leaderCell" role="cell">{row.avgReactionMsCorrect != null ? <><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,210,60,0.95)" }}>{row.avgReactionMsCorrect}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>ms</span></> : <span style={{ opacity: 0.35 }}>—</span>}</div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>) : (<>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(80,220,255,0.95)" }}>{row.accuracyPct ?? "—"}</span><span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>%</span></div>
                      <div className="ts-leaderCell" role="cell"><span style={{ fontVariantNumeric: "tabular-nums" }}>{row.avgOffsetMm != null ? `${row.avgOffsetMm} mm` : "—"}</span></div>
                      <div className="ts-leaderCell" role="cell">{row.sessionCount}</div>
                    </>)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team Most Improved */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">{teamImprovedLoading ? "Loading…" : teamImprovedRows.length > 0 ? `${teamImprovedRows.length} teams` : "needs more data"}</div>
            </div>

            {/* Metric selector */}
            <div style={{ display: "inline-flex", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,20,40,0.04)", border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,40,0.10)"}`, borderRadius: 9, padding: 3, gap: 2, marginBottom: 14 }}>
              {(["strength","reaction","accuracy","form"] as MetricKey[]).map(m => {
                const isActive  = teamImprovedMetric === m;
                const accent    = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : m === "form" ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                const accentBg  = m === "accuracy" ? "rgba(0,220,255,0.12)" : m === "reaction" ? "rgba(255,200,0,0.12)" : m === "form" ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,40,0.07)") : "rgba(180,0,255,0.16)";
                const accentBdr = m === "accuracy" ? "rgba(0,220,255,0.35)" : m === "reaction" ? "rgba(255,200,0,0.35)" : m === "form" ? (isDark ? "rgba(255,255,255,0.22)" : "rgba(20,20,40,0.22)") : "rgba(180,0,255,0.40)";
                return (
                  <button key={m} type="button" onClick={() => setTeamImprovedMetric(m)} style={{ padding: "4px 10px", borderRadius: 6, border: isActive ? `1px solid ${accentBdr}` : "1px solid transparent", background: isActive ? accentBg : "transparent", color: isActive ? accent : isDark ? "rgba(255,255,255,0.45)" : "rgba(20,20,40,0.45)", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", transition: "all 130ms ease" }}>
                    {m === "strength" ? "💥" : m === "reaction" ? "⚡️" : m === "accuracy" ? "🎯" : "📐"} {m === "form" ? "Form" : m}
                  </button>
                );
              })}
            </div>

            {teamImprovedLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={20} h={12} r={4} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Skel w={`${35 + (i % 3) * 12}%`} h={12} />
                        <Skel w={32} h={14} r={999} />
                      </div>
                      <Skel w="50%" h={9} />
                    </div>
                    <Skel w={72} h={24} r={999} />
                  </div>
                ))}
              </div>
            ) : teamImprovedRows.length === 0 ? (
              <div className="ts-mostImproved">
                <div className="ts-mostRow">
                  <div className="ts-miLabel">
                    <div className="ts-miTitle" style={{ fontSize: 13 }}>
                      {teamImprovedMetric === "form" ? "📐 Form & Angle" : teamImprovedMetric === "strength" ? "💥 Strength" : teamImprovedMetric === "reaction" ? "⚡️ Reaction" : "🎯 Accuracy"}
                    </div>
                    <div className="ts-miSubtitle">needs 4+ sessions per team to compute trend</div>
                  </div>
                  <div className="ts-miBody"><div className="ts-miName" style={{ opacity: 0.3 }}>—</div></div>
                </div>
              </div>
            ) : (
              <div className="ts-mostImproved">
                {teamImprovedRows.map((row, idx) => {
                  const isForm     = teamImprovedMetric === "form";
                  const isPositive = row.delta > 0;
                  const isCore     = row.teamType === "core";
                  const accent = teamImprovedMetric === "accuracy" ? "#00dcff" : teamImprovedMetric === "reaction" ? "#ffcc00" : isForm ? (isDark ? "rgba(255,255,255,0.80)" : "rgba(20,20,40,0.80)") : "#b400ff";
                  const unit   = teamImprovedMetric === "reaction" ? "ms" : teamImprovedMetric === "accuracy" ? "%" : isForm ? "°" : "pts";
                  const fromVal = isForm ? `${row.from}°` : `${row.from}${unit}`;
                  const toVal   = isForm ? `${row.to}°`   : `${row.to}${unit}`;
                  const dirLabel= isForm ? (isPositive ? "↗ more neutral" : "↘ more biased") : (isPositive ? "▲" : "▼");
                  return (
                    <div key={row.teamId} className="ts-mostRow">
                      <div className="ts-leaderCell rank" style={{ fontSize: 13, fontWeight: 800, opacity: 0.4, minWidth: 24 }}>{idx + 1}</div>
                      <div className="ts-miLabel" style={{ minWidth: 0, flex: 1 }}>
                        <div className="ts-miTitle" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                          {row.name}
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", padding: "2px 5px", borderRadius: 999,
                            background: isCore ? "rgba(180,0,255,0.12)" : isDark ? "rgba(255,255,255,0.07)" : "rgba(20,20,40,0.06)",
                            border:     isCore ? "1px solid rgba(180,0,255,0.28)" : isDark ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(20,20,40,0.20)",
                            color:      isCore ? "rgba(210,140,255,0.90)" : isDark ? "rgba(255,255,255,0.75)" : "rgba(20,20,40,0.70)",
                            opacity: 1,
                          }}>
                            {isCore ? "roster" : "sub"}
                          </span>
                        </div>
                        <div className="ts-miSubtitle">{fromVal} → {toVal}{isForm ? " avg bias" : ""} · {row.sessions} sessions</div>
                      </div>
                      <div className="ts-miPills">
                        <div className="ts-improvePill" style={{ color: isPositive ? accent : "rgba(255,100,80,0.90)", borderColor: isPositive ? `${accent}40` : "rgba(255,100,80,0.30)", background: isPositive ? `${accent}10` : "rgba(255,100,80,0.08)", fontSize: 12 }}>
                          {dirLabel} {isForm ? `${Math.abs(row.delta)}°` : `${Math.abs(row.delta)} ${unit}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
        ); // end normal populated return
      })() : (
        <div className="ts-dashGrid ts-dashMain">
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Individual Athletes</div>
              <div className="ts-cardMeta">{athletes.length} athlete{athletes.length !== 1 ? "s" : ""}</div>
            </div>

            {athletesLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={40} h={40} r={50} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skel w={`${40 + (i % 3) * 14}%`} h={13} />
                      <Skel w="28%" h={10} />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Skel w={52} h={26} r={999} />
                      <Skel w={52} h={26} r={999} />
                    </div>
                    <Skel w={86} h={28} r={999} />
                  </div>
                ))}
              </div>
            )}

            {!athletesLoading && athletesError && (
              <div className="ts-athleteError">{athletesError}</div>
            )}

            {!athletesLoading && !athletesError && athletes.length === 0 && (
              <div className="ts-athleteEmpty">No athletes in this program yet. Use "Add Athlete" to get started.</div>
            )}

            {!athletesLoading && !athletesError && athletes.length > 0 && (
              <>
                {/* Filter bar */}
                <div className="ts-athleteFilterBar">
                  <svg className="ts-athleteFilterIcon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <input
                    className="ts-athleteFilterInput"
                    type="text"
                    placeholder="Filter by name, sport, or position…"
                    value={athleteFilter}
                    onChange={(e) => setAthleteFilter(e.target.value)}
                    aria-label="Filter athletes"
                  />
                  {athleteFilter && (
                    <button
                      type="button"
                      className="ts-athleteFilterClear"
                      onClick={() => setAthleteFilter("")}
                      aria-label="Clear filter"
                    >✕</button>
                  )}
                </div>

                {(() => {
                  const q = athleteFilter.trim().toLowerCase();
                  const filtered = q
                    ? athletes.filter((a) =>
                        `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
                        (a.sport ?? "").toLowerCase().includes(q) ||
                        (a.position ?? "").toLowerCase().includes(q)
                      )
                    : athletes;

                  if (filtered.length === 0) {
                    return <div className="ts-athleteEmpty">No athletes match "{athleteFilter}".</div>;
                  }

                  return (
                    <div className="ts-athleteList">
                      {filtered
                        // Sort: improving first, then stable, then declining, then no data
                        .slice()
                        .sort((a, b) => {
                          const order = { up: 0, stable: 1, down: 2 };
                          const pa = athleteProgressMap.get(a.id);
                          const pb = athleteProgressMap.get(b.id);
                          if (!pa && !pb) return 0;
                          if (!pa) return 1;
                          if (!pb) return -1;
                          return order[pa.trend] - order[pb.trend];
                        })
                        .map((a) => {
                        const fullName = `${a.first_name} ${a.last_name}`;
                        const initials = [a.first_name, a.last_name]
                          .filter(Boolean)
                          .map((w) => w[0]?.toUpperCase())
                          .join("");
                        const progress = athleteProgressMap.get(a.id) ?? null;
                        const ink = isDark ? "255,255,255" : "20,20,40";

                        // Badge colours
                        const trendColor = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.95)"  : "rgba(15,130,80,0.95)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.90)"  : "rgba(180,50,30,0.90)")
                          : `rgba(${ink},0.50)`;
                        const trendBg = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.10)"  : "rgba(15,130,80,0.08)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.10)"  : "rgba(180,50,30,0.08)")
                          : `rgba(${ink},0.04)`;
                        const trendBdr = progress?.trend === "up"
                          ? (isDark ? "rgba(80,220,160,0.28)"  : "rgba(15,130,80,0.22)")
                          : progress?.trend === "down"
                          ? (isDark ? "rgba(255,100,80,0.28)"  : "rgba(180,50,30,0.22)")
                          : `rgba(${ink},0.12)`;

                        const trendIcon  = progress?.trend === "up" ? "↑" : progress?.trend === "down" ? "↓" : "→";
                        const trendLabel = progress?.trend === "up" ? "Improving" : progress?.trend === "down" ? "Declining" : "Stable";

                        const metricIcon = progress?.metric === "accuracy"       ? "🎯"
                          : progress?.metric === "reaction"       ? "⚡️"
                          : progress?.metric === "targetAccuracy" ? "🏹"
                          : progress?.metric === "targetReaction" ? "🏹"
                          : "💥";

                        const metricLabel = progress?.metric === "targetAccuracy" ? "target acc"
                          : progress?.metric === "targetReaction" ? "target RT"
                          : progress?.metric;

                        return (
                          <div
                            key={a.id}
                            className="ts-athleteRow"
                            onClick={() => setEditAthleteTarget(a)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && setEditAthleteTarget(a)}
                          >
                            <div className="ts-athleteAvatar" aria-hidden="true">{initials}</div>
                            <div className="ts-athleteInfo">
                              <div className="ts-athleteName">{fullName}</div>
                              {(a.sport || a.position) && (
                                <div className="ts-athleteMeta">
                                  {[a.sport, a.position].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                            <div className="ts-athletePills">
                              {a.height && (
                                <span className="ts-athletePill">
                                  <span className="ts-pillLabel">HT</span>{a.height}
                                </span>
                              )}
                              {a.weight && (
                                <span className="ts-athletePill">
                                  <span className="ts-pillLabel">WT</span>{a.weight}
                                </span>
                              )}
                            </div>

                            {/* Progress badge */}
                            <div className="ts-athleteTrendBadge">
                              {progress ? (
                                <div style={{
                                  display: "flex", flexDirection: "column", alignItems: "flex-end",
                                  gap: 3, flexShrink: 0, marginLeft: 4,
                                }}>
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    padding: "4px 9px", borderRadius: 999,
                                    background: trendBg, border: `1px solid ${trendBdr}`,
                                    color: trendColor,
                                    fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    <span style={{ fontSize: 13, lineHeight: 1 }}>{trendIcon}</span>
                                    {trendLabel}
                                  </div>
                                  <div style={{
                                    fontSize: 10, opacity: 0.42, whiteSpace: "nowrap",
                                    textAlign: "right", paddingRight: 2,
                                  }}>
                                    {metricIcon} {metricLabel} · {progress.delta > 0 ? "+" : ""}{progress.delta} {progress.unit} · {progress.sessions} sess.
                                  </div>
                                </div>
                              ) : athleteProgressLoading ? (
                                <div style={{ width: 80, height: 28, borderRadius: 999, background: `rgba(${ink},0.05)`, flexShrink: 0 }} />
                              ) : (
                                <div style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  padding: "4px 9px", borderRadius: 999,
                                  background: `rgba(${ink},0.04)`,
                                  border: `1px solid rgba(${ink},0.10)`,
                                  color: `rgba(${ink},0.30)`,
                                  fontSize: 11, fontWeight: 700,
                                  whiteSpace: "nowrap", flexShrink: 0,
                                }}>
                                  — no data
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Teams card */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Program Teams</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="ts-cardMeta">
                  {profile?.role === "admin" ? "all teams" : "your sub-teams"}
                </div>
                <button
                  type="button"
                  className="ts-btn ts-btnSecondary ts-addTeamBtn"
                  onClick={() => setShowCreateTeam(true)}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 5, flexShrink: 0 }}>
                    <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Add Team
                </button>
              </div>
            </div>

            {teamsLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(128,128,128,0.08)" }}>
                    <Skel w={34} h={34} r={10} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skel w={`${35 + (i % 3) * 12}%`} h={13} />
                      <Skel w="22%" h={10} />
                    </div>
                    <Skel w={46} h={22} r={999} />
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <Skel w={24} h={16} />
                      <Skel w={38} h={9} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!teamsLoading && teamsError && (
              <div className="ts-athleteError">{teamsError}</div>
            )}

            {!teamsLoading && !teamsError && teams.length === 0 && (
              <div className="ts-athleteEmpty">
                {profile?.role === "coach"
                  ? "No sub-teams found for your program."
                  : "No teams found for this program."}
              </div>
            )}

            {!teamsLoading && !teamsError && teams.length > 0 && (
              <div className="ts-teamList">
                {teams.map((t) => {
                  const isCore = t.team_type === "core";
                  return (
                    <div key={t.id} className="ts-teamRow" onClick={() => setSelectedTeam(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelectedTeam(t)}>
                      <div className={`ts-teamIcon ${isCore ? "ts-teamIcon--core" : "ts-teamIcon--sub"}`} aria-hidden="true">
                        {isCore ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L7 1Z" fill="currentColor"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                          </svg>
                        )}
                      </div>
                      <div className="ts-teamInfo">
                        <div className="ts-teamName">{t.name}</div>
                        <div className="ts-teamType">
                          {isCore ? "Core team" : "Sub-team"}
                        </div>
                      </div>
                      <div className={`ts-teamBadge ${isCore ? "ts-teamBadge--core" : "ts-teamBadge--sub"}`}>
                        {t.team_type}
                      </div>
                      <div className="ts-teamCount">
                        {t.member_count ?? 0}
                        <span className="ts-teamCountLabel">athletes</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tiny scoped styles so we don't disturb your existing design system */}
      <style>{`

        /* ─────────────────────────────────────────────
           STRUCTURAL LAYOUT — mobile-first responsive
           These classes are referenced in JSX but live
           in the global stylesheet. We re-declare them
           here so the dashboard is fully self-contained.
        ───────────────────────────────────────────── */

        /* Root wrapper */
        .ts-dash {
          padding: 24px 32px 48px;
          box-sizing: border-box;
          width: 100%;
        }

        /* Top bar: title/tabs on left, action button on right */
        .ts-dashTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .ts-dashHead {
          flex: 1;
          min-width: 0;
        }
        .ts-dashTitle {
          font-size: 26px;
          font-weight: 800;
          margin: 0 0 4px;
          letter-spacing: -0.01em;
        }
        .ts-dashSub {
          font-size: 13px;
          opacity: 0.50;
          margin: 6px 0 0;
        }
        .ts-dashActions {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          flex-shrink: 0;
          padding-top: 4px;
          min-width: 130px;
        }

        /* Buttons */
        .ts-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 9px 18px;
          border-radius: 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 140ms ease, border-color 140ms ease,
                      transform 100ms ease, box-shadow 140ms ease;
          white-space: nowrap;
        }
        .ts-btn:active { transform: translateY(1px); }
        .ts-btnGhost {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.14);
          color: inherit;
        }
        .ts-btnGhost:hover {
          background: rgba(255,255,255,0.09);
          border-color: rgba(255,255,255,0.22);
          transform: translateY(-1px);
        }
        .ts-btnSecondary {
          background: rgba(180,0,255,0.14);
          border-color: rgba(180,0,255,0.38);
          color: rgba(210,140,255,0.95);
        }
        .ts-btnSecondary:hover {
          background: rgba(180,0,255,0.22);
          border-color: rgba(180,0,255,0.55);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(180,0,255,0.18);
        }
        :root[data-theme="light"] .ts-btnGhost {
          background: rgba(20,20,40,0.05);
          border-color: rgba(20,20,40,0.16);
        }
        :root[data-theme="light"] .ts-btnGhost:hover {
          background: rgba(20,20,40,0.09);
        }

        /* 2-column dashboard grid */
        .ts-dashGrid {
          display: grid;
          gap: 16px;
        }
        .ts-dashMain {
          grid-template-columns: 1fr 1fr;
        }
        .ts-span2 {
          grid-column: span 2;
        }

        /* Card */
        .ts-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 20px;
          padding: 20px 22px;
          box-sizing: border-box;
          min-width: 0;
        }
        :root[data-theme="light"] .ts-card {
          background: rgba(255,255,255,0.75);
          border-color: rgba(20,20,40,0.10);
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }
        .ts-cardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .ts-cardTitle {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        /* ── Mobile overrides ── */

        /* Tablet: single-column grid */
        @media (max-width: 860px) {
          .ts-dashMain {
            grid-template-columns: 1fr;
          }
          .ts-span2 {
            grid-column: span 1;
          }
          .ts-dash {
            padding: 20px 20px 40px;
          }
        }

        /* Phone: tighter padding, stacked top bar */
        @media (max-width: 600px) {
          .ts-dash {
            padding: 16px 14px 36px;
          }
          .ts-dashTop {
            flex-direction: column;
            gap: 12px;
            margin-bottom: 18px;
          }
          .ts-dashActions {
            width: 100%;
          }
          .ts-dashActions .ts-btn {
            width: 100%;
            justify-content: center;
          }
          .ts-dashTitle {
            font-size: 22px;
          }
          .ts-card {
            padding: 16px 16px;
            border-radius: 16px;
          }
          .ts-dashGrid {
            gap: 12px;
          }
        }

        /* Small phone */
        @media (max-width: 400px) {
          .ts-dash {
            padding: 12px 10px 32px;
          }
          .ts-card {
            padding: 14px 12px;
            border-radius: 14px;
          }
          .ts-dashTitle {
            font-size: 20px;
          }
        }

        /* ── Recent Sessions — filter bar ── */

        /* Hide emoji icons only on very small phones to reclaim label space */
        @media (max-width: 1024px) {
          .ts-filterModeIcon { display: none; }
        }

        /* ── Charts & Graphs — hidden on mobile ── */
        @media (max-width: 860px) {
          .ts-chartsCard {
            display: none;
          }
        }

        /* ─────────────────────────────────────────────
           END STRUCTURAL LAYOUT
        ───────────────────────────────────────────── */

        .ts-tabsRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-top:12px;
          margin-bottom:4px;
          flex-wrap:wrap;
        }
        .ts-tabs{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
        }
        .ts-tabBtn{
          appearance:none;
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: inherit;
          padding: 8px 12px;
          border-radius: 999px;
          cursor:pointer;
          font: inherit;
          line-height: 1;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        }
        .ts-tabBtn:hover{
          background: rgba(255,255,255,0.07);
          transform: translateY(-1px);
        }
        .ts-tabBtn.isActive{
          border-color: rgba(255,255,255,0.22);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        }
        /* Dark mode — purple text + border on active tab */
        :root:not([data-theme="light"]) .ts-tabBtn.isActive{
          border-color: rgba(180,0,255,0.55);
          color: rgba(210,140,255,0.96);
        }
        .ts-tabBtn:active{
          transform: translateY(1px);
        }

        /* Avatar popover */
        /* ── Skeleton shimmer ── */
        @keyframes tsSkeleton {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .ts-skel {
          border-radius: 6px;
          background: linear-gradient(90deg,
            rgba(255,255,255,0.06) 25%,
            rgba(255,255,255,0.12) 50%,
            rgba(255,255,255,0.06) 75%
          );
          background-size: 200% 100%;
          animation: tsSkeleton 1.4s ease infinite;
        }
        :root[data-theme="light"] .ts-skel {
          background: linear-gradient(90deg,
            rgba(20,20,40,0.06) 25%,
            rgba(20,20,40,0.11) 50%,
            rgba(20,20,40,0.06) 75%
          );
          background-size: 200% 100%;
        }

        @keyframes tsPopoverIn {
          from { opacity: 0; transform: translateY(4px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        .ts-recentSessionAvatar:hover{
          border-color: rgba(180,0,255,0.55) !important;
          background: linear-gradient(135deg, rgba(180,0,255,0.38), rgba(180,0,255,0.18)) !important;
        }

        /* Leaderboard */
        .ts-leaderTop{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:14px;
          margin-top:8px;
          margin-bottom:14px;
          flex-wrap:wrap;
        }
        .ts-leaderNote{
          opacity:0.95;
          font-size:14px;
          max-width: 740px;
        }
        .ts-leaderControls{
          display:flex;
          align-items:center;
          gap:10px;
        }
        .ts-leaderLabel{
          font-size:12px;
          opacity:0.85;
        }
        .ts-select{
          border:1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: inherit;
          padding: 8px 12px;
          border-radius: 12px;
          font: inherit;
          outline:none;
        }
        .ts-leaderTable{
          display:flex;
          flex-direction:column;
          gap:10px;
        }
        .ts-leaderRow{
          display:grid;
          grid-template-columns: 44px 1.6fr 1fr 1fr 0.8fr;
          gap:10px;
          padding: 12px;
          border:1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          align-items:center;
        }
        .ts-leaderHead{
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.12);
          font-size:12px;
          letter-spacing:0.02em;
          text-transform:uppercase;
          opacity:0.95;
        }
        .ts-leaderCell{
          display:flex;
          align-items:center;
          min-width:0;
        }
        .ts-leaderCell.rank{
          justify-content:center;
          font-variant-numeric: tabular-nums;
          opacity:0.85;
        }
        .ts-leaderCell.name{
          flex-direction:column;
          align-items:flex-start;
          gap:2px;
        }
        .ts-leaderName{
          font-weight:600;
        }
        .ts-leaderSub{
          font-size:12px;
          opacity:0.75;
        }
        @media (max-width: 880px){
          .ts-leaderRow{
            grid-template-columns: 40px 1.6fr 1fr 1fr;
          }
          .ts-leaderRow .ts-leaderCell:last-child{
            display:none;
          }
        }

        /* Most Improved */
        .ts-mostImproved{
          display:flex;
          flex-direction:column;
          gap:12px;
          margin-top:8px;
        }
        .ts-mostRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .ts-miLabel{
          min-width: 180px;
        }
        .ts-miTitle{
          font-weight:600;
          font-size:15px;
        }
        .ts-miSubtitle{
          font-size:12px;
          opacity:0.7;
          margin-top:4px;
        }
        .ts-miBody{
          display:flex;
          align-items:center;
          gap:16px;
          min-width:220px;
        }
        .ts-miName{
          font-weight:600;
          min-width:120px;
        }
        .ts-miPills{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .ts-improvePill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding: 6px 10px;
          border-radius: 999px;
          border:1px solid rgba(255,255,255,0.10);
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          font-size: 13px;
          white-space: nowrap;
        }
        .ts-addTeamBtn{
          font-size:12px;
          padding:5px 10px;
          border-radius:999px;
          display:inline-flex;
          align-items:center;
          white-space:nowrap;
        }
        .ts-cardMeta{
          opacity:0.85;
        }
        .ts-cardHint{
          margin-top:10px;
          opacity:0.85;
          font-size:13px;
        }

        /* Athletes list */
        .ts-athleteFilterBar{
          display:flex;
          align-items:center;
          gap:8px;
          margin-top:14px;
          padding:9px 13px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.04);
          transition:border-color 160ms ease, box-shadow 160ms ease;
        }
        .ts-athleteFilterBar:focus-within{
          border-color:rgba(180,0,255,0.45);
          box-shadow:0 0 0 3px rgba(180,0,255,0.10);
        }
        .ts-athleteFilterIcon{
          flex-shrink:0;
          opacity:0.45;
        }
        .ts-athleteFilterInput{
          flex:1;
          background:none;
          border:none;
          outline:none;
          color:inherit;
          font:inherit;
          font-size:14px;
          min-width:0;
        }
        .ts-athleteFilterInput::placeholder{
          opacity:0.40;
        }
        .ts-athleteFilterClear{
          appearance:none;
          border:none;
          background:none;
          color:inherit;
          opacity:0.40;
          cursor:pointer;
          padding:2px 4px;
          font-size:12px;
          line-height:1;
          transition:opacity 120ms ease;
        }
        .ts-athleteFilterClear:hover{ opacity:0.80; }
        .ts-athleteList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:10px;
        }
        .ts-athleteRow{
          display:flex;
          align-items:center;
          gap:14px;
          padding:12px 14px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          cursor:pointer;
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        :root[data-theme="light"] .ts-athleteRow{
          border-color:rgba(20,20,40,0.08);
          background:rgba(20,20,40,0.02);
        }
        .ts-athleteRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 18px rgba(0,0,0,0.22);
        }
        :root[data-theme="light"] .ts-athleteRow:hover{
          box-shadow:0 4px 18px rgba(0,0,0,0.10);
        }
        .ts-athleteRow:active{
          transform:translateY(0);
          box-shadow:none;
        }
        .ts-athleteAvatar{
          flex-shrink:0;
          width:40px;
          height:40px;
          border-radius:50%;
          background:linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10));
          border:1px solid rgba(180,0,255,0.30);
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:13px;
          font-weight:700;
          color:rgba(200,120,255,0.95);
          letter-spacing:0.02em;
          transition:background 150ms ease, border-color 150ms ease;
        }
        .ts-athleteRow:hover .ts-athleteAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.40), rgba(180,0,255,0.20));
          border-color:rgba(180,0,255,0.55);
        }
        .ts-athleteInfo{
          flex:1;
          min-width:0;
        }
        .ts-athleteName{
          font-weight:600;
          font-size:15px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-athleteMeta{
          font-size:12px;
          margin-top:2px;
          opacity:0.60;
        }
        .ts-athletePills{
          display:flex;
          gap:6px;
          flex-shrink:0;
        }
        .ts-athleteTrendBadge{
          flex-shrink:0;
        }
        @media (max-width: 600px) {
          .ts-athleteTrendBadge {
            display: none;
          }
        }
        .ts-athletePill{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 10px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.04);
          font-size:12px;
          white-space:nowrap;
          opacity:0.90;
        }
        :root[data-theme="light"] .ts-athletePill{
          border-color:rgba(20,20,40,0.12);
          background:rgba(20,20,40,0.04);
        }
        .ts-pillLabel{
          font-size:10px;
          font-weight:800;
          letter-spacing:0.06em;
          opacity:0.50;
          text-transform:uppercase;
        }
        .ts-athleteEmpty{
          margin-top:16px;
          font-size:13px;
          opacity:0.55;
          text-align:center;
          padding:24px 0;
        }
        .ts-athleteError{
          margin-top:12px;
          padding:10px 13px;
          border-radius:12px;
          border:1px solid rgba(255,80,80,0.25);
          background:rgba(255,80,80,0.07);
          color:rgba(255,130,130,0.95);
          font-size:13px;
        }

        /* Teams card */
        .ts-teamList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:14px;
        }
        .ts-teamRow{
          display:flex;
          align-items:center;
          gap:11px;
          padding:11px 12px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          cursor:pointer;
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        .ts-teamRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 16px rgba(0,0,0,0.20);
        }
        .ts-teamRow:active{ transform:translateY(0); box-shadow:none; }
        .ts-teamIcon{
          flex-shrink:0;
          width:34px;
          height:34px;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .ts-teamIcon--core{
          background:linear-gradient(135deg, rgba(180,0,255,0.28), rgba(180,0,255,0.12));
          border:1px solid rgba(180,0,255,0.35);
          color:rgba(210,130,255,0.95);
        }
        .ts-teamIcon--sub{
          background:linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
          border:1px solid rgba(255,255,255,0.12);
          color:rgba(255,255,255,0.55);
        }
        :root[data-theme="light"] .ts-teamIcon--sub{
          background:linear-gradient(135deg, rgba(20,20,40,0.07), rgba(20,20,40,0.03));
          border:1px solid rgba(20,20,40,0.16);
          color:rgba(20,20,40,0.60);
        }
        .ts-teamInfo{
          flex:1;
          min-width:0;
        }
        .ts-teamName{
          font-weight:600;
          font-size:14px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-teamType{
          font-size:11px;
          margin-top:2px;
          opacity:0.50;
        }
        .ts-teamBadge{
          flex-shrink:0;
          font-size:10px;
          font-weight:800;
          letter-spacing:0.07em;
          text-transform:uppercase;
          padding:3px 9px;
          border-radius:999px;
        }
        .ts-teamBadge--core{
          background:rgba(180,0,255,0.14);
          border:1px solid rgba(180,0,255,0.30);
          color:rgba(210,130,255,0.95);
        }
        .ts-teamBadge--sub{
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.12);
          color:rgba(255,255,255,0.55);
        }
        :root[data-theme="light"] .ts-teamBadge--sub{
          background:rgba(20,20,40,0.05);
          border:1px solid rgba(20,20,40,0.18);
          color:rgba(20,20,40,0.65);
        }
        .ts-teamCount{
          flex-shrink:0;
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:1px;
          font-size:15px;
          font-weight:700;
          font-variant-numeric:tabular-nums;
          opacity:0.80;
          min-width:32px;
          text-align:right;
        }
        .ts-teamCountLabel{
          display:block;
          font-size:10px;
          font-weight:600;
          letter-spacing:0.04em;
          opacity:0.50;
          text-transform:uppercase;
        }

        @media (max-width: 720px) {
          .ts-miBody{
            flex-direction:column;
            align-items:flex-start;
            gap:6px;
          }
          .ts-miLabel{
            min-width: auto;
          }
        }

        /* Recent Sessions */
        .ts-recentSessionsList{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:10px;
        }
        .ts-recentSessionRow{
          display:flex;
          align-items:center;
          gap:12px;
          padding:10px 12px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.07);
          background:rgba(255,255,255,0.02);
          transition:background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
          cursor:pointer;
          min-height: 52px;
        }
        .ts-recentSessionRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 18px rgba(0,0,0,0.22);
        }
        .ts-recentSessionRow:hover .ts-recentSessionAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.40), rgba(180,0,255,0.20));
          border-color:rgba(180,0,255,0.55);
        }
        .ts-recentSessionRow:active{
          transform:translateY(0);
          box-shadow:none;
        }
        .ts-recentSessionRow.isSelected{
          background:rgba(180,0,255,0.10);
          border-color:rgba(180,0,255,0.40);
          box-shadow:0 0 0 1px rgba(180,0,255,0.18), 0 4px 18px rgba(0,0,0,0.20);
        }
        .ts-recentSessionRow.isSelected .ts-recentSessionAvatar{
          background:linear-gradient(135deg, rgba(180,0,255,0.45), rgba(180,0,255,0.22));
          border-color:rgba(180,0,255,0.60);
        }
        .ts-recentSessionAvatar{
          flex-shrink:0;
          width:36px;
          height:36px;
          border-radius:50%;
          background:linear-gradient(135deg, rgba(180,0,255,0.25), rgba(180,0,255,0.10));
          border:1px solid rgba(180,0,255,0.30);
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:12px;
          font-weight:700;
          color:rgba(200,120,255,0.95);
          letter-spacing:0.02em;
          transition:background 150ms ease, border-color 150ms ease;
        }
        /* Info column: grows to fill available width */
        .ts-recentSessionInfo{
          flex:1;
          min-width:0;
          display:flex;
          align-items:center;
          gap:10px;
        }
        /* Text block: name + timestamp */
        .ts-recentSessionText{
          flex:1;
          min-width:0;
        }
        .ts-recentSessionAthlete{
          font-size:14px;
          font-weight:600;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ts-recentSessionMeta{
          font-size:12px;
          margin-top:2px;
          opacity:0.50;
        }
        .ts-recentSessionMode{
          flex-shrink:0;
          font-size:11px;
          font-weight:700;
          letter-spacing:0.06em;
          text-transform:uppercase;
          padding:3px 10px;
          border-radius:999px;
        }
        .ts-recentSessionChevron{
          flex-shrink:0;
          opacity:0.30;
          transition:opacity 150ms ease, transform 150ms ease;
        }
        .ts-recentSessionRow:hover .ts-recentSessionChevron,
        .ts-recentSessionRow.isSelected .ts-recentSessionChevron{
          opacity:0.70;
          transform:translateX(2px);
        }

        /* ── Session row: mobile responsive ── */
        @media (max-width: 600px) {
          /* Stack info column vertically: name on top, meta + mode pill below */
          .ts-recentSessionInfo {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .ts-recentSessionText {
            width: 100%;
          }
          .ts-recentSessionAthlete {
            font-size: 13px;
            white-space: nowrap;
          }
          .ts-recentSessionMeta {
            font-size: 11px;
            margin-top: 0;
          }
          /* Mode pill tucks under the name */
          .ts-recentSessionMode {
            font-size: 10px;
            padding: 2px 8px;
            letter-spacing: 0.04em;
          }
          .ts-recentSessionRow {
            gap: 10px;
            padding: 10px 10px;
            align-items: center;
          }
          /* Disable hover lift on touch devices */
          .ts-recentSessionRow:hover {
            transform: none;
          }
        }

        @media (max-width: 400px) {
          .ts-recentSessionAvatar {
            width: 32px;
            height: 32px;
            font-size: 11px;
          }
          .ts-recentSessionAthlete {
            font-size: 12px;
          }
          .ts-recentSessionRow {
            padding: 9px 8px;
            gap: 8px;
          }
        }

        /* Heatmap card */
        .ts-heatmapCard{
          display:flex;
          flex-direction:column;
        }

        /* Two-column body: matrix left (2/3), stats right (1/3) */
        .ts-heatmapBody{
          display: flex;
          gap: 14px;
          align-items: flex-start;
          margin-top: 10px;
        }

        .ts-heatmapBagCol{
          flex: 0 0 calc(66.666% - 7px);
          min-width: 0;
          width: auto;
        }

        .ts-heatmapStatsCol{
          flex: 0 0 calc(33.333% - 7px);
          min-width: 0;
        }

        @media (max-width: 560px){
          .ts-heatmapBody{
            flex-direction: column;
          }

          .ts-heatmapBagCol,
          .ts-heatmapStatsCol{
            flex: none;
            width: 100%;
          }
        }

        /* Hide 3D angle compass on phones and tablets */
        @media (max-width: 1024px){
          .ts-strikeCompassWrap{
            display: none;
          }
        }

        /* Bag wrap — mirrors ts-ses-bagWrap */
        .ts-dash-bagWrap{
          position:relative;
          border-radius:16px;
          overflow:hidden;
          border:1px solid var(--panel-border, rgba(255,255,255,0.10));
          background:var(--panel, rgba(255,255,255,0.03));
          backdrop-filter:blur(12px);
          aspect-ratio: 2 / 3;
          width: 100%;
          transition:border-color 300ms ease, box-shadow 300ms ease;
          user-select:none;
        }

        /* Cell border */
        .ts-dash-cell{
          border:1px solid rgba(255,255,255,0.12);
          min-height:0;
        }
        :root[data-theme="light"] .ts-dash-cell{
          border-color:rgba(0,0,0,0.12);
        }

        /* Mode pill in card header */
        .ts-summaryModePill{
          font-size:10px;
          font-weight:800;
          letter-spacing:0.07em;
          text-transform:uppercase;
          padding:2px 8px;
          border-radius:999px;
        }
        .ts-summaryModePill[data-mode="power"]{
          background:rgba(180,0,255,0.12);
          border:1px solid rgba(180,0,255,0.28);
          color:rgba(210,130,255,0.95);
        }
        .ts-summaryModePill[data-mode="accuracy"]{
          background:rgba(0,220,255,0.10);
          border:1px solid rgba(0,220,255,0.28);
          color:rgba(80,220,255,0.95);
        }
        .ts-summaryModePill[data-mode="reaction"]{
          background:rgba(255,200,0,0.10);
          border:1px solid rgba(255,200,0,0.26);
          color:rgba(255,210,60,0.95);
        }
        .ts-summaryModePill[data-mode="volume"]{
          background:rgba(255,106,0,0.10);
          border:1px solid rgba(255,106,0,0.28);
          color:rgba(255,150,60,0.95);
        }
        .ts-summaryModePill[data-mode="target"]{
          background:rgba(0,255,136,0.10);
          border:1px solid rgba(0,255,136,0.28);
          color:rgba(0,220,110,0.95);
        }

        /* Summary stat rows */
        .ts-summaryList{
          display:flex;
          flex-direction:column;
          gap:4px;
        }
        .ts-summaryRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          padding:7px 10px;
          border-radius:9px;
          background:rgba(255,255,255,0.025);
          border:1px solid rgba(255,255,255,0.055);
          transition:background 120ms ease;
        }
        .ts-summaryRow:hover{
          background:rgba(255,255,255,0.042);
        }
        .ts-summaryRow.isAccent{
        }
        .ts-summaryRowLabel{
          font-size:11px;
          font-weight:600;
          opacity:0.50;
          white-space:nowrap;
          flex-shrink:0;
        }
        .ts-summaryRowValue{
          font-size:12px;
          font-weight:700;
          font-variant-numeric:tabular-nums;
          text-align:right;
          min-width:0;
        }
        .ts-summaryRow.isAccent .ts-summaryRowValue{
        }

        /* Replay controls */
        .ts-replayControls{
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          margin-top:10px;
        }
        .ts-replayBtn{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:5px 10px;
          border-radius:8px;
          border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.05);
          color:inherit;
          font:inherit;
          font-size:12px;
          font-weight:600;
          cursor:pointer;
          transition:background 120ms ease, border-color 120ms ease, transform 100ms ease;
        }
        .ts-replayBtn:hover:not(:disabled){
          background:rgba(180,0,255,0.12);
          border-color:rgba(180,0,255,0.35);
          transform:translateY(-1px);
        }
        .ts-replayBtn:disabled{
          opacity:0.35;
          cursor:default;
        }
        .ts-replayBtnPrimary{
          background:rgba(180,0,255,0.18);
          border-color:rgba(180,0,255,0.40);
          color:rgba(210,140,255,0.95);
        }
        .ts-replayBtnPrimary:hover:not(:disabled){
          background:rgba(180,0,255,0.28);
          border-color:rgba(180,0,255,0.55);
        }
        .ts-replaySpeed{
          display:flex;
          align-items:center;
          gap:4px;
          margin-left:4px;
        }
        .ts-replaySpeedLabel{
          font-size:11px;
          opacity:0.45;
          margin-right:2px;
        }
        .ts-replaySpeedBtn{
          padding:3px 8px;
          border-radius:6px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.03);
          color:inherit;
          font:inherit;
          font-size:11px;
          font-weight:600;
          cursor:pointer;
          opacity:0.55;
          transition:opacity 100ms ease, background 100ms ease, border-color 100ms ease;
        }
        .ts-replaySpeedBtn:hover{ opacity:0.85; }
        .ts-replaySpeedBtn.isActive{
          opacity:1;
          background:rgba(180,0,255,0.14);
          border-color:rgba(180,0,255,0.35);
          color:rgba(210,140,255,0.95);
        }
        /* ── Timeline scrubber ── */
        .ts-replayTimeline{
          position: relative;
          height: 20px;
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 0 2px;
          /* Extend click target above/below the thin track */
          margin: -4px 0;
          padding-top: 4px;
          padding-bottom: 4px;
          box-sizing: content-box;
        }
        /* The track background */
        .ts-replayTimeline::before{
          content: "";
          position: absolute;
          left: 0; right: 0;
          top: 50%; transform: translateY(-50%);
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,0.10);
          pointer-events: none;
        }
        /* The filled portion — injected as a child div */
        .ts-replayTrackFill{
          position: absolute;
          left: 0;
          top: 50%; transform: translateY(-50%);
          height: 3px;
          border-radius: 999px;
          pointer-events: none;
          transition: width 80ms linear;
        }
        /* Playhead knob — var(--text) so it's white in dark mode, black in light mode */
        .ts-replayHead{
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--text);
          box-shadow: 0 1px 4px rgba(0,0,0,0.35);
          pointer-events: none;
          transition: left 80ms linear;
          z-index: 4;
        }
        /* Event dots on the timeline */
        .ts-replayDot{
          position: absolute;
          top: 50%;
          border-radius: 50%;
          cursor: pointer;
          transition: background 150ms, transform 150ms, box-shadow 150ms;
          pointer-events: all;
        }
        .ts-replayDot:hover{
          transform: translate(-50%,-50%) scale(1.8) !important;
          z-index: 5 !important;
        }

        /* Ripple keyframes — identical to hitSimulator + session */
        @keyframes tsCorePulse {
          0%   { opacity:1;   transform:scale(1); }
          60%  { opacity:0.7; transform:scale(1.6); }
          100% { opacity:0;   transform:scale(0.5); }
        }
        @keyframes tsRipple {
          0%   { opacity:0.9; transform:translate(-50%,-50%) scale(0.5); }
          100% { opacity:0;   transform:translate(-50%,-50%) scale(4.5); }
        }
      `}</style>
    </div>
  );
}