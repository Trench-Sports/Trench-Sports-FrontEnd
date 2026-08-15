// src/lib/entitlements.ts
//
// The single place the UI asks what a program is entitled to.
// Implements docs/Trench_Sports_Three_Tier_Plan.docx §8.3.
//
// WHAT THIS FILE IS — AND IS NOT
// This is the PRESENTATION half of entitlements: it decides which panels
// render, which render locked, and what the upgrade copy says. It is NOT the
// security boundary. The client authenticates with the Supabase anon key, so
// anything this file "hides" is still one devtools query away unless the
// database withholds it.
//
// supabase/entitlements.sql is the real gate. It revokes column-level SELECT
// on every gated field and re-serves reads through tier-checked RPCs, so a
// Tier I program that patched this file to return tier "III" would render
// every unlocked panel — and every one of them would be empty, because the
// rows never leave the database.
//
// Tier vocabulary matches what programs.plan actually stores (see
// supabase/admin_set_program_plan.sql): trial / I / II / III. `trial` resolves
// to Tier III while live and to "none" once it lapses; that resolution happens
// server-side in program_tier() and arrives here already applied.
//
// HARD RULE (§8.3): no component may test plan === "II" directly. Components
// ask capability questions — can("fatigueTracker"), modes(), historyDays() —
// so a tier boundary moves in this file alone rather than across a 7,600-line
// dashboard.

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { SessionMode } from "./sessionModes";

// ── Tiers ────────────────────────────────────────────────────────────────────
// "none" is a lapsed trial or a suspended program: everything locks. Their
// captured data is retained, not deleted — paying restores full history.
export type Tier = "none" | "I" | "II" | "III";

export const TIER_ORDER: Tier[] = ["none", "I", "II", "III"];
export const TIER_LABEL: Record<Tier, string> = {
  none: "Inactive",
  I: "Tier I",
  II: "Tier II",
  III: "Tier III",
};
export const TIER_NAME: Record<Tier, string> = {
  none: "Inactive",
  I: "Foundation",
  II: "Analysis",
  III: "Intelligence",
};

export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

// ── Capabilities ─────────────────────────────────────────────────────────────
// Boolean features are what can() answers. The three graded features
// (leaderboards, athleteAnalysis) are read directly off the resolved set.

export type BoolFeature =
  | "mostImproved"
  | "teamComparison"
  | "multiTeamRollup"
  | "strikeCompass"
  | "angleDrift"
  | "csvExport"
  | "rawExport"
  | "fatigueTracker"
  | "aiAnalysis"
  | "advancedDashboard"
  | "distributions"
  | "apiAccess";

export type LeaderboardDepth = "none" | "single" | "full" | "trendWeighted";
export type AthleteAnalysisDepth = "none" | "profileOnly" | "full" | "longitudinal";

export type Limits = {
  maxAthletes: number | null;
  maxCoaches: number | null;
  maxDevices: number | null;
  maxSessionsPerMonth: number | null;
  maxTeams: number | null;
};

export type Features = Record<BoolFeature, boolean> & {
  leaderboards: LeaderboardDepth;
  athleteAnalysis: AthleteAnalysisDepth;
};

export type TierDefinition = {
  modes: SessionMode[];
  /** null = unlimited. Days of session history the tier may read. */
  historyDays: number | null;
  features: Features;
  limits: Limits;
};

