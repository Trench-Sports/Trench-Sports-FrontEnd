// src/lib/sessionSummaries.ts
//
// Session-summary reads shared by the desktop and mobile coach dashboards.
// List views go through tiered_session_rows() (supabase/dashboard_light_reads.sql):
// the same tier scoping as tiered_session_summaries(), minus the per-session
// arrays (quality.windows, quality.si_all_values, iei_ms.values) no list reads.
// The single-session detail view still calls tiered_session_summaries() with
// p_session_id, because it needs the heatmap and the full distributions.
import { supabase } from "../supabaseClient";

// Row shape returned by tiered_session_rows(). jsonb columns stay loosely
// typed; their keys vary by mode and tier (see mask_quality in entitlements.sql).
export type SessionRow = {
  session_id: string;
  core_team_id: string | null;
  athlete_id: string | null;
  athlete_first_name: string | null;
  athlete_last_name: string | null;
  date_of_record: string | null;
  mode: string | null;
  num_events: number | null;
  session_duration_ms: number | null;
  cadence_hz_avg: number | null;
  quality: any;
  peak_force_stats: any;
  angles_deg: any;
  iei_ms: any;
};

export type SessionRowFilters = {
  mode?: string | null;
  rangeDays?: number | null;
  athleteIds?: string[] | null;
  coreTeamId?: string | null;
  limit?: number | null;
  offset?: number | null;
};

type RowsResult = { data: SessionRow[] | null; error: { message: string } | null };

// PostgREST caps every response at its max-rows setting (1000 on hosted
// Supabase), so an RPC with no limit is silently truncated once a program's
// window outgrows it. With no explicit limit we page until an empty page
// comes back, advancing by what each page actually returned — that stays
// correct whatever the server's cap is configured to.
const PAGE_SIZE = 1000;

export async function fetchSessionRows(filters: SessionRowFilters = {}): Promise<RowsResult> {
  const call = (limit: number | null, offset: number | null) =>
    supabase!.rpc("tiered_session_rows", {
      p_mode:         filters.mode ?? null,
      p_range_days:   filters.rangeDays ?? null,
      p_athlete_ids:  filters.athleteIds ?? null,
      p_core_team_id: filters.coreTeamId ?? null,
      p_limit:        limit,
      p_offset:       offset,
    });

  if (filters.limit != null) {
    const { data, error } = await call(filters.limit, filters.offset ?? null);
    return { data: (data as SessionRow[] | null) ?? null, error };
  }

  const rows: SessionRow[] = [];
  let offset = filters.offset ?? 0;
  for (;;) {
    const { data, error } = await call(PAGE_SIZE, offset);
    if (error) return { data: null, error };
    const page = (data as SessionRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    offset += page.length;
  }
  return { data: rows, error: null };
}

export const LEADERBOARD_MODES = ["power", "reaction", "accuracy", "volume", "target"] as const;
export type LeaderboardMode = (typeof LEADERBOARD_MODES)[number];

// One call for every leaderboard mode, split client-side. Each entry has the
// same { data, error } shape the old per-mode calls returned, so callers can
// keep their per-mode aggregation unchanged. A mode the tier has not unlocked
// is filtered out server-side and comes back as an empty array, as before.
export async function fetchLeaderboardRowsByMode(
  rangeDays: number | null,
): Promise<Record<LeaderboardMode, RowsResult>> {
  const { data, error } = await fetchSessionRows({ rangeDays });
  const byMode = {} as Record<LeaderboardMode, RowsResult>;
  for (const mode of LEADERBOARD_MODES) {
    byMode[mode] = {
      data: error ? null : (data ?? []).filter(r => r.mode === mode),
      error,
    };
  }
  return byMode;
}

type TeamRef = { id: string; team_type?: string | null };

// One call for every team, bucketed client-side. A core team gets the rows
// with its core_team_id; a sub-team gets the rows for athletes on its roster.
// That is exactly what the old per-team p_core_team_id / p_athlete_ids calls
// returned, since both only ever narrowed the same tier-scoped result.
// A sub-team with an empty roster is left out of the map, matching the old
// `continue` before the call.
export async function fetchSessionRowsByTeam(
  teams: TeamRef[],
  subTeamMembers: Map<string, string[]>,
  filters: { mode?: string | null; rangeDays?: number | null },
): Promise<Map<string, SessionRow[]>> {
  const result = new Map<string, SessionRow[]>();
  const hasCoreTeam = teams.some(t => t.team_type === "core");

  // Without a core team in the list, the rosters are the whole scope, so
  // narrow the read to them instead of pulling the program's full window.
  let athleteIds: string[] | null = null;
  if (!hasCoreTeam) {
    athleteIds = Array.from(new Set(teams.flatMap(t => subTeamMembers.get(t.id) ?? [])));
    if (athleteIds.length === 0) return result;
  }

  const { data } = await fetchSessionRows({ ...filters, athleteIds });
  const rows = data ?? [];

  for (const team of teams) {
    if (team.team_type === "core") {
      result.set(team.id, rows.filter(r => r.core_team_id === team.id));
    } else {
      const roster = subTeamMembers.get(team.id) ?? [];
      if (roster.length === 0) continue;
      const members = new Set(roster);
      result.set(team.id, rows.filter(r => r.athlete_id != null && members.has(r.athlete_id)));
    }
  }
  return result;
}
