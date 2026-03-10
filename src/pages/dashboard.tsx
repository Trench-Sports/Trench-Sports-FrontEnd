// src/pages/dashboard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProfileHeader, { Profile } from "../components/profileHeader";
import CreateAthleteModal from "../components/createAthlete";
import EditProfileModal from "../components/editProfile";
import ProgramModal from "../components/program";
import ManageTeamModal from "../components/manageTeam";
import { supabase } from "../supabaseClient";

type Insight = { title: string; body: string; tag: "Power" | "Accuracy" | "Tempo" | "Recovery" };

type RecentSession = {
  id: string;
  timestamp: string;
  mode: string;
  athleteFirstName: string;
  athleteLastName: string;
};

type HeatmapCell = { r: number; c: number; intensity: number }; // intensity 0–1
type ReplayEvent = { r: number; c: number; pressureKpa: number };

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
type MetricKey = "strength" | "reaction" | "accuracy";

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
      metric: "reaction";
      avgReactionMs: number; // ms (lower is better)
      bestReactionMs: number; // ms
      attempts: number;
    }
  | {
      name: string;
      metric: "accuracy";
      accuracyPct: number; // %
      avgOffsetCm: number; // cm (lower is better)
      onTargetHits: number;
      totalHits: number;
    };

export default function Dashboard() {
  const navigate = useNavigate();

  // ---------- tabs ----------
  const [activeTab, setActiveTab] = useState<TabKey>("recent");
  const [showCreateAthlete, setShowCreateAthlete] = useState(false);
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
    if (activeTab !== "athletes" || !programId || !supabase) return;

    async function fetchAthletes() {
      setAthletesLoading(true);
      setAthletesError("");
      try {
        const { data, error } = await supabase!
          .from("athletes")
          .select("id, first_name, last_name, height, weight, sport, position")
          .eq("program_id", programId)
          .order("last_name");

        if (error) throw error;
        setAthletes(data ?? []);
      } catch (err: any) {
        setAthletesError(err.message ?? "Failed to load athletes.");
      } finally {
        setAthletesLoading(false);
      }
    }

    fetchAthletes();
  }, [activeTab, programId]);

  // ---------- teams ----------
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState("");

  useEffect(() => {
    if (activeTab !== "athletes" || !programId || !profile?.role || !supabase) return;

    async function fetchTeams() {
      setTeamsLoading(true);
      setTeamsError("");
      try {
        let query = supabase!
          .from("teams")
          .select("id, name, team_type, parent_team_id, created_by, program_id, team_members(athlete_id)")
          .eq("program_id", programId)
          .order("name");

        // Coaches only see sub-teams (non-core)
        if (profile!.role === "coach") {
          query = query.neq("team_type", "core");
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
  }, [activeTab, programId, profile?.role]);

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
          .select("session_id, date_of_record, mode, athletes(first_name, last_name)")
          .eq("program_id", programId!)
          .order("date_of_record", { ascending: false })
          .limit(10);

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
            mode: row.mode ?? "Standard",
            athleteFirstName: row.athletes?.first_name ?? "—",
            athleteLastName: row.athletes?.last_name ?? "",
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

  // Replay state
  const [replayIndex, setReplayIndex] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(120); // ms per event
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!selectedSessionId || !supabase) return;

    setHeatmapCells([]);
    setReplayEvents([]);
    setReplayIndex(0);
    setIsReplaying(false);
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
            mode: summary.mode ?? "standard",
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
            // Support both array [{r,c,value}] and object {"r-c": value} formats
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

        // 2. Fetch ordered events + their cells for hit-by-hit replay
        const { data: events } = await supabase!
          .from("events")
          .select("event_id, t_start_ms, event_cells(r, c, p_max_kpa)")
          .eq("session_id", selectedSessionId!)
          .order("t_start_ms", { ascending: true });

        if (events) {
          const hits: ReplayEvent[] = [];
          for (const ev of events as any[]) {
            for (const cell of ev.event_cells ?? []) {
              hits.push({ r: cell.r, c: cell.c, pressureKpa: cell.p_max_kpa ?? 0 });
            }
          }
          setReplayEvents(hits);
        }
      } finally {
        setHeatmapLoading(false);
      }
    }

    fetchSessionHeatmap();
  }, [selectedSessionId]);

  // Drive the replay interval
  useEffect(() => {
    if (isReplaying && replayIndex < replayEvents.length) {
      replayTimerRef.current = setInterval(() => {
        setReplayIndex((i) => {
          const next = i + 1;
          if (next >= replayEvents.length) setIsReplaying(false);
          return next;
        });
      }, replaySpeed);
    }
    return () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); };
  }, [isReplaying, replaySpeed, replayEvents.length]);

  // Build a per-cell intensity map from replayed hits so far
  const replayHeatmap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < replayIndex; i++) {
      const ev = replayEvents[i];
      if (!ev) continue;
      const key = `${ev.r}-${ev.c}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [replayIndex, replayEvents]);

  const maxReplayHits = useMemo(() => Math.max(1, ...Array.from(replayHeatmap.values())), [replayHeatmap]);

  function startReplay() {
    setReplayIndex(0);
    setIsReplaying(true);
    setHeatmapRipples([]);
  }
  function pauseReplay() { setIsReplaying(false); }
  function resumeReplay() { if (replayIndex < replayEvents.length) setIsReplaying(true); }
  function resetReplay() { setIsReplaying(false); setReplayIndex(0); setHeatmapRipples([]); }

  // Ripples for heatmap replay
  const [heatmapRipples, setHeatmapRipples] = useState<Array<{ id: number; r: number; c: number; color: string }>>([]);
  const rippleIdRef = useRef(0);

  // Spawn a ripple whenever the replay advances
  useEffect(() => {
    if (replayIndex === 0 || replayIndex > replayEvents.length) return;
    const ev = replayEvents[replayIndex - 1];
    if (!ev) return;
    const mode = (sessionSummary?.mode ?? "standard").toLowerCase();
    const accent = mode === "accuracy" ? "#00dcff" : mode === "reaction" ? "#ffcc00" : "#b400ff";
    const color = ev.pressureKpa > 80 ? accent : ev.pressureKpa > 30 ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.5)";
    const id = ++rippleIdRef.current;
    setHeatmapRipples(prev => [...prev, { id, r: ev.r, c: ev.c, color }]);
    const t = setTimeout(() => setHeatmapRipples(prev => prev.filter(x => x.id !== id)), 900);
    return () => clearTimeout(t);
  }, [replayIndex, sessionSummary]);

  // ── Mode-aware accent colors ──────────────────────────────────────────────────
  const modeAccent = useMemo(() => {
    const m = (sessionSummary?.mode ?? "standard").toLowerCase();
    if (m === "accuracy") return "#00dcff";
    if (m === "reaction") return "#ffcc00";
    return "#b400ff";
  }, [sessionSummary]);

  const modeGlow = useMemo(() => {
    const m = (sessionSummary?.mode ?? "standard").toLowerCase();
    if (m === "accuracy") return "rgba(0,220,255,0.55)";
    if (m === "reaction") return "rgba(255,200,0,0.55)";
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
    const mode = (s.mode ?? "standard").toLowerCase();

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
      const bestRt    = s.iei_ms?.min ?? s.quality?.best_reaction_ms;
      const avgRt     = s.iei_ms?.mean ?? s.quality?.avg_reaction_ms;
      const impactDur = s.duration_ms_stats?.mean ?? s.duration_ms_stats?.avg;
      return [
        totalEvents,
        duration,
        { label: "Best Reaction", value: fmtNum(bestRt, 0, " ms"), accent: true },
        { label: "Avg Reaction",  value: fmtNum(avgRt, 0, " ms") },
        { label: "Impact Duration", value: fmtNum(impactDur, 0, " ms") },
        location,
        { label: "Angle",         value: fmtAngle(s.angles_deg) },
        cadence,
      ];
    }

    // standard / default
    const peakForce   = s.peak_force_stats?.max ?? s.peak_force_stats?.peak;
    const avgForce    = s.peak_force_stats?.mean ?? s.peak_force_stats?.avg;
    const peakImpulse = s.impulse_stats?.max ?? s.impulse_stats?.peak;
    return [
      totalEvents,
      duration,
      { label: "Peak Force",   value: fmtNum(peakForce, 1, " N"),   accent: true },
      { label: "Avg Force",    value: fmtNum(avgForce, 1, " N") },
      { label: "Peak Impulse", value: fmtNum(peakImpulse, 2, " N·s") },
      { label: "Angle",        value: fmtAngle(s.angles_deg) },
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
  const [leaderMetric, setLeaderMetric] = useState<MetricKey>("strength");
  const [strengthRows, setStrengthRows] = useState<Extract<LeaderRow, { metric: "strength" }>[]>([]);
  const [strengthLoading, setStrengthLoading] = useState(false);

  useEffect(() => {
    if (!programId || !userRole || !supabase) return;
    // Same guard as recent sessions — coaches must have coreTeamId resolved first
    if (userRole === "coach" && coreTeamId === null) return;

    setStrengthLoading(true);
    setStrengthRows([]);

    (async () => {
      try {
        // Fetch standard sessions with athlete names joined — scoped by role
        let query = supabase!
          .from("session_summaries")
          .select("athlete_id, quality, num_events, athletes(first_name, last_name)")
          .eq("program_id", programId)
          .eq("mode", "standard")
          .not("quality", "is", null);

        if (userRole === "coach" && coreTeamId) {
          query = query.eq("core_team_id", coreTeamId);
        }

        const { data, error } = await query;
        if (error || !data) return;

        // Aggregate per athlete across all their sessions
        type Agg = {
          name: string;
          peakIndex: number;
          avgSum: number;
          avgCount: number;
          sessions: number;
        };
        const aggMap = new Map<string, Agg>();

        for (const row of data as any[]) {
          const athleteId = row.athlete_id;
          if (!athleteId) continue;
          const si = row.quality?.strength_index;
          if (!si) continue;
          const siMax  = typeof si.max  === "number" ? si.max  : null;
          const siMean = typeof si.mean === "number" ? si.mean : null;
          if (siMax == null || siMean == null) continue;

          const name = row.athletes
            ? `${row.athletes.first_name} ${row.athletes.last_name}`
            : "Unknown Athlete";

          const existing = aggMap.get(athleteId);
          if (existing) {
            existing.peakIndex = Math.max(existing.peakIndex, siMax);
            existing.avgSum   += siMean;
            existing.avgCount += 1;
            existing.sessions += 1;
          } else {
            aggMap.set(athleteId, { name, peakIndex: siMax, avgSum: siMean, avgCount: 1, sessions: 1 });
          }
        }

        const rows: Extract<LeaderRow, { metric: "strength" }>[] = [];
        for (const [athleteId, agg] of aggMap.entries()) {
          rows.push({
            metric:    "strength",
            athleteId,
            name:      agg.name,
            peakIndex: Math.round(agg.peakIndex),
            avgIndex:  Math.round(agg.avgSum / agg.avgCount),
            sessions:  agg.sessions,
          });
        }

        rows.sort((a, b) => b.peakIndex - a.peakIndex);
        setStrengthRows(rows.slice(0, 5));
      } finally {
        setStrengthLoading(false);
      }
    })();
  }, [programId, userRole, coreTeamId]);

  const leaderboardData = useMemo<LeaderRow[]>(() => {
    if (leaderMetric === "strength") return strengthRows;
    return [];
  }, [leaderMetric, strengthRows]);

  // Most Improved — will be wired to Supabase once reaction/accuracy have enough sessions
  const mostImproved = useMemo(() => {
    return {
      strength: { name: "—", deltaPeak: 0, deltaAvg: 0 },
      reaction: { name: "—", deltaAvgMs: 0, deltaBestMs: 0 },
      accuracy: { name: "—", deltaPct: 0, deltaOffsetCm: 0 },
    };
  }, []);

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

          {/* TABS + Add Athlete action on the right */}
          <div className="ts-tabsRow" role="tablist" aria-label="Dashboard sections">
            <div className="ts-tabs">
              {tabBtn("recent", "Recent Session")}
              {tabBtn("insights", "Insights and Analysis")}
              {tabBtn("athletes", "Individual Athletes")}
            </div>
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

          <p className="ts-dashSub">Realtime training metrics + AI-ready analysis.</p>
        </div>

        <div className="ts-dashActions">
          <button className="ts-btn ts-btnGhost" onClick={() => navigate("/session")}>
            New Session
          </button>
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === "recent" ? (
        <>
          {/* MAIN GRID */}
          <div className="ts-dashGrid ts-dashMain">
            {/* Recent Sessions */}
            <div className="ts-card ts-span2">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Recent Sessions</div>
                <div className="ts-cardMeta">
                  {recentSessionsLoading ? "Loading…" : `${recentSessions.length} sessions`}
                </div>
              </div>

              {recentSessionsError ? (
                <div className="ts-athleteError">{recentSessionsError}</div>
              ) : recentSessionsLoading ? (
                <div className="ts-athleteEmpty">Loading recent sessions…</div>
              ) : recentSessions.length === 0 ? (
                <div className="ts-athleteEmpty">No sessions found for this program.</div>
              ) : (
                <div className="ts-recentSessionsList">
                  {recentSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`ts-recentSessionRow${selectedSessionId === session.id ? " isSelected" : ""}`}
                      onClick={() => {
                        setSelectedSessionId(session.id);
                        resetReplay();
                      }}
                    >
                      <div className="ts-recentSessionAvatar">
                        {session.athleteFirstName[0]}{session.athleteLastName[0]}
                      </div>
                      <div className="ts-recentSessionInfo">
                        <div className="ts-recentSessionAthlete">
                          {session.athleteFirstName} {session.athleteLastName}
                        </div>
                        <div className="ts-recentSessionMeta">{formatSessionTime(session.timestamp)}</div>
                      </div>
                      <div
                        className="ts-recentSessionMode"
                        style={(() => {
                          const m = (session.mode ?? "standard").toLowerCase();
                          const color = m === "accuracy" ? "#00dcff" : m === "reaction" ? "#ffcc00" : "#b400ff";
                          const icon  = m === "accuracy" ? "🎯 " : m === "reaction" ? "⚡️ " : "💥 ";
                          return {
                            background: `${color}14`,
                            border: `1px solid ${color}44`,
                            color,
                          };
                        })()}
                      >
                        {(() => {
                          const m = (session.mode ?? "standard").toLowerCase();
                          const icon = m === "accuracy" ? "🎯" : m === "reaction" ? "⚡️" : "💥";
                          const label = m.charAt(0).toUpperCase() + m.slice(1);
                          return `${icon} ${label}`;
                        })()}
                      </div>
                      <div className="ts-recentSessionChevron">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Impact Heatmap */}
            <div className="ts-card ts-heatmapCard">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Impact Heatmap</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {sessionSummary && (
                    <div className="ts-summaryModePill" data-mode={(sessionSummary.mode ?? "standard").toLowerCase()}>
                      {(sessionSummary.mode ?? "standard").charAt(0).toUpperCase() + (sessionSummary.mode ?? "standard").slice(1)}
                    </div>
                  )}
                  <div className="ts-cardMeta">
                    {heatmapLoading
                      ? "Loading…"
                      : selectedSessionId
                      ? replayEvents.length > 0
                        ? `${replayIndex} / ${replayEvents.length} hits`
                        : `${heatmapCells.length} zones`
                      : "12 × 8 Grid"}
                  </div>
                </div>
              </div>

              {/* Replay controls — full width, above the body */}
              {selectedSessionId && !heatmapLoading && replayEvents.length > 0 && (
                <div className="ts-replayControls">
                  {replayIndex === 0 && !isReplaying ? (
                    <button className="ts-replayBtn ts-replayBtnPrimary" onClick={startReplay} title="Play replay">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path d="M3 2l8 4.5L3 11V2Z" fill="currentColor"/>
                      </svg>
                      Replay
                    </button>
                  ) : isReplaying ? (
                    <button className="ts-replayBtn" onClick={pauseReplay} title="Pause">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <rect x="2" y="2" width="3.5" height="9" rx="1" fill="currentColor"/>
                        <rect x="7.5" y="2" width="3.5" height="9" rx="1" fill="currentColor"/>
                      </svg>
                      Pause
                    </button>
                  ) : (
                    <button className="ts-replayBtn" onClick={resumeReplay} title="Resume">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path d="M3 2l8 4.5L3 11V2Z" fill="currentColor"/>
                      </svg>
                      Resume
                    </button>
                  )}
                  <button className="ts-replayBtn" onClick={resetReplay} title="Reset" disabled={replayIndex === 0 && !isReplaying}>
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M2 6.5a4.5 4.5 0 1 1 1.2 3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <path d="M2 10V6.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Reset
                  </button>
                  <div className="ts-replaySpeed">
                    <span className="ts-replaySpeedLabel">Speed</span>
                    {([240, 120, 60] as const).map((ms) => (
                      <button
                        key={ms}
                        className={`ts-replaySpeedBtn${replaySpeed === ms ? " isActive" : ""}`}
                        onClick={() => setReplaySpeed(ms)}
                      >
                        {ms === 240 ? "0.5×" : ms === 120 ? "1×" : "2×"}
                      </button>
                    ))}
                  </div>
                  <div className="ts-replayProgress">
                    <div
                      className="ts-replayProgressFill"
                      style={{ width: `${replayEvents.length > 0 ? (replayIndex / replayEvents.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

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
                              const c = ci + 1;
                              const key = `${r}-${c}`;
                              let intensity = 0;
                              let kpa = 0;

                              if (replayEvents.length > 0) {
                                const hits = replayHeatmap.get(key) ?? 0;
                                intensity = hits / maxReplayHits;
                                if (replayIndex > 0 && replayEvents[replayIndex - 1]?.r === r && replayEvents[replayIndex - 1]?.c === c) {
                                  kpa = replayEvents[replayIndex - 1].pressureKpa;
                                } else {
                                  kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                                }
                              } else {
                                const cell = heatmapCells.find((hc) => hc.r === r && hc.c === c);
                                intensity = cell?.intensity ?? 0;
                                kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                              }

                              const isAlive = intensity > 0;
                              const color = isAlive ? pressureToColor(kpa) : null;
                              const glow  = isAlive ? pressureToGlow(kpa) : null;
                              const isJustHit =
                                replayIndex > 0 &&
                                replayEvents[replayIndex - 1]?.r === r &&
                                replayEvents[replayIndex - 1]?.c === c;

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
                        const xPct = ((ripple.c - 0.5) / 8) * 100;
                        const yPct = ((ripple.r - 0.5) / 12) * 100;
                        return (
                          <div key={ripple.id} style={{
                            position: "absolute", left: `${xPct}%`, top: `${yPct}%`,
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
                      <div style={{ fontSize: 12, opacity: 0.40, padding: "8px 0" }}>Loading…</div>
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
                  </div>

                </div>
              )}
            </div>

            {/* AI Insights */}
            <div className="ts-card ts-span2">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">AI Insights</div>
                <div className="ts-cardMeta">placeholders</div>
              </div>

              <div className="ts-insights">
                {insights.map((it) => (
                  <div key={it.title} className="ts-insight">
                    <div className="ts-insightTop">
                      <div className="ts-tag">{it.tag}</div>
                      <div className="ts-insightTitle">{it.title}</div>
                    </div>
                    <div className="ts-insightBody">{it.body}</div>
                  </div>
                ))}
              </div>

              <div className="ts-cardHint">
                Next: wire in "session summary" generation (peak/avg, strike clusters, fatigue trend, recommended drills).
              </div>
            </div>

            {/* Analysis */}
            <div className="ts-card">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">In-Depth Analysis</div>
                <div className="ts-cardMeta">coming soon</div>
              </div>

              <div className="ts-list">
                <div className="ts-listItem">
                  <div className="ts-listTitle">Consistency Score</div>
                  <div className="ts-listVal">{connected ? "—" : "Connect to compute"}</div>
                </div>
                <div className="ts-listItem">
                  <div className="ts-listTitle">Fatigue Curve</div>
                  <div className="ts-listVal">Placeholder</div>
                </div>
                <div className="ts-listItem">
                  <div className="ts-listTitle">Accuracy Drift</div>
                  <div className="ts-listVal">Placeholder</div>
                </div>
                <div className="ts-listItem">
                  <div className="ts-listTitle">Tempo Breakdown</div>
                  <div className="ts-listVal">Placeholder</div>
                </div>
              </div>

              <button className="ts-btn ts-btnGhostWide" type="button" onClick={() => alert("Open analysis view later")}>
                Open Analysis
              </button>
            </div>

            {/* Charts */}
            <div className="ts-card ts-span2">
              <div className="ts-cardTop">
                <div className="ts-cardTitle">Charts & Graphs</div>
                <div className="ts-cardMeta">placeholders</div>
              </div>

              <div className="ts-chartsGrid">
                <div className="ts-chartStub">
                  <div className="ts-chartTitle">Force Distribution</div>
                  <div className="ts-chartBox" />
                </div>
                <div className="ts-chartStub">
                  <div className="ts-chartTitle">Speed Over Time</div>
                  <div className="ts-chartBox" />
                </div>
                <div className="ts-chartStub">
                  <div className="ts-chartTitle">Zone Frequency</div>
                  <div className="ts-chartBox" />
                </div>
                <div className="ts-chartStub">
                  <div className="ts-chartTitle">Session Comparisons</div>
                  <div className="ts-chartBox" />
                </div>
              </div>

              <div className="ts-cardHint">If you want, we can add a chart library next (Recharts is a great pick for React).</div>
            </div>
          </div>
        </>
      ) : activeTab === "insights" ? (
        <div className="ts-dashGrid ts-dashMain">
          {/* Leaderboard */}
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Leaderboard</div>
              <div className="ts-cardMeta">
                {leaderMetric === "strength"
                  ? strengthLoading ? "Loading…" : `${strengthRows.length} athletes · live`
                  : "coming soon"}
              </div>
            </div>

            <div className="ts-leaderTop">
              <div className="ts-leaderNote">
                {leaderMetric === "strength"
                  ? "Top 5 athletes by Strength Index (0–1000). Peak = best single event. Avg = mean across all events."
                  : leaderMetric === "reaction"
                  ? "Top 5 athletes by Reaction Time — lower is better. Wired to Supabase once enough sessions exist."
                  : "Top 5 athletes by Accuracy Score. Wired to Supabase once enough sessions exist."}
              </div>
              <div className="ts-leaderControls">
                <label className="ts-leaderLabel" htmlFor="leaderMetric">Mode</label>
                <select
                  id="leaderMetric"
                  className="ts-select"
                  value={leaderMetric}
                  onChange={(e) => setLeaderMetric(e.target.value as MetricKey)}
                >
                  <option value="strength">💥 Standard</option>
                  <option value="reaction">⚡️ Reaction</option>
                  <option value="accuracy">🎯 Accuracy</option>
                </select>
              </div>
            </div>

            <div className="ts-leaderTable" role="table" aria-label="Leaderboard">
              <div className="ts-leaderRow ts-leaderHead" role="row">
                <div className="ts-leaderCell rank" role="columnheader">#</div>
                <div className="ts-leaderCell name" role="columnheader">Athlete</div>
                {leaderMetric === "strength" ? (
                  <>
                    <div className="ts-leaderCell" role="columnheader">Peak Index</div>
                    <div className="ts-leaderCell" role="columnheader">Avg Index</div>
                    <div className="ts-leaderCell" role="columnheader">Sessions</div>
                  </>
                ) : leaderMetric === "reaction" ? (
                  <>
                    <div className="ts-leaderCell" role="columnheader">Avg Reaction</div>
                    <div className="ts-leaderCell" role="columnheader">Best</div>
                    <div className="ts-leaderCell" role="columnheader">Attempts</div>
                  </>
                ) : (
                  <>
                    <div className="ts-leaderCell" role="columnheader">Accuracy</div>
                    <div className="ts-leaderCell" role="columnheader">Avg Offset</div>
                    <div className="ts-leaderCell" role="columnheader">Sessions</div>
                  </>
                )}
              </div>

              {leaderMetric === "strength" ? (
                strengthLoading ? (
                  <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, opacity: 0.4 }}>
                    Loading leaderboard…
                  </div>
                ) : strengthRows.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, opacity: 0.4 }}>
                    No standard sessions recorded yet
                  </div>
                ) : strengthRows.map((row, idx) => (
                  <div key={row.athleteId} className="ts-leaderRow" role="row">
                    <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
                    <div className="ts-leaderCell name" role="cell">
                      <div className="ts-leaderName">{row.name}</div>
                      <div className="ts-leaderSub">Power profile</div>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.peakIndex}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.avgIndex}</span>
                      <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>/1000</span>
                    </div>
                    <div className="ts-leaderCell" role="cell">{row.sessions}</div>
                  </div>
                ))
              ) : (
                <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, opacity: 0.4 }}>
                  No {leaderMetric} sessions recorded yet
                </div>
              )}
            </div>

            <div className="ts-cardHint">Reaction Time and Accuracy leaderboards will be wired to Supabase once enough sessions are recorded.</div>
          </div>

          {/* Most Improved */}
          <div className="ts-card">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Most Improved</div>
              <div className="ts-cardMeta">coming soon</div>
            </div>

            <div className="ts-mostImproved">
              {[
                { title: "Strength",      subtitle: "largest combined jump in peak & avg index" },
                { title: "Reaction Time", subtitle: "avg & best ms — reduction = improvement" },
                { title: "Accuracy",      subtitle: "accuracy % & avg offset" },
              ].map(({ title, subtitle }) => (
                <div key={title} className="ts-mostRow">
                  <div className="ts-miLabel">
                    <div className="ts-miTitle">{title}</div>
                    <div className="ts-miSubtitle">{subtitle}</div>
                  </div>
                  <div className="ts-miBody">
                    <div className="ts-miName" style={{ opacity: 0.35 }}>—</div>
                    <div className="ts-miPills" style={{ opacity: 0.35 }}>
                      <div className="ts-improvePill">needs more sessions</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="ts-cardHint">
              Will show deltas across a selectable time range once enough sessions are recorded per athlete.
            </div>
          </div>
        </div>
      ) : (
        <div className="ts-dashGrid ts-dashMain">
          <div className="ts-card ts-span2">
            <div className="ts-cardTop">
              <div className="ts-cardTitle">Individual Athletes</div>
              <div className="ts-cardMeta">{athletes.length} athlete{athletes.length !== 1 ? "s" : ""}</div>
            </div>

            {athletesLoading && (
              <div className="ts-athleteEmpty">Loading athletes…</div>
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
                      {filtered.map((a) => {
                        const fullName = `${a.first_name} ${a.last_name}`;
                        const initials = [a.first_name, a.last_name]
                          .filter(Boolean)
                          .map((w) => w[0]?.toUpperCase())
                          .join("");
                        return (
                          <div key={a.id} className="ts-athleteRow">
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
              <div className="ts-athleteEmpty">Loading teams…</div>
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
                            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                            <path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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
        .ts-tabBtn:active{
          transform: translateY(1px);
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
        .ts-athleteRow:hover{
          background:rgba(180,0,255,0.07);
          border-color:rgba(180,0,255,0.28);
          transform:translateY(-1px);
          box-shadow:0 4px 18px rgba(0,0,0,0.22);
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
        .ts-recentSessionInfo{
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
        .ts-summaryModePill[data-mode="standard"]{
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
        .ts-replayProgress{
          flex:1;
          min-width:60px;
          height:3px;
          border-radius:999px;
          background:rgba(255,255,255,0.08);
          overflow:hidden;
        }
        .ts-replayProgressFill{
          height:100%;
          border-radius:999px;
          background:linear-gradient(90deg, rgba(140,0,255,0.70), rgba(200,80,255,0.90));
          transition:width 100ms linear;
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