// Mirrors tier_features() / tier_modes() / tier_history_days() / tier_limits()
// in supabase/entitlements.sql. If you change a boundary, change it in BOTH —
// the SQL copy is the one that actually withholds data.
export const TIER_FEATURES: Record<Tier, TierDefinition> = {
  none: {
    modes: [],
    historyDays: 0,
    features: {
      leaderboards: "none",
      athleteAnalysis: "none",
      mostImproved: false,
      teamComparison: false,
      multiTeamRollup: false,
      strikeCompass: false,
      angleDrift: false,
      csvExport: false,
      rawExport: false,
      fatigueTracker: false,
      aiAnalysis: false,
      advancedDashboard: false,
      distributions: false,
      apiAccess: false,
    },
    limits: { maxAthletes: 0, maxCoaches: 0, maxDevices: 0, maxSessionsPerMonth: 0, maxTeams: 0 },
  },

  // Foundation — descriptive. What happened. One mode, one athlete.
  I: {
    modes: ["power"],
    historyDays: 30,
    features: {
      leaderboards: "single",
      athleteAnalysis: "profileOnly",
      mostImproved: false,
      teamComparison: false,
      multiTeamRollup: false,
      strikeCompass: false,
      angleDrift: false,
      csvExport: false,
      rawExport: false,
      fatigueTracker: false,
      aiAnalysis: false,
      advancedDashboard: false,
      distributions: false,
      apiAccess: false,
    },
    // Coach cap is 2, not the 1 in the doc's §9 table — see the note on
    // tier_limits() in supabase/entitlements.sql. The public /dummy demo
    // already promises 2.
    limits: { maxAthletes: 50, maxCoaches: 2, maxDevices: 1, maxSessionsPerMonth: 50, maxTeams: 1 },
  },

  // Analysis — comparative. How it compares. Roster and team context.
  II: {
    modes: ["power", "accuracy", "reaction"],
    historyDays: 90,
    features: {
      leaderboards: "full",
      athleteAnalysis: "full",
      mostImproved: true,
      teamComparison: true,
      multiTeamRollup: false,
      strikeCompass: true,
      angleDrift: false,
      csvExport: true,
      rawExport: false,
      fatigueTracker: false,
      aiAnalysis: false,
      advancedDashboard: false,
      distributions: false,
      apiAccess: false,
    },
    // Coach cap is 8, not the 5 in the doc's §9 table — same reason as Tier I.
    limits: { maxAthletes: 150, maxCoaches: 8, maxDevices: 3, maxSessionsPerMonth: 500, maxTeams: 4 },
  },

  // Intelligence — prescriptive. What to do about it. Trends and cues.
  III: {
    modes: ["power", "accuracy", "reaction", "volume", "target"],
    historyDays: null,
    features: {
      leaderboards: "trendWeighted",
      athleteAnalysis: "longitudinal",
      mostImproved: true,
      teamComparison: true,
      multiTeamRollup: true,
      strikeCompass: true,
      angleDrift: true,
      csvExport: true,
      rawExport: true,
      fatigueTracker: true,
      aiAnalysis: true,
      advancedDashboard: true,
      distributions: true,
      apiAccess: true,
    },
    limits: { maxAthletes: null, maxCoaches: null, maxDevices: null, maxSessionsPerMonth: null, maxTeams: null },
  },
};

// The lowest tier that grants each boolean feature. Drives the "Requires
// Tier II" copy on locked panels so the upgrade path is never guessed at.
export const FEATURE_MIN_TIER: Record<BoolFeature, Tier> = {
  mostImproved: "II",
  teamComparison: "II",
  strikeCompass: "II",
  csvExport: "II",
  multiTeamRollup: "III",
  angleDrift: "III",
  rawExport: "III",
  fatigueTracker: "III",
  aiAnalysis: "III",
  advancedDashboard: "III",
  distributions: "III",
  apiAccess: "III",
};

// One-line statement of what a locked feature would tell a coach about their
// own athletes (§8.5 — "invisible features cannot be upsold"). Shown on the
// preview state alongside the sample data.
export const FEATURE_PITCH: Record<BoolFeature, string> = {
  mostImproved:
    "Ranks change rather than level, so the athlete quietly improving fastest stops going unnoticed.",
  teamComparison:
    "Puts every team in your program side by side, and each athlete against their team's mean.",
  strikeCompass:
    "Reconstructs the incoming angle of every strike in 3D — something you cannot see from the sideline.",
  csvExport:
    "Pulls the same numbers you see here into a spreadsheet, scoped to your current filters.",
  multiTeamRollup:
    "Rolls every team in the program into one view instead of one team at a time.",
  angleDrift:
    "Flags directional skew over time — for example an athlete consistently crossing the centre line.",
  rawExport:
    "Exports the full per-strike and per-cell stream to build your own analysis pipeline on.",
  fatigueTracker:
    "Regresses Strength Index across each session's windows to show who is fading, and when.",
  aiAnalysis:
    "Turns your session data into prioritised coaching cues — a prescription, not a restatement.",
  advancedDashboard:
    "Unlimited history, all-time trend charts, custom ranges and saved views.",
  distributions:
    "Shows the full spread of force and impulse rather than just the average.",
  apiAccess:
    "Read your program's data programmatically, with per-program keys and a session-complete webhook.",
};

// ── Resolved entitlement set ─────────────────────────────────────────────────

export type Entitlements = {
  loading: boolean;
  /** Effective tier, already resolved server-side for trial expiry + suspension. */
  tier: Tier;
  /** The stored plan string, for display only. Never branch on this. */
  plan: string;
  status: string;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  isGrandfathered: boolean;
  /** True while a live trial is showing the Tier III ceiling. */
  isTrial: boolean;
  /** Days until the trial lapses, or null when not on trial. */
  trialDaysLeft: number | null;
  /** True when the program has lapsed or been suspended — everything locks. */
  isLapsed: boolean;

  /** Capability questions. Components use these, never the tier string. */
  can: (feature: BoolFeature) => boolean;
  modes: () => SessionMode[];
  modeAllowed: (mode: string) => boolean;
  historyDays: () => number | null;
  limit: (key: keyof Limits) => number | null;
  /** Lowest tier that grants a feature — for "Requires Tier II" copy. */
  requiredTier: (feature: BoolFeature) => Tier;
  leaderboards: LeaderboardDepth;
  athleteAnalysis: AthleteAnalysisDepth;
};

// Assumed while the RPC is in flight. Deliberately the LOCKED set: a slow
// network must never flash paid features open, and a failed lookup must fail
// closed rather than fall back to something generous.
const LOCKED: Features = TIER_FEATURES.none.features;

function coerceTier(raw: unknown): Tier {
  return raw === "I" || raw === "II" || raw === "III" ? raw : "none";
}

// Shared in-flight request. The dashboard mounts several consumers at once —
// the page itself plus the export and import-roster modals, which stay mounted
// while closed — and each would otherwise fire its own identical
// my_entitlements() call on load. A program's tier does not change mid-page, so
// one request per page load is enough.
//
// Only successful responses are cached: a failure must be retryable, not
// remembered, or one bad round trip would pin the whole page to the locked set.
let entitlementsPromise: Promise<any> | null = null;

function fetchEntitlements(): Promise<any> {
  if (entitlementsPromise) return entitlementsPromise;

  // Wrapped in an async IIFE rather than chained: supabase-js returns a
  // thenable builder, not a real Promise, so it has no .catch().
  const p = (async () => {
    try {
      const { data, error } = await supabase!.rpc("my_entitlements");
      if (error) throw error;
      return data;
    } catch (err) {
      entitlementsPromise = null;   // keep failures retryable
      throw err;
    }
  })();

  entitlementsPromise = p;
  return p;
}

/**
 * Discard the cached entitlement lookup so the next mount re-reads it.
 *
 * Nothing in the app changes the CURRENT user's own plan today — the admin tier
 * switcher edits other programs, so a coach whose plan changes picks it up on
 * their next page load, not live. This exists for whenever in-session plan
 * changes do arrive (self-serve billing), so the cache is not a hidden reason
 * the new tier fails to appear.
 */
export function invalidateEntitlements(): void {
  entitlementsPromise = null;
}

/**
 * Resolves the current program's entitlements.
 *
 * Calls my_entitlements(), which does the resolution in SQL — tier defaults
 * deep-merged with the program's plan_features overrides. Doing it server-side
 * keeps one copy of the trial-expiry and override logic, and means the values
 * the UI renders are the same ones the read RPCs enforce with.
 */
export function useEntitlements(): Entitlements {
  const [tier, setTier] = useState<Tier>("none");
  const [features, setFeatures] = useState<Features>(LOCKED);
  const [limits, setLimits] = useState<Limits>(TIER_FEATURES.none.limits);
  const [modeList, setModeList] = useState<SessionMode[]>([]);
  const [history, setHistory] = useState<number | null>(0);
  const [meta, setMeta] = useState({
    plan: "",
    status: "",
    trialEndsAt: null as string | null,
    graceEndsAt: null as string | null,
    isGrandfathered: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      let data: any;
      try {
        data = await fetchEntitlements();
      } catch (err: any) {
        // Fail closed. A program that cannot prove its tier gets none.
        if (!cancelled) {
          console.error("[entitlements] my_entitlements failed:", err?.message);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;

      if (!data) {
        setLoading(false);
        return;
      }

      const d = data as any;
      const resolved = coerceTier(d.tier);
      const defaults = TIER_FEATURES[resolved];

      setTier(resolved);
      // Server sends tier defaults already merged with plan_features. Layer
      // the local defaults underneath so a feature added to this file before
      // the SQL catches up resolves to its locked value rather than undefined.
      setFeatures({ ...defaults.features, ...(d.features ?? {}) });
      setLimits({ ...defaults.limits, ...(d.limits ?? {}) });
      setModeList(Array.isArray(d.modes) ? (d.modes as SessionMode[]) : defaults.modes);
      setHistory(d.historyDays === undefined ? defaults.historyDays : d.historyDays);
      setMeta({
        plan: d.plan ?? "",
        status: d.status ?? "",
        trialEndsAt: d.trialEndsAt ?? null,
        graceEndsAt: d.graceEndsAt ?? null,
        isGrandfathered: Boolean(d.isGrandfathered),
      });
      setLoading(false);

      // On an upgrade, release any sessions the outbox parked because they hit
      // a plan limit. Without this they would sit on the device until the
      // parked-retry window elapsed, which is a poor first impression of a plan
      // the customer just paid for. Best-effort: this drives a background
      // upload, never the UI.
      try {
        const seenKey = "ts_last_seen_tier";
        const previous = localStorage.getItem(seenKey) as Tier | null;
        if (previous && tierRank(resolved) > tierRank(previous)) {
          const { unparkAll } = await import("../storage/sessionOutbox");
          const released = await unparkAll();
          if (released > 0) {
            console.info(`[entitlements] upgrade ${previous}→${resolved}: released ${released} parked session(s)`);
          }
        }
        localStorage.setItem(seenKey, resolved);
      } catch {
        /* localStorage or IndexedDB unavailable — nothing here is load-bearing */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isTrial = meta.plan === "trial" && tier === "III";
  const lapseAt = meta.graceEndsAt ?? meta.trialEndsAt;
  const trialDaysLeft =
    isTrial && lapseAt
      ? Math.max(0, Math.ceil((new Date(lapseAt).getTime() - Date.now()) / 86_400_000))
      : null;

  return {
    loading,
    tier,
    plan: meta.plan,
    status: meta.status,
    trialEndsAt: meta.trialEndsAt,
    graceEndsAt: meta.graceEndsAt,
    isGrandfathered: meta.isGrandfathered,
    isTrial,
    trialDaysLeft,
    isLapsed: !loading && tier === "none",

    can: (feature) => Boolean(features[feature]),
    modes: () => modeList,
    modeAllowed: (mode) => modeList.includes(mode?.toLowerCase() as SessionMode),
    historyDays: () => history,
    limit: (key) => limits[key],
    requiredTier: (feature) => FEATURE_MIN_TIER[feature],
    leaderboards: features.leaderboards,
    athleteAnalysis: features.athleteAnalysis,
  };
}

// ── Retained-but-locked data ─────────────────────────────────────────────────
// The adapters capture the full sensor substrate on every plan, and nothing is
// ever pruned by tier — the gates are read filters, not deletions. So a program
// accumulates real training data it cannot currently see: sessions in modes it
// has not unlocked, and sessions older than its history window.
//
// This hook reports how much. It matters for two reasons: it is the honest
// answer to "did we lose our data?" (no), and it is a far better upgrade prompt
// than sample rows, because the numbers are the customer's own training.

export type RetainedData = {
  loading: boolean;
  /** Per-mode counts for modes the tier does not include. */
  lockedModes: { mode: string; sessions: number; strikes: number }[];
  /** Total sessions sitting in locked modes. */
  lockedModeSessions: number;
  /** Sessions in an unlocked mode but older than the history window. */
  lockedByHistory: number;
  /** Oldest session on record for this program, ignoring the window. */
  oldestSession: string | null;
  totalSessions: number;
  /** True when there is anything at all an upgrade would reveal. */
  hasLockedData: boolean;
};

export function useRetainedData(): RetainedData {
  const [state, setState] = useState<RetainedData>({
    loading: true,
    lockedModes: [],
    lockedModeSessions: 0,
    lockedByHistory: 0,
    oldestSession: null,
    totalSessions: 0,
    hasLockedData: false,
  });

  useEffect(() => {
    if (!supabase) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase!.rpc("my_locked_data_summary");
      if (cancelled) return;

      if (error || !data) {
        // Non-fatal: this drives an upsell strip, not access to anything.
        setState((s) => ({ ...s, loading: false }));
        return;
      }

      const d = data as any;
      const lockedModes = Array.isArray(d.lockedModes) ? d.lockedModes : [];
      const lockedModeSessions = Number(d.lockedModeSessions ?? 0);
      const lockedByHistory = Number(d.lockedByHistory ?? 0);

      setState({
        loading: false,
        lockedModes,
        lockedModeSessions,
        lockedByHistory,
        oldestSession: d.oldestSession ?? null,
        totalSessions: Number(d.totalSessions ?? 0),
        hasLockedData: lockedModeSessions > 0 || lockedByHistory > 0,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
