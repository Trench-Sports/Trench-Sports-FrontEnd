// src/pages/dummy.tsx
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC INTERACTIVE DEMO — /dummy
//
// A fully-populated example dashboard for a fictional football program
// ("Northgate Griffins Football"), driven entirely by hardcoded sample data.
// There is no Supabase, no auth, and NO add / edit / delete — everything is
// read-only so anyone can explore it on a public route.
//
// The page reuses the real dashboard's design system (see demoDashboardStyles.ts,
// extracted verbatim from dashboard.tsx) plus the shared StrikeCompass and
// StrengthIndexInfo components, so it looks and behaves like the shipping product.
//
// The headline feature is the THREE-TIER TOGGLE. Switching between
// Foundation (I) · Analysis (II) · Intelligence (III) changes:
//   • which of the 5 impact modes are unlocked,
//   • which cards / features are shown vs. locked-with-an-upgrade-affordance,
//   • the program limits summary,
// mirroring the entitlement model in docs/Trench_Sports_Three_Tier_Plan.docx.
// Locked features stay visible (blurred sample data + upgrade chip) rather than
// disappearing — per section 8.5 of that plan.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StrikeCompass from "../components/strikeCompass";
import StrengthIndexInfo from "../components/strengthIndexInfo";
import { DASHBOARD_CSS, DEMO_EXTRA_CSS } from "./demoDashboardStyles";

// ─────────────────────────────────────────────────────────────────────────────
// Tiers & entitlement model
// ─────────────────────────────────────────────────────────────────────────────
type TierNum = 1 | 2 | 3;

type Feature =
  | "standardLeaderboard"
  | "leaderboardSuite"
  | "mostImproved"
  | "teamComparison"
  | "athleteProfile"
  | "athleteAxisBreakdown"
  | "athleteLongitudinal"
  | "strikeCompass"
  | "csvExport"
  | "rawExport"
  | "fatigueTracker"
  | "aiInsights"
  | "apiAccess"
  | "advancedDashboard";

// Minimum tier that unlocks each feature. Cumulative — a Tier III program has
// everything a Tier II program has, and so on.
const FEATURE_MIN_TIER: Record<Feature, TierNum> = {
  standardLeaderboard: 1,
  athleteProfile: 1,
  leaderboardSuite: 2,
  mostImproved: 2,
  teamComparison: 2,
  athleteAxisBreakdown: 2,
  strikeCompass: 2,
  csvExport: 2,
  athleteLongitudinal: 3,
  rawExport: 3,
  fatigueTracker: 3,
  aiInsights: 3,
  apiAccess: 3,
  advancedDashboard: 3,
};

type ModeKey = "power" | "accuracy" | "reaction" | "volume" | "target";

type ModeDef = {
  key: ModeKey;
  label: string;
  icon: string;
  accent: string;
  glow: string;
  minTier: TierNum;
  pill: string;
  desc: string;
};

const MODES: ModeDef[] = [
  { key: "power",    label: "Power",    icon: "💥", accent: "#b400ff", glow: "rgba(180,0,255,0.55)", minTier: 1, pill: "ts-modePill--power",    desc: "Strike any zone — force & placement, no cue" },
  { key: "accuracy", label: "Accuracy", icon: "🎯", accent: "#00dcff", glow: "rgba(0,220,255,0.55)", minTier: 2, pill: "ts-modePill--accuracy", desc: "Each strike scored by distance from the bullseye" },
  { key: "reaction", label: "Reaction", icon: "⚡️", accent: "#ffcc00", glow: "rgba(255,200,0,0.55)", minTier: 2, pill: "ts-modePill--reaction", desc: "Cue-to-impact latency — readiness & decision speed" },
  { key: "volume",   label: "Volume",   icon: "🥊", accent: "#ff6a00", glow: "rgba(255,106,0,0.55)", minTier: 3, pill: "ts-modePill--volume",   desc: "Max strikes in a 5-second window — feeds fatigue" },
  { key: "target",   label: "Target",   icon: "🏹", accent: "#00ff88", glow: "rgba(0,255,136,0.55)", minTier: 3, pill: "ts-modePill--target",   desc: "Zone cue: reaction time and accuracy at once" },
];

const MODE_BY_KEY: Record<ModeKey, ModeDef> = MODES.reduce((acc, m) => {
  acc[m.key] = m;
  return acc;
}, {} as Record<ModeKey, ModeDef>);

type TierMeta = {
  n: TierNum;
  name: string;
  label: string;
  tagline: string;
  insight: string;
  question: string;
  blurb: string;
  highlights: string[];
  limits: { athletes: string; coaches: string; devices: string; sessions: string; teams: string; history: string };
};

const TIERS: TierMeta[] = [
  {
    n: 1,
    name: "Foundation",
    label: "Tier I",
    tagline: "Capture & record",
    insight: "Descriptive",
    question: "What happened.",
    blurb: "One mode, one athlete at a time. Real-time capture, per-session facts, and a single-mode leaderboard. The honest floor of what the hardware can tell you.",
    highlights: [
      "Power mode capture",
      "Live contact grid + Strength Index",
      "Session summaries & heatmaps",
      "Standard Power leaderboard",
      "Athlete profile & session history",
    ],
    limits: { athletes: "50", coaches: "2", devices: "1", sessions: "50 / mo", teams: "1", history: "30 days" },
  },
  {
    n: 2,
    name: "Analysis",
    label: "Tier II",
    tagline: "Compare & diagnose",
    insight: "Comparative",
    question: "How it compares.",
    blurb: "Everything in Foundation, plus two more modes and the comparative layer — the full leaderboard suite, team comparison, the 3D Strike Compass, and CSV export.",
    highlights: [
      "+ Accuracy & Reaction modes",
      "Full leaderboard suite + Most Improved",
      "Team & multi-team comparison",
      "Per-axis athlete analysis",
      "3D Strike Compass angle analysis",
      "Session-summary CSV export",
    ],
    limits: { athletes: "150", coaches: "8", devices: "3", sessions: "500 / mo", teams: "4", history: "90 days" },
  },
  {
    n: 3,
    name: "Intelligence",
    label: "Tier III",
    tagline: "Predict & prescribe",
    insight: "Prescriptive",
    question: "What to do about it.",
    blurb: "The full five-mode set plus the derived layer — a fatigue tracker, automated coaching intelligence, the advanced dashboard with raw export, and per-program API access.",
    highlights: [
      "All 5 modes (+ Volume, Target)",
      "Fatigue tracker & longitudinal curves",
      "Automated coaching intelligence",
      "Advanced dashboard & raw NDJSON export",
      "Per-program API access & webhooks",
    ],
    limits: { athletes: "Unlimited", coaches: "Unlimited", devices: "Unlimited", sessions: "Unlimited", teams: "Unlimited", history: "Unlimited" },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic sample data — Northgate Griffins Football
// ─────────────────────────────────────────────────────────────────────────────
// Base athlete profile (hand-authored / generated). The season history, unit,
// position group and injury status are derived on top of this — see Athlete.
type AthleteBase = {
  id: string;
  first: string;
  last: string;
  pos: string;
  team: "Varsity" | "JV";
  power: { peak: number; avg: number; sessions: number; delta: number };     // Strength Index 0–1000, delta = % trend
  reaction: { avg: number; best: number; attempts: number; delta: number };  // ms (lower better)
  accuracy: { pct: number; offset: number; sessions: number; delta: number };// %, offset cm
  volume: { avgWindowHits: number; avgSi: number; sessions: number; slope: number }; // slope = SI lost / window
  target: { accPct: number; rtCorrect: number; attempts: number };
  analysis: { consistency: number; cadenceHz: number; avgAngle: number; strengthTrend: number[]; fatigueNote: string; reactionDeltaMs: number };
  seed: number;
};

type Unit = "Offense" | "Defense" | "Special Teams";

type InjuryStatus = "Out" | "Questionable" | "Day-to-day" | "Cleared";
type Injury = {
  status: InjuryStatus;
  area: string;      // body part
  note: string;      // short clinical note
  sinceWeek: number; // season week the issue began
  gamesMissed: number;
};

// One week of a season. `sessions === 0` marks a week missed to injury.
type SeasonPoint = {
  week: number;
  si: number;         // avg Strength Index that week (0 if missed)
  force: number;      // avg peak force N
  sessions: number;
  note?: "PR" | "Slump" | "Injury" | "Return";
};

// The full athlete used everywhere in the UI: profile + derived season history,
// team unit / position group, and (for some) an injury record.
type Athlete = AthleteBase & {
  unit: Unit;
  group: string;          // position group, e.g. "Receivers"
  injury: Injury | null;
  season: SeasonPoint[];
};

// The "featured" core — hand-tuned so the leaderboards, team comparisons,
// fatigue alerts and coaching-insight cards tell a coherent story. The full
// 50-man roster is these plus generated depth players (see below).
const FEATURED_ATHLETES: AthleteBase[] = [
  { id: "a01", first: "Marcus",  last: "Ellison",  pos: "RB",  team: "Varsity",
    power: { peak: 872, avg: 741, sessions: 14, delta: +6 }, reaction: { avg: 318, best: 271, attempts: 96, delta: -4 },
    accuracy: { pct: 88, offset: 3.1, sessions: 9, delta: +5 }, volume: { avgWindowHits: 41, avgSi: 690, sessions: 7, slope: -4.2 },
    target: { accPct: 84, rtCorrect: 402, attempts: 60 },
    analysis: { consistency: 85, cadenceHz: 3.4, avgAngle: 12, strengthTrend: [688, 705, 712, 730, 741, 758, 741], fatigueNote: "trending up", reactionDeltaMs: 58 }, seed: 101 },
  { id: "a02", first: "Devon",   last: "Carter",   pos: "WR",  team: "Varsity",
    power: { peak: 811, avg: 703, sessions: 12, delta: +3 }, reaction: { avg: 289, best: 244, attempts: 110, delta: -7 },
    accuracy: { pct: 91, offset: 2.4, sessions: 11, delta: +8 }, volume: { avgWindowHits: 38, avgSi: 662, sessions: 6, slope: -5.1 },
    target: { accPct: 89, rtCorrect: 368, attempts: 72 },
    analysis: { consistency: 82, cadenceHz: 3.9, avgAngle: -8, strengthTrend: [672, 681, 690, 695, 703, 699, 703], fatigueNote: "stable", reactionDeltaMs: 71 }, seed: 202 },
  { id: "a03", first: "Tyrell",  last: "Boone",    pos: "DL",  team: "Varsity",
    power: { peak: 941, avg: 812, sessions: 15, delta: +9 }, reaction: { avg: 372, best: 331, attempts: 74, delta: -2 },
    accuracy: { pct: 79, offset: 4.6, sessions: 7, delta: +2 }, volume: { avgWindowHits: 45, avgSi: 748, sessions: 8, slope: -1.4 },
    target: { accPct: 76, rtCorrect: 448, attempts: 51 },
    analysis: { consistency: 88, cadenceHz: 3.1, avgAngle: 21, strengthTrend: [742, 768, 781, 795, 804, 812, 812], fatigueNote: "trending up", reactionDeltaMs: 33 }, seed: 303 },
  { id: "a04", first: "Jalen",   last: "Whitfield",pos: "LB",  team: "Varsity",
    power: { peak: 806, avg: 728, sessions: 13, delta: +1 }, reaction: { avg: 341, best: 298, attempts: 88, delta: -5 },
    accuracy: { pct: 83, offset: 3.7, sessions: 8, delta: -3 }, volume: { avgWindowHits: 39, avgSi: 671, sessions: 7, slope: -3.6 },
    target: { accPct: 80, rtCorrect: 421, attempts: 63 },
    analysis: { consistency: 76, cadenceHz: 3.3, avgAngle: 6, strengthTrend: [724, 731, 719, 728, 735, 722, 728], fatigueNote: "stable", reactionDeltaMs: 62 }, seed: 404 },
  { id: "a05", first: "Andre",   last: "Solis",    pos: "CB",  team: "Varsity",
    power: { peak: 742, avg: 651, sessions: 11, delta: +4 }, reaction: { avg: 264, best: 231, attempts: 124, delta: -9 },
    accuracy: { pct: 86, offset: 2.9, sessions: 10, delta: +6 }, volume: { avgWindowHits: 36, avgSi: 612, sessions: 5, slope: -2.1 },
    target: { accPct: 87, rtCorrect: 344, attempts: 78 },
    analysis: { consistency: 80, cadenceHz: 4.1, avgAngle: -14, strengthTrend: [628, 636, 644, 651, 658, 651, 651], fatigueNote: "stable", reactionDeltaMs: 44 }, seed: 505 },
  { id: "a06", first: "Cole",    last: "Ramsey",   pos: "QB",  team: "Varsity",
    power: { peak: 698, avg: 612, sessions: 10, delta: +2 }, reaction: { avg: 251, best: 214, attempts: 132, delta: -6 },
    accuracy: { pct: 93, offset: 2.0, sessions: 12, delta: +4 }, volume: { avgWindowHits: 33, avgSi: 588, sessions: 4, slope: -1.0 },
    target: { accPct: 92, rtCorrect: 322, attempts: 84 },
    analysis: { consistency: 90, cadenceHz: 3.6, avgAngle: 2, strengthTrend: [600, 604, 608, 610, 612, 615, 612], fatigueNote: "stable", reactionDeltaMs: 28 }, seed: 606 },
  { id: "a07", first: "Xavier",  last: "Nunez",    pos: "TE",  team: "Varsity",
    power: { peak: 833, avg: 719, sessions: 12, delta: +5 }, reaction: { avg: 355, best: 312, attempts: 70, delta: -1 },
    accuracy: { pct: 81, offset: 4.1, sessions: 6, delta: +1 }, volume: { avgWindowHits: 40, avgSi: 655, sessions: 6, slope: -6.8 },
    target: { accPct: 78, rtCorrect: 436, attempts: 48 },
    analysis: { consistency: 71, cadenceHz: 3.0, avgAngle: 17, strengthTrend: [700, 710, 718, 725, 731, 719, 719], fatigueNote: "trending down", reactionDeltaMs: 96 }, seed: 707 },
  { id: "a08", first: "Isaiah",  last: "Fields",   pos: "S",   team: "Varsity",
    power: { peak: 769, avg: 668, sessions: 11, delta: -2 }, reaction: { avg: 298, best: 259, attempts: 102, delta: -3 },
    accuracy: { pct: 84, offset: 3.4, sessions: 9, delta: +2 }, volume: { avgWindowHits: 37, avgSi: 634, sessions: 5, slope: -3.0 },
    target: { accPct: 83, rtCorrect: 388, attempts: 66 },
    analysis: { consistency: 78, cadenceHz: 3.7, avgAngle: -5, strengthTrend: [676, 672, 668, 664, 668, 665, 668], fatigueNote: "stable", reactionDeltaMs: 51 }, seed: 808 },
  { id: "a09", first: "Brayden", last: "Cho",      pos: "WR",  team: "JV",
    power: { peak: 641, avg: 559, sessions: 8, delta: +7 }, reaction: { avg: 302, best: 268, attempts: 80, delta: -8 },
    accuracy: { pct: 82, offset: 3.6, sessions: 7, delta: +9 }, volume: { avgWindowHits: 31, avgSi: 540, sessions: 3, slope: -2.4 },
    target: { accPct: 79, rtCorrect: 398, attempts: 42 },
    analysis: { consistency: 74, cadenceHz: 3.8, avgAngle: -11, strengthTrend: [512, 528, 540, 549, 559, 555, 559], fatigueNote: "trending up", reactionDeltaMs: 47 }, seed: 909 },
  { id: "a10", first: "Mateo",   last: "Guerra",   pos: "RB",  team: "JV",
    power: { peak: 688, avg: 601, sessions: 9, delta: +11 }, reaction: { avg: 334, best: 289, attempts: 66, delta: -4 },
    accuracy: { pct: 77, offset: 4.9, sessions: 5, delta: +3 }, volume: { avgWindowHits: 34, avgSi: 566, sessions: 4, slope: -4.9 },
    target: { accPct: 74, rtCorrect: 452, attempts: 36 },
    analysis: { consistency: 69, cadenceHz: 3.2, avgAngle: 9, strengthTrend: [540, 558, 572, 585, 601, 596, 601], fatigueNote: "trending up", reactionDeltaMs: 83 }, seed: 111 },
  { id: "a11", first: "Owen",    last: "Delgado",  pos: "LB",  team: "JV",
    power: { peak: 712, avg: 623, sessions: 9, delta: 0 }, reaction: { avg: 361, best: 320, attempts: 58, delta: -2 },
    accuracy: { pct: 76, offset: 5.1, sessions: 5, delta: -4 }, volume: { avgWindowHits: 35, avgSi: 578, sessions: 4, slope: -5.6 },
    target: { accPct: 72, rtCorrect: 466, attempts: 33 },
    analysis: { consistency: 66, cadenceHz: 2.9, avgAngle: 24, strengthTrend: [620, 628, 631, 626, 623, 618, 623], fatigueNote: "trending down", reactionDeltaMs: 104 }, seed: 121 },
  { id: "a12", first: "Nate",    last: "Okafor",   pos: "DL",  team: "JV",
    power: { peak: 803, avg: 689, sessions: 10, delta: +8 }, reaction: { avg: 389, best: 344, attempts: 52, delta: 0 },
    accuracy: { pct: 74, offset: 5.4, sessions: 4, delta: +1 }, volume: { avgWindowHits: 42, avgSi: 648, sessions: 5, slope: -7.5 },
    target: { accPct: 70, rtCorrect: 478, attempts: 30 },
    analysis: { consistency: 72, cadenceHz: 2.8, avgAngle: 19, strengthTrend: [630, 648, 662, 675, 689, 681, 689], fatigueNote: "trending down", reactionDeltaMs: 112 }, seed: 131 },
  { id: "a13", first: "Liam",    last: "Foster",   pos: "CB",  team: "JV",
    power: { peak: 624, avg: 548, sessions: 7, delta: +5 }, reaction: { avg: 277, best: 242, attempts: 90, delta: -6 },
    accuracy: { pct: 85, offset: 3.2, sessions: 8, delta: +7 }, volume: { avgWindowHits: 30, avgSi: 522, sessions: 3, slope: -1.8 },
    target: { accPct: 85, rtCorrect: 356, attempts: 45 },
    analysis: { consistency: 79, cadenceHz: 4.0, avgAngle: -9, strengthTrend: [520, 528, 536, 542, 548, 545, 548], fatigueNote: "stable", reactionDeltaMs: 39 }, seed: 141 },
  { id: "a14", first: "Gavin",   last: "Marsh",    pos: "S",   team: "JV",
    power: { peak: 659, avg: 574, sessions: 8, delta: +3 }, reaction: { avg: 313, best: 276, attempts: 76, delta: -5 },
    accuracy: { pct: 80, offset: 3.9, sessions: 6, delta: +2 }, volume: { avgWindowHits: 32, avgSi: 548, sessions: 3, slope: -3.3 },
    target: { accPct: 77, rtCorrect: 410, attempts: 39 },
    analysis: { consistency: 73, cadenceHz: 3.5, avgAngle: -3, strengthTrend: [556, 562, 568, 571, 574, 570, 574], fatigueNote: "stable", reactionDeltaMs: 55 }, seed: 151 },
];

// ── Depth roster — the rest of a realistic 50-man football team ───────────────
// Names, positions and team assignment are authored (a believable two-deep at
// every position); the stats are generated by genAthlete() from a per-player
// seed, so they're deterministic and internally consistent without hand-typing
// 36 more stat blocks. Position drives the profile (linemen hit hardest, DBs
// react fastest, etc.).
const DEPTH_ROSTER: [string, string, string, "Varsity" | "JV"][] = [
  ["Deshawn", "Willis",   "QB", "Varsity"],
  ["Ethan",   "Park",     "QB", "JV"],
  ["Malik",   "Turner",   "RB", "Varsity"],
  ["Rocco",   "Bianchi",  "RB", "JV"],
  ["Sam",     "Whitaker", "FB", "Varsity"],
  ["Trey",    "Dawson",   "WR", "Varsity"],
  ["Julian",  "Reyes",    "WR", "Varsity"],
  ["Amari",   "Douglas",  "WR", "Varsity"],
  ["Kofi",    "Mensah",   "WR", "JV"],
  ["Blake",   "Sullivan", "WR", "JV"],
  ["Grant",   "Holloway", "TE", "Varsity"],
  ["Diego",   "Salazar",  "TE", "JV"],
  ["Wyatt",   "Berg",     "OT", "Varsity"],
  ["Hank",    "Novak",    "OG", "Varsity"],
  ["Elias",   "Vance",    "C",  "Varsity"],
  ["Tomas",   "Ruiz",     "OT", "Varsity"],
  ["Colby",   "Stern",    "OG", "JV"],
  ["Preston", "Hale",     "OG", "JV"],
  ["Dominic", "Ferraro",  "OT", "JV"],
  ["Levi",    "Andersson","C",  "JV"],
  ["Rashad",  "Coleman",  "DE", "Varsity"],
  ["Viktor",  "Petrov",   "DT", "Varsity"],
  ["Malachi", "Grant",    "DT", "Varsity"],
  ["Terrence","Boyd",     "DE", "JV"],
  ["Ivan",    "Kowalski", "DT", "JV"],
  ["Caleb",   "Ferguson", "LB", "Varsity"],
  ["Darius",  "Pryor",    "LB", "Varsity"],
  ["Tanner",  "Wolfe",    "LB", "JV"],
  ["Jordan",  "Meeks",    "LB", "JV"],
  ["Elijah",  "Banks",    "CB", "Varsity"],
  ["Marquis", "Bell",     "CB", "Varsity"],
  ["Noah",    "Kim",      "CB", "JV"],
  ["Zane",    "Carroll",  "S",  "Varsity"],
  ["Dre",     "Washington","S", "JV"],
  ["Sebastian","Lang",    "K",  "Varsity"],
  ["Finn",    "O'Connor", "P",  "JV"],
];

// Position → relative skill (reaction/placement) and power tendencies.
const POS_SKILL: Record<string, number> = {
  QB: 0.85, RB: 0.80, FB: 0.55, WR: 0.88, TE: 0.62, OT: 0.42, OG: 0.42, C: 0.45,
  DE: 0.58, DT: 0.50, NT: 0.48, LB: 0.68, CB: 0.90, S: 0.80, K: 0.50, P: 0.50,
};
const POS_POWER: Record<string, number> = {
  QB: 0.55, RB: 0.75, FB: 0.85, WR: 0.58, TE: 0.80, OT: 0.96, OG: 0.95, C: 0.90,
  DE: 0.92, DT: 0.96, NT: 0.96, LB: 0.82, CB: 0.60, S: 0.68, K: 0.40, P: 0.42,
};

// Generate a full, internally-consistent Athlete from a seed. Uses mulberry32
// (a function declaration, hoisted below) so this can run at module load.
function genAthlete(i: number, first: string, last: string, pos: string, team: "Varsity" | "JV"): AthleteBase {
  const seed = 900 + i * 53;
  const rnd = mulberry32(seed);
  const cl = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  const skill = POS_SKILL[pos] ?? 0.6;
  const powf = POS_POWER[pos] ?? 0.7;
  const q = 0.45 + rnd() * 0.5; // overall quality

  const powAvg = Math.round(470 + powf * 300 + q * 80);
  const powDelta = Math.round((rnd() - 0.4) * 16);
  const reactAvg = Math.round(250 + (1 - skill) * 150 + (1 - q) * 35 + rnd() * 20);
  const reactionDeltaMs = Math.round(28 + (1 - q) * 95 + rnd() * 25);

  const trend: number[] = [];
  let b0 = powAvg - powDelta * 3;
  for (let k = 0; k < 7; k++) { b0 += powDelta * 0.6 + (rnd() - 0.5) * 12; trend.push(Math.round(b0)); }
  trend[6] = powAvg;

  return {
    id: `a${String(15 + i).padStart(2, "0")}`,
    first, last, pos, team,
    power: { peak: Math.round(powAvg + 55 + rnd() * 130), avg: powAvg, sessions: 5 + Math.floor(rnd() * 11), delta: powDelta },
    reaction: { avg: reactAvg, best: Math.round(reactAvg - (28 + rnd() * 45)), attempts: 45 + Math.floor(rnd() * 95), delta: -Math.round(rnd() * 9) },
    accuracy: { pct: Math.round(cl(70 + q * 20 + (skill - 0.6) * 10, 60, 97)), offset: Math.round((2 + (1 - q) * 4.2) * 10) / 10, sessions: 3 + Math.floor(rnd() * 9), delta: Math.round((rnd() - 0.4) * 14) },
    volume: { avgWindowHits: Math.round(28 + q * 20 + powf * 6), avgSi: Math.round(powAvg * 0.9 + rnd() * 50), sessions: 3 + Math.floor(rnd() * 6), slope: Math.round(-(1 + rnd() * 7) * 10) / 10 },
    target: { accPct: Math.round(cl(66 + q * 24 + (skill - 0.6) * 8, 60, 96)), rtCorrect: Math.round(reactAvg + 55 + rnd() * 70), attempts: 28 + Math.floor(rnd() * 55) },
    analysis: {
      consistency: Math.round(cl(58 + q * 36 + (rnd() - 0.5) * 8, 55, 96)),
      cadenceHz: Math.round((2.7 + rnd() * 1.7) * 10) / 10,
      avgAngle: Math.round((rnd() - 0.5) * 48),
      strengthTrend: trend,
      fatigueNote: powDelta >= 3 ? "trending up" : powDelta <= -2 ? "trending down" : "stable",
      reactionDeltaMs,
    },
    seed,
  };
}

// ── Team structure — squad, unit (Offense/Defense/ST) and position group ──────
const POS_UNIT: Record<string, Unit> = {
  QB: "Offense", RB: "Offense", FB: "Offense", WR: "Offense", TE: "Offense",
  OT: "Offense", OG: "Offense", C: "Offense",
  DE: "Defense", DT: "Defense", NT: "Defense", DL: "Defense", LB: "Defense", CB: "Defense", S: "Defense",
  K: "Special Teams", P: "Special Teams",
};
const POS_GROUP: Record<string, string> = {
  QB: "Quarterbacks", RB: "Running Backs", FB: "Running Backs", WR: "Receivers", TE: "Tight Ends",
  OT: "Offensive Line", OG: "Offensive Line", C: "Offensive Line",
  DE: "Defensive Line", DT: "Defensive Line", NT: "Defensive Line", DL: "Defensive Line",
  LB: "Linebackers", CB: "Defensive Backs", S: "Defensive Backs",
  K: "Specialists", P: "Specialists",
};

const SEASON_WEEKS = 16;

// Injury report — a spread across positions, squads and severities. `sinceWeek`
// keys into the 16-week season so the timeline shows the dip/gap where it began.
const INJURIES: Record<string, Injury> = {
  a07: { status: "Out",         area: "Hamstring",  note: "Grade 2 strain — re-evaluate in 2 weeks", sinceWeek: 12, gamesMissed: 2 },
  a11: { status: "Questionable",area: "Ankle",      note: "High ankle sprain, limited reps",         sinceWeek: 14, gamesMissed: 1 },
  a03: { status: "Cleared",     area: "Shoulder",   note: "Returned from AC joint sprain",           sinceWeek: 6,  gamesMissed: 1 },
  a20: { status: "Day-to-day",  area: "Wrist",      note: "Contusion, playing in a brace",           sinceWeek: 15, gamesMissed: 0 },
  a27: { status: "Out",         area: "Knee (MCL)", note: "MCL sprain — week-to-week",               sinceWeek: 13, gamesMissed: 3 },
  a34: { status: "Questionable",area: "Concussion", note: "In protocol, cleared contact pending",    sinceWeek: 15, gamesMissed: 1 },
  a45: { status: "Day-to-day",  area: "Hip flexor", note: "Tightness — managing load",               sinceWeek: 16, gamesMissed: 0 },
};

// Build a believable 16-week season: a gentle drift set by the athlete's trend,
// week-to-week noise, one personal-best spike, one slump, and — if injured — a
// dip and missed weeks around the injury week.
function makeSeason(a: AthleteBase, injury: Injury | null): SeasonPoint[] {
  const rnd = mulberry32(a.seed ^ 0x5ea50a);
  const base = a.power.avg;
  const drift = a.power.delta; // % over the whole season
  const prWeek = 3 + Math.floor(rnd() * 5);
  const slumpWeek = 9 + Math.floor(rnd() * 5);
  const out: SeasonPoint[] = [];
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    const trend = base * (1 + (drift / 100) * ((w - 1) / (SEASON_WEEKS - 1) - 0.3));
    let si = Math.round(trend + (rnd() - 0.5) * 55);
    let sessions = 2 + Math.floor(rnd() * 3);
    let note: SeasonPoint["note"] | undefined;

    if (w === prWeek) { si = Math.round(a.power.peak * (0.96 + rnd() * 0.04)); note = "PR"; }
    else if (w === slumpWeek) { si = Math.round(base * (0.80 - rnd() * 0.06)); note = "Slump"; }

    if (injury) {
      if (w === injury.sinceWeek) { note = "Injury"; si = Math.round(base * 0.7); sessions = 1; }
      else if (w > injury.sinceWeek && w <= injury.sinceWeek + injury.gamesMissed) { si = 0; sessions = 0; note = "Injury"; }
      else if (injury.status === "Cleared" && w === injury.sinceWeek + injury.gamesMissed + 1) { note = "Return"; si = Math.round(base * 0.9); }
    }
    out.push({ week: w, si: Math.max(0, si), force: Math.round(si * 3.4), sessions, note });
  }
  return out;
}

function deriveExtras(a: AthleteBase): Pick<Athlete, "unit" | "group" | "injury" | "season"> {
  const injury = INJURIES[a.id] ?? null;
  return {
    unit: POS_UNIT[a.pos] ?? "Offense",
    group: POS_GROUP[a.pos] ?? "Offense",
    injury,
    season: makeSeason(a, injury),
  };
}

// Full 50-man roster: featured core (14) + generated depth (36), each enriched
// with a season history, unit / position group and (for some) an injury.
const ROSTER: Athlete[] = [
  ...FEATURED_ATHLETES,
  ...DEPTH_ROSTER.map(([first, last, pos, team], i) => genAthlete(i, first, last, pos, team)),
].map((a) => ({ ...a, ...deriveExtras(a) }));

// Season-summary helpers — the "highs and lows" per athlete.
function seasonHigh(a: Athlete): SeasonPoint {
  return a.season.filter((p) => p.sessions > 0).reduce((m, p) => (p.si > m.si ? p : m), a.season[0]);
}
function seasonLow(a: Athlete): SeasonPoint {
  const played = a.season.filter((p) => p.sessions > 0);
  return played.reduce((m, p) => (p.si < m.si ? p : m), played[0]);
}

// Squads keep the parent/child shape; units and groups are derived on demand.
const TEAMS = [
  { id: "varsity", name: "Varsity", type: "Core team", parent: null as string | null },
  { id: "jv", name: "JV", type: "Sub-team of Varsity", parent: "varsity" },
];
const UNIT_COUNT = new Set(ROSTER.map((a) => a.unit)).size;
const GROUP_COUNT = new Set(ROSTER.map((a) => a.group)).size;
const INJURED = ROSTER.filter((a) => a.injury && a.injury.status !== "Cleared");

const PROGRAM = { name: "Northgate Griffins Football", coach: "Coach D. Harmon", season: "Fall 2026" };

const fullName = (a: Athlete) => `${a.first} ${a.last}`;
const initials = (a: Athlete) => `${a.first[0]}${a.last[0]}`;

// ── Recent sessions — authored so the list feels like a live week of training ──
type DemoSession = {
  id: string;
  athlete: Athlete;
  mode: ModeKey;
  when: string;
  numEvents: number;
  durationMs: number;
  avgSi: number;
  peakSi: number;
  avgForceN: number;
  cadenceHz: number;
};

const RECENT_SESSIONS_RAW: DemoSession[] = [
  { id: "s1",  athlete: ROSTER[2], mode: "power",    when: "2h ago",     numEvents: 128, durationMs: 612000, avgSi: 812, peakSi: 941, avgForceN: 2840, cadenceHz: 3.1 },
  { id: "s2",  athlete: ROSTER[1], mode: "accuracy", when: "4h ago",     numEvents: 96,  durationMs: 540000, avgSi: 703, peakSi: 811, avgForceN: 2410, cadenceHz: 3.9 },
  { id: "s3",  athlete: ROSTER[0], mode: "volume",   when: "Yesterday",  numEvents: 205, durationMs: 480000, avgSi: 690, peakSi: 872, avgForceN: 2610, cadenceHz: 3.4 },
  { id: "s4",  athlete: ROSTER[5], mode: "reaction", when: "Yesterday",  numEvents: 132, durationMs: 510000, avgSi: 612, peakSi: 698, avgForceN: 2050, cadenceHz: 3.6 },
  { id: "s5",  athlete: ROSTER[6], mode: "target",   when: "2d ago",     numEvents: 88,  durationMs: 456000, avgSi: 719, peakSi: 833, avgForceN: 2520, cadenceHz: 3.0 },
  { id: "s6",  athlete: ROSTER[4], mode: "reaction", when: "2d ago",     numEvents: 124, durationMs: 498000, avgSi: 651, peakSi: 742, avgForceN: 2180, cadenceHz: 4.1 },
  { id: "s7",  athlete: ROSTER[3], mode: "power",    when: "3d ago",     numEvents: 116, durationMs: 588000, avgSi: 728, peakSi: 806, avgForceN: 2550, cadenceHz: 3.3 },
  { id: "s8",  athlete: ROSTER[9], mode: "power",    when: "3d ago",     numEvents: 102, durationMs: 402000, avgSi: 601, peakSi: 688, avgForceN: 2110, cadenceHz: 3.2 },
  { id: "s9",  athlete: ROSTER[11],mode: "volume",   when: "4d ago",     numEvents: 188, durationMs: 462000, avgSi: 648, peakSi: 803, avgForceN: 2470, cadenceHz: 2.8 },
  { id: "s10", athlete: ROSTER[12],mode: "accuracy", when: "5d ago",     numEvents: 84,  durationMs: 444000, avgSi: 548, peakSi: 624, avgForceN: 1930, cadenceHz: 4.0 },
  { id: "s11", athlete: ROSTER[7], mode: "power",    when: "5d ago",     numEvents: 110, durationMs: 534000, avgSi: 668, peakSi: 769, avgForceN: 2320, cadenceHz: 3.7 },
  { id: "s12", athlete: ROSTER[8], mode: "target",   when: "6d ago",     numEvents: 76,  durationMs: 420000, avgSi: 540, peakSi: 641, avgForceN: 1870, cadenceHz: 3.8 },
];

// A strike session is capped at one minute. Duration is derived from strike
// count ÷ cadence and clamped to 60s, so the numbers stay internally consistent
// (the durationMs literals above are placeholders the derivation overrides).
const MAX_SESSION_MS = 60_000;
const RECENT_SESSIONS: DemoSession[] = RECENT_SESSIONS_RAW.map((s) => ({
  ...s,
  durationMs: Math.min(MAX_SESSION_MS, Math.round((s.numEvents / s.cadenceHz) * 1000)),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic generators (seeded — stable across renders, no Math.random)
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type HeatCell = { r: number; c: number; intensity: number };

// A believable 12×8 contact heatmap: a centre of mass with gaussian falloff,
// spread tuned per mode (Power = tight & high, Volume = broad, Accuracy = tight
// on a target zone), plus a little jitter so no two look identical.
function makeHeatmap(seed: number, mode: ModeKey): HeatCell[] {
  const rnd = mulberry32(seed);
  const cr = 4 + rnd() * 5;          // centre row (1..12)
  const cc = 2.5 + rnd() * 3;        // centre col (1..8)
  const sigma = mode === "volume" ? 3.4 : mode === "accuracy" ? 1.6 : mode === "target" ? 1.9 : 2.3;
  const cells: HeatCell[] = [];
  let max = 0;
  for (let r = 1; r <= 12; r++) {
    for (let c = 1; c <= 8; c++) {
      const d2 = (r - cr) ** 2 + ((c - cc) * 1.3) ** 2;
      const base = Math.exp(-d2 / (2 * sigma * sigma));
      const jitter = 0.75 + rnd() * 0.5;
      const v = base * jitter;
      if (v > max) max = v;
      cells.push({ r, c, intensity: v });
    }
  }
  // normalise 0..1 and drop near-zero cells for a cleaner grid
  return cells
    .map((x) => ({ ...x, intensity: max > 0 ? x.intensity / max : 0 }))
    .filter((x) => x.intensity > 0.08);
}

type ReplayCell = { r: number; c: number; mv: number };
type ReplayEvent = {
  cells: ReplayCell[];
  angleDeg: number | null;
  si: number | null;
  cellCount: number;
  durationMs: number | null;
};

// A short strike sequence for the Strike Compass / replay: a wandering contact
// point, 1–3 cells per event, an incoming angle, and an SI near the session avg.
function makeReplay(seed: number, avgSi: number, count = 14): ReplayEvent[] {
  const rnd = mulberry32(seed ^ 0x9e37);
  let r = 5 + rnd() * 3;
  let c = 3 + rnd() * 2;
  const out: ReplayEvent[] = [];
  for (let i = 0; i < count; i++) {
    r = Math.max(1, Math.min(12, r + (rnd() - 0.5) * 3));
    c = Math.max(1, Math.min(8, c + (rnd() - 0.5) * 2.5));
    const nCells = 1 + Math.floor(rnd() * 3);
    const cells: ReplayCell[] = [];
    for (let k = 0; k < nCells; k++) {
      cells.push({
        r: Math.max(1, Math.min(12, Math.round(r + (rnd() - 0.5) * 2))),
        c: Math.max(1, Math.min(8, Math.round(c + (rnd() - 0.5) * 2))),
        mv: 200 + Math.round(rnd() * 800),
      });
    }
    out.push({
      cells,
      angleDeg: Math.round((rnd() - 0.5) * 70),
      si: Math.round(avgSi + (rnd() - 0.5) * 160),
      cellCount: nCells,
      durationMs: 40 + Math.round(rnd() * 90),
    });
  }
  return out;
}

// Distribution of incoming angles for the compass background
function makeAngleDist(seed: number): number[] {
  const rnd = mulberry32(seed ^ 0x55aa);
  return Array.from({ length: 16 }, () => Math.round(rnd() * 100) / 100);
}

// Turn a "#rrggbb" accent into a valid rgba() with a numeric alpha. Building
// the fill this way (instead of appending a hex-alpha suffix onto whatever
// pressureToColor returns) keeps the value valid CSS for every intensity —
// otherwise a low-intensity cell produced "rgba(...)ac", which the browser
// silently rejects, leaving the previous session's colour stuck on the cell.
function accentRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
function pressureToGlow(glow: string, kpa: number): string {
  if (kpa > 80) return glow.replace("0.55", "0.70");
  if (kpa > 30) return glow.replace("0.55", "0.40");
  return "rgba(255,255,255,0.25)";
}
function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Coaching-insight cards (Tier III automated coaching intelligence) ──────────
type CoachTag = "Power" | "Accuracy" | "Reaction" | "Consistency" | "Fatigue" | "Tempo" | "Volume" | "Target";
type CoachNumber = { label: string; value: string; delta?: string; deltaDir?: "up" | "down" | "flat" };
type CoachInsight = { tag: CoachTag; priority: "high" | "medium" | "low"; headline: string; numbers: CoachNumber[]; cue: string };

const COACH_INSIGHTS: CoachInsight[] = [
  {
    tag: "Fatigue", priority: "high",
    headline: "Marcus & Devon losing SI across Volume windows",
    numbers: [
      { label: "SI slope", value: "−4.2 / win", delta: "steepening", deltaDir: "down" },
      { label: "Reaction drift", value: "+58 ms", delta: "late-session", deltaDir: "down" },
      { label: "Windows", value: "6" },
    ],
    cue: "Shorten Volume windows to 4s and add 30s rest between them — prioritise quality output per window over raw hit count.",
  },
  {
    tag: "Power", priority: "high",
    headline: "Tyrell Boone power trending up 9% — add load",
    numbers: [
      { label: "Avg SI", value: "812", delta: "+9%", deltaDir: "up" },
      { label: "Peak SI", value: "941", delta: "PR", deltaDir: "up" },
      { label: "Consistency", value: "88%", deltaDir: "flat" },
    ],
    cue: "Output and consistency are both climbing. Add 10% volume or a heavier bag next Power block to keep the adaptation going.",
  },
  {
    tag: "Accuracy", priority: "medium",
    headline: "QB room placement well above roster mean",
    numbers: [
      { label: "Cole Ramsey", value: "93%", delta: "+4%", deltaDir: "up" },
      { label: "Roster mean", value: "82%", deltaDir: "flat" },
      { label: "Avg offset", value: "2.0 cm" },
    ],
    cue: "Ramsey's placement is a team high. Pair him with the JV receivers as a model for the next Accuracy session.",
  },
  {
    tag: "Reaction", priority: "medium",
    headline: "JV linemen slow to cue — Okafor & Delgado",
    numbers: [
      { label: "Okafor avg", value: "389 ms", delta: "+112 late", deltaDir: "down" },
      { label: "Delgado avg", value: "361 ms", delta: "+104 late", deltaDir: "down" },
      { label: "Roster best", value: "214 ms" },
    ],
    cue: "Both drift >100 ms by session end. Cap Reaction sets at 40 reps and cue earlier in the session while they're fresh.",
  },
  {
    tag: "Consistency", priority: "low",
    headline: "Owen Delgado's Power floor is unstable",
    numbers: [
      { label: "Consistency", value: "66%", deltaDir: "down" },
      { label: "Avg / Peak", value: "623 / 712" },
    ],
    cue: "Low avg-to-peak ratio means big swings strike to strike. Drill 8-count continuous combos to raise the floor before chasing peaks.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Small hooks & presentational helpers
// ─────────────────────────────────────────────────────────────────────────────
function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => (document.documentElement.getAttribute("data-theme") || "dark").toLowerCase() !== "light"
  );
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() =>
      setDark((root.getAttribute("data-theme") || "dark").toLowerCase() !== "light")
    );
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Inline SVG icons (replace emoji so they inherit currentColor & scale) ─────
function IconLock({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <rect x="5" y="11" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconEye({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d="M2 12s3.6-6.8 10-6.8S22 12 22 12s-3.6 6.8-10 6.8S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function IconSpark({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" fill="currentColor" />
      <path d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
// A tier lock chip: the lock glyph + a short label, used inline in badges/hints.
function LockChip({ children, size = 11 }: { children: React.ReactNode; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
      <IconLock size={size} />
      {children}
    </span>
  );
}

// Wraps a card/feature that a tier hasn't unlocked. Shows the real (sample)
// content blurred underneath with a lock overlay + upgrade affordance, per the
// tier plan's "visible but disabled" rule.
function LockGate({
  locked,
  requiredTier,
  title,
  body,
  children,
}: {
  locked: boolean;
  requiredTier: TierNum;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  const tierLabel = TIERS[requiredTier - 1].label;
  const tierName = TIERS[requiredTier - 1].name;
  return (
    <div className="dm-lockWrap">
      <div className="dm-lockUnder" aria-hidden="true">
        {children}
      </div>
      <div className="dm-lockOverlay">
        <div className="dm-lockIcon" aria-hidden="true"><IconLock size={22} /></div>
        <div className="dm-lockTitle">{title}</div>
        <div className="dm-lockBody">{body}</div>
        <div className="dm-upgradeChip">
          <span aria-hidden="true">▲</span> Included in {tierLabel} · {tierName}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  meta,
  children,
  span2,
  style,
  className,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  span2?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`ts-card${span2 ? " ts-span2" : ""}${className ? " " + className : ""}`} style={style}>
      {(title || meta) && (
        <div className="ts-cardTop">
          <div className="ts-cardTitle">{title}</div>
          {meta && <div className="ts-cardMeta">{meta}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// Injury status → colour tokens (works in both themes).
const INJURY_COLOR: Record<InjuryStatus, { bg: string; border: string; color: string; dot: string }> = {
  Out:            { bg: "rgba(255,80,80,0.12)",  border: "rgba(255,80,80,0.40)",  color: "rgba(255,120,110,0.98)", dot: "#ff5f5f" },
  Questionable:   { bg: "rgba(255,170,0,0.12)",  border: "rgba(255,170,0,0.40)",  color: "rgba(255,190,60,0.98)",  dot: "#ffaa00" },
  "Day-to-day":   { bg: "rgba(255,210,0,0.10)",  border: "rgba(255,210,0,0.34)",  color: "rgba(230,190,40,0.98)",  dot: "#ffd200" },
  Cleared:        { bg: "rgba(80,220,160,0.12)", border: "rgba(80,220,160,0.36)", color: "rgba(80,220,160,0.98)",   dot: "#50dca0" },
};

function InjuryBadge({ injury, compact }: { injury: Injury; compact?: boolean }) {
  const c = INJURY_COLOR[injury.status];
  return (
    <span
      title={`${injury.status} · ${injury.area} — ${injury.note}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
        fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
        padding: "3px 8px", borderRadius: 999,
        background: c.bg, border: `1px solid ${c.border}`, color: c.color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
      {compact ? injury.status : `${injury.status} · ${injury.area}`}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
type TabKey = "recent" | "insights" | "athletes" | "export";

export default function Dummy() {
  const isDark = useIsDark();
  const [tier, setTier] = useState<TierNum>(3);
  const [activeTab, setActiveTab] = useState<TabKey>("recent");

  const can = (f: Feature) => tier >= FEATURE_MIN_TIER[f];
  const modeUnlocked = (m: ModeKey) => tier >= MODE_BY_KEY[m].minTier;
  const tierMeta = TIERS[tier - 1];
  const unlockedModes = MODES.filter((m) => tier >= m.minTier);

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
      <style>{DASHBOARD_CSS}</style>
      <style>{DEMO_EXTRA_CSS}</style>

      {/* ── Public-demo banner ─────────────────────────────────────────────── */}
      <div className="dm-banner">
        <span className="dm-bannerDot" aria-hidden="true" />
        <div className="dm-bannerText">
          <b>Interactive demo.</b> This is a sample dashboard for a fictional program,{" "}
          <b>{PROGRAM.name}</b>, populated with example data. Switch tiers below to see what each plan unlocks.
          Nothing here can be edited — it's read-only.
        </div>
        <span className="dm-roPill" title="This demo is read-only">
          <IconEye size={13} /> View only
        </span>
        <Link to="/" className="ts-btn ts-btnGhost" style={{ textDecoration: "none" }}>
          ← Home
        </Link>
      </div>

      {/* ── Three-tier toggle ──────────────────────────────────────────────── */}
      <div className="dm-tierBar" role="tablist" aria-label="Subscription tier">
        {TIERS.map((t) => (
          <button
            key={t.n}
            type="button"
            role="tab"
            aria-selected={tier === t.n}
            className={`dm-tierSeg ${tier === t.n ? "isActive" : ""}`}
            onClick={() => setTier(t.n)}
          >
            <div className="dm-tierSegTop">
              <span className="dm-tierSegKicker">{t.label} · {t.insight}</span>
              <span className="dm-tierSegCheck" aria-hidden="true">{tier === t.n ? "✓" : ""}</span>
            </div>
            <span className="dm-tierSegName">{t.name}</span>
            <span className="dm-tierSegTagline">{t.tagline} — {t.question}</span>
          </button>
        ))}
      </div>

      {/* ── Tier overview panel ────────────────────────────────────────────── */}
      <Card
        title={`${tierMeta.label} — ${tierMeta.name}`}
        meta={`${tierMeta.insight} · ${unlockedModes.length} of 5 modes`}
        style={{ marginBottom: 18 }}
      >
        <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.6, opacity: 0.85, maxWidth: 780 }}>
          {tierMeta.blurb}
        </p>
        <div className="dm-tierOverview">
          <div>
            <div className="ts-pillLabel" style={{ marginBottom: 8 }}>What this tier offers</div>
            <div className="dm-featureList">
              {tierMeta.highlights.map((h, i) => (
                <div key={i} className="dm-featureRow">
                  <span className="dm-featureTick" aria-hidden="true">✓</span>
                  <span>{h}</span>
                </div>
              ))}
            </div>
            {/* Modes strip */}
            <div className="ts-pillLabel" style={{ margin: "16px 0 8px" }}>Impact modes</div>
            <div className="ts-athletePills" style={{ maxWidth: "100%", justifyContent: "flex-start" }}>
              {MODES.map((m) => {
                const on = tier >= m.minTier;
                return (
                  <span
                    key={m.key}
                    className={`ts-athletePill ts-modePill ${m.pill}`}
                    style={{ opacity: on ? 1 : 0.4 }}
                    title={m.desc}
                  >
                    <span aria-hidden="true">{m.icon}</span>
                    {m.label}
                    {!on && (
                      <span className="dm-lockBadge" style={{ marginLeft: 4 }}>
                        <IconLock size={10} /> {TIERS[m.minTier - 1].label}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <div className="ts-pillLabel" style={{ marginBottom: 8 }}>Program limits</div>
            <div className="dm-limitGrid">
              <Limit label="Athletes" value={tierMeta.limits.athletes} />
              <Limit label="Coaches" value={tierMeta.limits.coaches} />
              <Limit label="Devices" value={tierMeta.limits.devices} />
              <Limit label="Sessions" value={tierMeta.limits.sessions} />
              <Limit label="Teams" value={tierMeta.limits.teams} />
              <Limit label="History" value={tierMeta.limits.history} />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Title + tabs ───────────────────────────────────────────────────── */}
      <div className="ts-dashTop">
        <div className="ts-dashHead">
          <h1 className="ts-dashTitle">{PROGRAM.name}</h1>
          <div className="ts-tabsRow" role="tablist" aria-label="Dashboard sections">
            <div className="ts-tabs">
              {tabBtn("recent", "Recent Sessions")}
              {tabBtn("insights", "Insights & Analysis")}
              {tabBtn("athletes", "Individual Athletes")}
              {tabBtn("export", "Export & API")}
            </div>
          </div>
          <p className="ts-dashSub">
            {PROGRAM.coach} · {PROGRAM.season} · Realtime training metrics + AI-ready analysis.
          </p>
        </div>
      </div>

      {/* ── Program stat strip ─────────────────────────────────────────────── */}
      <div className="dm-statStrip">
        <StatTile label="Athletes" value={String(ROSTER.length)} sub={`of ${tierMeta.limits.athletes} allowed`} />
        <StatTile
          label="Teams"
          value={String(TEAMS.length + UNIT_COUNT + GROUP_COUNT)}
          sub={`${TEAMS.length} squads · ${UNIT_COUNT} units · ${GROUP_COUNT} groups`}
        />
        <StatTile
          label="Availability"
          value={`${ROSTER.length - INJURED.length}/${ROSTER.length}`}
          sub={`${INJURED.length} out or limited`}
        />
        <StatTile
          label="Program avg SI"
          value={String(Math.round(ROSTER.reduce((s, a) => s + a.power.avg, 0) / ROSTER.length))}
          sub="Strength Index / 1000"
        />
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div key={`${activeTab}-${tier}`} className="ts-tabContent">
        {activeTab === "recent" && <RecentTab isDark={isDark} tier={tier} can={can} />}
        {activeTab === "insights" && <InsightsTab isDark={isDark} tier={tier} can={can} modeUnlocked={modeUnlocked} />}
        {activeTab === "athletes" && <AthletesTab isDark={isDark} tier={tier} can={can} />}
        {activeTab === "export" && <ExportTab isDark={isDark} tier={tier} can={can} />}
      </div>

      {/* ── Footer note ────────────────────────────────────────────────────── */}
      <p style={{ marginTop: 28, fontSize: 12, opacity: 0.4, textAlign: "center", lineHeight: 1.6 }}>
        Sample data only · No athletes, sessions or devices shown here are real ·{" "}
        <Link to="/contact" style={{ color: "inherit" }}>Request a live demo</Link>
      </p>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="dm-limitCell">
      <div className="dm-limitLabel">{label}</div>
      <div className="dm-limitValue">{value}</div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dm-statTile">
      <div className="dm-statTileLabel">{label}</div>
      <div className="dm-statTileValue">{value}</div>
      {sub && <div className="dm-statTileSub">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Recent Sessions — list + session summary (heatmap, stats, Strike Compass)
// ─────────────────────────────────────────────────────────────────────────────
function RecentTab({ isDark, tier, can }: { isDark: boolean; tier: TierNum; can: (f: Feature) => boolean }) {
  const [selectedId, setSelectedId] = useState<string>(RECENT_SESSIONS[0].id);
  const session = RECENT_SESSIONS.find((s) => s.id === selectedId) ?? RECENT_SESSIONS[0];
  const mode = MODE_BY_KEY[session.mode];

  const heatmap = useMemo(() => makeHeatmap(session.athlete.seed + session.mode.length, session.mode), [session]);
  const replay = useMemo(() => makeReplay(session.athlete.seed, session.avgSi), [session]);
  const angleDist = useMemo(() => makeAngleDist(session.athlete.seed), [session]);

  // Simple read-only replay: step an index through the events for the compass.
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // reset when session changes
    setPlaying(false);
    setIdx(-1);
    if (timer.current) clearInterval(timer.current);
  }, [selectedId]);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setIdx((i) => {
        if (i >= replay.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 700);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, replay.length]);

  const activeEvent = idx >= 0 && idx < replay.length ? replay[idx] : null;

  return (
    <div className="ts-dashGrid ts-dashMain">
      {/* Recent sessions list */}
      <Card title="Recent Sessions" meta={`${RECENT_SESSIONS.length} this week`}>
        <div className="ts-recentSessionsList">
          {RECENT_SESSIONS.map((s) => {
            const sm = MODE_BY_KEY[s.mode];
            const selected = s.id === selectedId;
            return (
              <div
                key={s.id}
                className={`ts-recentSessionRow${selected ? " isSelected" : ""}`}
                onClick={() => setSelectedId(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(s.id);
                  }
                }}
              >
                <div className="ts-recentSessionAvatar">{initials(s.athlete)}</div>
                <div className="ts-recentSessionInfo">
                  <div className="ts-recentSessionText">
                    <div className="ts-recentSessionAthlete">{fullName(s.athlete)}</div>
                    <div className="ts-recentSessionMeta">
                      {s.athlete.pos} · {s.numEvents} strikes · {fmtDuration(s.durationMs)} · {s.when}
                    </div>
                  </div>
                  <span className="ts-summaryModePill" data-mode={s.mode} style={{ flexShrink: 0 }}>
                    {sm.icon} {sm.label}
                  </span>
                </div>
                <svg className="ts-recentSessionChevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Session summary — heatmap + stats + compass */}
      <Card className="ts-heatmapCard">
        <div className="ts-cardTop">
          <div className="ts-cardTitle">Session Summary</div>
          <span className="ts-summaryModePill" data-mode={session.mode}>
            {mode.icon} {mode.label}
          </span>
        </div>
        <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>
          {fullName(session.athlete)} · {session.athlete.pos} · {session.when}
        </div>

        <div className="ts-heatmapBody">
          {/* Bag heatmap */}
          <div className="ts-heatmapBagCol">
            <div className="ts-dash-bagWrap">
              <div style={{ position: "absolute", inset: 0 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(8, 1fr)",
                    gridTemplateRows: "repeat(12, 1fr)",
                    gap: 3,
                    padding: "28px 6px 6px",
                    width: "100%",
                    height: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {Array.from({ length: 12 }, (_, ri) =>
                    Array.from({ length: 8 }, (_, ci) => {
                      const r = 12 - ri;
                      const c = 8 - ci;
                      const key = `${r}-${c}`;
                      const inActive = activeEvent?.cells.some((cell) => cell.r === r && cell.c === c) ?? false;
                      let intensity = 0;
                      if (activeEvent) {
                        intensity = inActive ? 1 : 0;
                      } else {
                        intensity = heatmap.find((h) => h.r === r && h.c === c)?.intensity ?? 0;
                      }
                      const kpa = intensity > 0.6 ? 90 : intensity > 0.2 ? 40 : 0;
                      const isAlive = intensity > 0;
                      const glow = isAlive ? pressureToGlow(mode.glow, kpa) : null;
                      return (
                        <div
                          key={key}
                          className="ts-dash-cell"
                          title={`R${String(r).padStart(2, "0")} C${String(c).padStart(2, "0")}${isAlive ? ` · ${Math.round(intensity * 100)}%` : ""}`}
                          style={{
                            borderRadius: 4,
                            // Always a valid rgba() so React can overwrite it cleanly when the
                            // selected session changes (see accentRgba).
                            background: isAlive ? accentRgba(mode.accent, 0.2 + intensity * 0.55) : "rgba(255,255,255,0.03)",
                            boxShadow: isAlive ? `0 0 10px 2px ${glow}` : "none",
                            border: isAlive ? `1px solid ${accentRgba(mode.accent, intensity * 0.6)}` : "1px solid transparent",
                            transform: inActive ? "scale(1.12)" : isAlive && intensity > 0.7 ? "scale(1.06)" : "scale(1)",
                            transition: "background 80ms, box-shadow 80ms, transform 80ms, border-color 80ms",
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Read-only replay controls */}
            <div className="ts-replayControls">
              <button className="ts-replayBtn ts-replayBtnPrimary" onClick={() => setPlaying((p) => !p)} type="button">
                {playing ? "⏸ Pause" : "▶ Play replay"}
              </button>
              <button
                className="ts-replayBtn"
                type="button"
                disabled={idx <= 0}
                onClick={() => setIdx((i) => Math.max(-1, i - 1))}
              >
                ‹ Prev
              </button>
              <button
                className="ts-replayBtn"
                type="button"
                disabled={idx >= replay.length - 1}
                onClick={() => setIdx((i) => Math.min(replay.length - 1, i + 1))}
              >
                Next ›
              </button>
              <button
                className="ts-replayBtn"
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setIdx(-1);
                }}
              >
                ↺ Reset
              </button>
              <span className="ts-replaySpeedLabel" style={{ marginLeft: 4 }}>
                {activeEvent ? `strike ${idx + 1} / ${replay.length}` : `${replay.length} strikes`}
              </span>
            </div>
          </div>

          {/* Stats + Strength Index */}
          <div className="ts-heatmapStatsCol">
            <div className="ts-summaryList">
              <SummaryRow label="Strikes" value={String(session.numEvents)} />
              <SummaryRow label="Duration" value={fmtDuration(session.durationMs)} />
              <SummaryRow
                label={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Avg SI <StrengthIndexInfo size={14} /></span>}
                value={`${session.avgSi}`}
                accent={mode.accent}
              />
              <SummaryRow label="Peak SI" value={`${session.peakSi}`} accent={mode.accent} />
              <SummaryRow label="Avg force" value={`${session.avgForceN} N`} />
              <SummaryRow label="Cadence" value={`${session.cadenceHz} Hz`} />
            </div>

            {/* 3D Strike Compass — Tier II+ */}
            <div style={{ marginTop: 14 }}>
              <div className="ts-pillLabel" style={{ marginBottom: 6 }}>3D angle analysis</div>
              <LockGate
                locked={!can("strikeCompass")}
                requiredTier={FEATURE_MIN_TIER.strikeCompass}
                title="Strike Compass"
                body="See the incoming angle of every strike reconstructed in 3D — drag to orbit, replay strike-by-strike, and catch directional bias you can't see from the sideline."
              >
                <div className="ts-strikeCompassWrap" style={{ display: "block" }}>
                  <StrikeCompass
                    activeEvent={activeEvent}
                    activeAngle={activeEvent?.angleDeg ?? null}
                    anglesDeg={angleDist}
                    isReplaying={playing}
                    modeAccent={mode.accent}
                    modeGlow={mode.glow}
                    isDark={isDark}
                  />
                </div>
              </LockGate>
            </div>
          </div>
        </div>
      </Card>

      {/* Coaching Insights — Tier III */}
      <div className="ts-span2">
        <LockGate
          locked={!can("aiInsights")}
          requiredTier={FEATURE_MIN_TIER.aiInsights}
          title="Automated coaching intelligence"
          body="A prioritised coaching card for every mode — a headline, the supporting metrics with direction, and a concrete cue for what to change next session. Reproducible and auditable, not a guess."
        >
          <CoachingInsightsCard isDark={isDark} />
        </LockGate>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, accent }: { label: React.ReactNode; value: string; accent?: string }) {
  return (
    <div className="ts-summaryRow">
      <span className="ts-summaryRowLabel">{label}</span>
      <span className="ts-summaryRowValue" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

function CoachingInsightsCard({ isDark }: { isDark: boolean }) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  const tagColors: Record<string, { bg: string; border: string; color: string }> = {
    Power: { bg: "rgba(180,0,255,0.10)", border: "rgba(180,0,255,0.30)", color: "rgba(210,140,255,0.95)" },
    Accuracy: { bg: "rgba(0,220,255,0.09)", border: "rgba(0,220,255,0.28)", color: "rgba(80,220,255,0.95)" },
    Reaction: { bg: "rgba(255,200,0,0.09)", border: "rgba(255,200,0,0.28)", color: "rgba(255,210,60,0.95)" },
    Consistency: { bg: "rgba(80,220,160,0.09)", border: "rgba(80,220,160,0.26)", color: "rgba(80,220,160,0.95)" },
    Fatigue: { bg: "rgba(255,100,80,0.09)", border: "rgba(255,100,80,0.26)", color: "rgba(255,130,110,0.95)" },
    Tempo: { bg: "rgba(255,170,0,0.09)", border: "rgba(255,170,0,0.26)", color: "rgba(255,190,60,0.95)" },
    Volume: { bg: "rgba(255,106,0,0.09)", border: "rgba(255,106,0,0.28)", color: "rgba(255,140,60,0.95)" },
    Target: { bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.26)", color: "rgba(0,210,100,0.95)" },
  };
  const priorityDot: Record<string, string> = { high: "#ff5f5f", medium: "#ffcc00", low: "rgba(255,255,255,0.22)" };

  return (
    <Card
      title="Coaching Insights"
      meta={`${COACH_INSIGHTS.filter((i) => i.priority === "high").length} high-priority`}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {COACH_INSIGHTS.map((insight, idx) => {
          const tc = tagColors[insight.tag] ?? tagColors.Power;
          return (
            <div
              key={idx}
              style={{
                borderRadius: 12,
                border: `1px solid rgba(${ink},${isDark ? "0.08" : "0.10"})`,
                background: `rgba(${ink},${isDark ? "0.03" : "0.025"})`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px 8px",
                  borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: priorityDot[insight.priority],
                    boxShadow: insight.priority === "high" ? "0 0 6px #ff5f5faa" : "none",
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: tc.bg,
                    border: `1px solid ${tc.border}`,
                    color: tc.color,
                    flexShrink: 0,
                  }}
                >
                  {insight.tag}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0, color: `rgba(${ink},0.90)`, lineHeight: 1.3 }}>
                  {insight.headline}
                </div>
              </div>

              {insight.numbers.length > 0 && (
                <div style={{ display: "flex", gap: 0, borderBottom: `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`, overflowX: "auto" }}>
                  {insight.numbers.map((n, ni) => (
                    <div
                      key={ni}
                      style={{
                        flex: "1 0 auto",
                        padding: "8px 14px",
                        borderRight: ni < insight.numbers.length - 1 ? `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})` : "none",
                        minWidth: 80,
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.45, marginBottom: 3, whiteSpace: "nowrap" }}>{n.label}</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                          color:
                            n.deltaDir === "up"
                              ? tc.color
                              : n.deltaDir === "down"
                              ? isDark
                                ? "rgba(255,100,80,0.90)"
                                : "rgba(200,50,40,0.90)"
                              : `rgba(${ink},0.88)`,
                          lineHeight: 1.2,
                        }}
                      >
                        {n.value}
                      </div>
                      {n.delta && <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2, whiteSpace: "nowrap" }}>{n.delta}</div>}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ padding: "9px 14px 11px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, opacity: 0.45 }}>
                  <circle cx="5.5" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8.5 6l3-3M8.5 5h3v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.78, color: `rgba(${ink},0.88)` }}>{insight.cue}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Insights & Analysis — leaderboards, most improved, team compare, fatigue
// ─────────────────────────────────────────────────────────────────────────────
type MetricKey = "strength" | "reaction" | "accuracy" | "volume" | "target";
const METRIC_TO_MODE: Record<MetricKey, ModeKey> = {
  strength: "power",
  reaction: "reaction",
  accuracy: "accuracy",
  volume: "volume",
  target: "target",
};

function InsightsTab({
  isDark,
  tier,
  can,
  modeUnlocked,
}: {
  isDark: boolean;
  tier: TierNum;
  can: (f: Feature) => boolean;
  modeUnlocked: (m: ModeKey) => boolean;
}) {
  const [metric, setMetric] = useState<MetricKey>("strength");
  const [range, setRange] = useState<"30" | "90" | "all">(tier === 1 ? "30" : tier === 2 ? "90" : "all");

  // Clamp metric to what this tier can see (Tier I = Power only).
  const effectiveMetric: MetricKey = modeUnlocked(METRIC_TO_MODE[metric]) ? metric : "strength";

  // Date ranges permitted by the tier.
  const ranges: { key: "30" | "90" | "all"; label: string; min: TierNum }[] = [
    { key: "30", label: "30 days", min: 1 },
    { key: "90", label: "90 days", min: 2 },
    { key: "all", label: "All time", min: 3 },
  ];

  return (
    <div className="ts-dashGrid ts-dashMain">
      {/* Date range control */}
      <div className="ts-span2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="ts-leaderLabel">History window</span>
        <div className="ts-tabs" style={{ padding: 3 }}>
          {ranges.map((r) => {
            const locked = tier < r.min;
            return (
              <button
                key={r.key}
                type="button"
                className={`ts-tabBtn ${range === r.key ? "isActive" : ""}`}
                disabled={locked}
                title={locked ? `Available from ${TIERS[r.min - 1].label}` : undefined}
                style={{ opacity: locked ? 0.4 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => !locked && setRange(r.key)}
              >
                {r.label} {locked && <IconLock size={11} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Athlete leaderboard */}
      <Card
        span2
        title="Athlete Leaderboard"
        meta={`${ROSTER.length} athletes · ${range === "all" ? "all time" : `last ${range}d`}`}
      >
        <div className="ts-leaderTop">
          <div className="ts-leaderNote">
            {effectiveMetric === "strength"
              ? "Top athletes by Strength Index (0–1000), derived from peak & avg force across all Power sessions."
              : effectiveMetric === "reaction"
              ? "Top athletes by avg reaction time — lower is better. Best = fastest single response."
              : effectiveMetric === "accuracy"
              ? "Top athletes by Accuracy Score (0–100%) across all Accuracy sessions."
              : effectiveMetric === "volume"
              ? "Top athletes by hits per window across Volume sessions, with avg SI showing output quality."
              : "Top athletes by zone accuracy %. Avg RT is correct-zone reaction time only — lower is better."}
          </div>
          <div className="ts-leaderControls">
            <label className="ts-leaderLabel" htmlFor="leaderMetric">Mode</label>
            <select
              id="leaderMetric"
              className="ts-select"
              value={effectiveMetric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
            >
              {(["strength", "reaction", "accuracy", "volume", "target"] as MetricKey[]).map((m) => {
                const mode = MODE_BY_KEY[METRIC_TO_MODE[m]];
                const locked = !modeUnlocked(mode.key);
                return (
                  <option key={m} value={m} disabled={locked}>
                    {mode.icon} {mode.label}{locked ? ` — ${TIERS[mode.minTier - 1].label}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Tier I gets ONLY the single-mode Power leaderboard. The multi-mode
            selector above is present but the other modes are locked. */}
        <LeaderboardTable metric={effectiveMetric} />

        {tier === 1 && (
          <div className="ts-cardHint">
            <LockChip>Reaction, Accuracy, Volume and Target leaderboards unlock at {TIERS[1].label} — Analysis.</LockChip>
          </div>
        )}
      </Card>

      {/* Most Improved — Tier II+ */}
      <LockGate
        locked={!can("mostImproved")}
        requiredTier={FEATURE_MIN_TIER.mostImproved}
        title="Most Improved"
        body="Ranks change rather than level — who's climbing fastest across the window. Needs the 90-day history Analysis unlocks."
      >
        <MostImprovedCard isDark={isDark} />
      </LockGate>

      {/* Team comparison — Tier II+ */}
      <LockGate
        locked={!can("teamComparison")}
        requiredTier={FEATURE_MIN_TIER.teamComparison}
        title="Team Comparison"
        body="Every team in the program side by side, per mode — plus each athlete against the team mean, so you can see who's carrying or dragging the aggregate."
      >
        <TeamCompareCard isDark={isDark} />
      </LockGate>

      {/* Availability report — all tiers (roster management, not gated) */}
      <div className="ts-span2">
        <AvailabilityCard isDark={isDark} />
      </div>

      {/* Fatigue tracker — Tier III */}
      <div className="ts-span2">
        <LockGate
          locked={!can("fatigueTracker")}
          requiredTier={FEATURE_MIN_TIER.fatigueTracker}
          title="Fatigue Tracker"
          body="Per-athlete SI slope across Volume windows, a roster-level fatigue alert ranked by severity, and the longitudinal curve session-over-session — where load management actually happens."
        >
          <FatigueCard isDark={isDark} />
        </LockGate>
      </div>
    </div>
  );
}

function AvailabilityCard({ isDark }: { isDark: boolean }) {
  const injured = ROSTER.filter((a) => a.injury).sort((a, b) => {
    const order: Record<InjuryStatus, number> = { Out: 0, Questionable: 1, "Day-to-day": 2, Cleared: 3 };
    return order[a.injury!.status] - order[b.injury!.status];
  });
  const available = ROSTER.length - INJURED.length;
  return (
    <Card title="Availability Report" meta={`${available}/${ROSTER.length} available`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {injured.map((a) => {
          const c = INJURY_COLOR[a.injury!.status];
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 12, border: `1px solid ${c.border}`, background: c.bg }}>
              <div className="ts-recentSessionAvatar" style={{ width: 32, height: 32, fontSize: 11 }}>{initials(a)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{fullName(a)}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{a.pos} · {a.group} · {a.team}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>{a.injury!.area} — {a.injury!.note}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <InjuryBadge injury={a.injury!} compact />
                <span style={{ fontSize: 10, opacity: 0.55 }}>{a.injury!.gamesMissed} missed</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="ts-cardHint">Injuries reduce that athlete's Strength Index and open a gap in their season timeline for the weeks missed.</div>
    </Card>
  );
}

function LeaderboardTable({ metric }: { metric: MetricKey }) {
  const rows = useMemo(() => {
    const list = [...ROSTER];
    if (metric === "strength") list.sort((a, b) => b.power.avg - a.power.avg);
    else if (metric === "reaction") list.sort((a, b) => a.reaction.avg - b.reaction.avg);
    else if (metric === "accuracy") list.sort((a, b) => b.accuracy.pct - a.accuracy.pct);
    else if (metric === "volume") list.sort((a, b) => b.volume.avgWindowHits - a.volume.avgWindowHits);
    else list.sort((a, b) => b.target.accPct - a.target.accPct);
    return list.slice(0, 8);
  }, [metric]);

  const headers =
    metric === "strength"
      ? ["Peak Index", "Avg Index", "Sessions"]
      : metric === "reaction"
      ? ["Avg Reaction", "Best", "Attempts"]
      : metric === "accuracy"
      ? ["Accuracy %", "Avg Offset", "Sessions"]
      : metric === "volume"
      ? ["Avg Hits / Win", "Avg SI", "Sessions"]
      : ["Accuracy", "Avg RT (correct)", "Attempts"];

  const accent =
    metric === "strength" ? "rgba(210,140,255,0.95)"
      : metric === "reaction" ? "rgba(255,210,60,0.95)"
      : metric === "accuracy" ? "rgba(80,220,255,0.95)"
      : metric === "volume" ? "rgba(255,150,60,0.95)"
      : "rgba(0,220,110,0.95)";

  const profile =
    metric === "strength" ? "Power profile"
      : metric === "reaction" ? "Reaction profile"
      : metric === "accuracy" ? "Accuracy profile"
      : metric === "volume" ? "Volume profile"
      : "Target profile";

  return (
    <div className="ts-leaderTable" role="table" aria-label="Athlete Leaderboard">
      <div className="ts-leaderRow ts-leaderHead" role="row">
        <div className="ts-leaderCell rank" role="columnheader">#</div>
        <div className="ts-leaderCell name" role="columnheader">Athlete</div>
        {headers.map((h) => (
          <div key={h} className="ts-leaderCell" role="columnheader">{h}</div>
        ))}
      </div>
      {rows.map((a, idx) => {
        const cells: React.ReactNode[] =
          metric === "strength"
            ? [
                <Num key="1" v={a.power.peak} unit="/1000" c={accent} />,
                <Num key="2" v={a.power.avg} unit="/1000" c={accent} />,
                <>{a.power.sessions}</>,
              ]
            : metric === "reaction"
            ? [
                <Num key="1" v={a.reaction.avg} unit="ms" c={accent} />,
                <Num key="2" v={a.reaction.best} unit="ms" />,
                <>{a.reaction.attempts}</>,
              ]
            : metric === "accuracy"
            ? [
                <Num key="1" v={a.accuracy.pct} unit="%" c={accent} />,
                <Num key="2" v={a.accuracy.offset} unit="cm" />,
                <>{a.accuracy.sessions}</>,
              ]
            : metric === "volume"
            ? [
                <Num key="1" v={a.volume.avgWindowHits} unit="hits" c={accent} />,
                <Num key="2" v={a.volume.avgSi} unit="/1000" c={accent} />,
                <>{a.volume.sessions}</>,
              ]
            : [
                <Num key="1" v={a.target.accPct} unit="%" c={accent} />,
                <Num key="2" v={a.target.rtCorrect} unit="ms" c="rgba(255,210,60,0.95)" />,
                <>{a.target.attempts}</>,
              ];
        return (
          <div key={a.id} className="ts-leaderRow" role="row">
            <div className="ts-leaderCell rank" role="cell">{idx + 1}</div>
            <div className="ts-leaderCell name" role="cell">
              <div className="ts-leaderName">{fullName(a)}</div>
              <div className="ts-leaderSub">{profile} · {a.team}</div>
            </div>
            {cells.map((cell, i) => (
              <div key={i} className="ts-leaderCell" role="cell">{cell}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Num({ v, unit, c }: { v: number; unit?: string; c?: string }) {
  return (
    <span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: c }}>{v}</span>
      {unit && <span style={{ fontSize: 10, opacity: 0.45, marginLeft: 3 }}>{unit}</span>}
    </span>
  );
}

function MostImprovedCard({ isDark }: { isDark: boolean }) {
  const rows = [...ROSTER].sort((a, b) => b.power.delta - a.power.delta).slice(0, 5);
  return (
    <Card title="Most Improved" meta="Power · last 90d">
      <div className="ts-mostImproved">
        {rows.map((a, i) => (
          <div key={a.id} className="ts-mostRow">
            <div className="ts-miLabel">
              <div className="ts-miTitle">
                #{i + 1} {fullName(a)}
              </div>
              <div className="ts-miSubtitle">{a.pos} · {a.team}</div>
            </div>
            <div className="ts-miBody">
              <div className="ts-miPills">
                <span className="ts-improvePill" style={{ color: a.power.delta >= 0 ? "rgba(80,220,160,0.98)" : "rgba(255,110,90,0.98)" }}>
                  {a.power.delta >= 0 ? "▲" : "▼"} {Math.abs(a.power.delta)}% SI
                </span>
                <span className="ts-improvePill">avg {a.power.avg}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type CompareDim = "squad" | "unit" | "group";

function TeamCompareCard({ isDark }: { isDark: boolean }) {
  const [metric, setMetric] = useState<"power" | "accuracy" | "reaction">("power");
  const [dim, setDim] = useState<CompareDim>("squad");

  const keyOf = (a: Athlete) => (dim === "squad" ? a.team : dim === "unit" ? a.unit : a.group);
  const groupsMap = new Map<string, Athlete[]>();
  for (const a of ROSTER) {
    const k = keyOf(a);
    if (!groupsMap.has(k)) groupsMap.set(k, []);
    groupsMap.get(k)!.push(a);
  }
  const groups = Array.from(groupsMap.entries()).map(([name, members]) => {
    const val =
      metric === "power"
        ? Math.round(members.reduce((s, a) => s + a.power.avg, 0) / members.length)
        : metric === "accuracy"
        ? Math.round(members.reduce((s, a) => s + a.accuracy.pct, 0) / members.length)
        : Math.round(members.reduce((s, a) => s + a.reaction.avg, 0) / members.length);
    return { name, val, n: members.length };
  });
  // Rank: higher is better, except reaction (lower is better).
  groups.sort((a, b) => (metric === "reaction" ? a.val - b.val : b.val - a.val));

  const accent = metric === "power" ? "#b400ff" : metric === "accuracy" ? "#00dcff" : "#ffcc00";
  const maxVal = Math.max(...groups.map((t) => t.val));
  const barPct = (v: number) => (metric === "reaction" ? (1 - v / (maxVal * 1.2)) * 100 + 30 : (v / maxVal) * 100);
  const unit = metric === "power" ? "/1000" : metric === "accuracy" ? "%" : "ms";
  const dimLabel = dim === "squad" ? "Varsity / JV" : dim === "unit" ? "Offense / Defense / ST" : `${groups.length} position groups`;

  const seg = (val: string, cur: string, set: (v: any) => void, label: string) => (
    <button
      key={val}
      type="button"
      onClick={() => set(val)}
      style={{
        padding: "4px 11px", borderRadius: 6, border: "1px solid transparent",
        background: cur === val ? "rgba(180,0,255,0.16)" : "transparent",
        color: cur === val ? (isDark ? "#fff" : "#111") : "inherit",
        font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  return (
    <Card title="Team Comparison" meta={dimLabel}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        {/* Grouping dimension */}
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, border: `1px solid rgba(${isDark ? "255,255,255" : "20,20,40"},0.10)` }}>
          {seg("squad", dim, setDim, "Squad")}
          {seg("unit", dim, setDim, "Unit")}
          {seg("group", dim, setDim, "Position")}
        </div>
        {/* Metric */}
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, border: `1px solid rgba(${isDark ? "255,255,255" : "20,20,40"},0.10)` }}>
          {(["power", "accuracy", "reaction"] as const).map((m) => seg(m, metric, setMetric, `${MODE_BY_KEY[m].icon} ${MODE_BY_KEY[m].label}`))}
        </div>
      </div>
      {groups.map((t) => (
        <div key={t.name} className="dm-teamCompareRow">
          <div className="dm-teamCompareName">
            {t.name}
            <div style={{ fontSize: 10, opacity: 0.45, fontWeight: 500 }}>{t.n} athlete{t.n !== 1 ? "s" : ""}</div>
          </div>
          <div className="dm-teamCompareBarWrap">
            <div className="dm-teamCompareBar" style={{ width: `${Math.max(8, Math.min(100, barPct(t.val)))}%`, background: `linear-gradient(90deg, ${accent}55, ${accent})` }} />
          </div>
          <div className="dm-teamCompareVal">
            {t.val}
            <span style={{ fontSize: 9, opacity: 0.45 }}>{unit}</span>
          </div>
        </div>
      ))}
      <div className="ts-cardHint">
        {metric === "reaction"
          ? "Ranked fastest first — lower reaction time is better."
          : `Mean ${metric} per ${dim === "squad" ? "squad" : dim === "unit" ? "unit" : "position group"}, ranked best first.`}
      </div>
    </Card>
  );
}

function FatigueCard({ isDark }: { isDark: boolean }) {
  const alerts = [...ROSTER].filter((a) => a.volume.slope < -2).sort((a, b) => a.volume.slope - b.volume.slope).slice(0, 5);
  // Longitudinal curve for the most-fatigued athlete (session-over-session slope)
  const focus = alerts[0] ?? ROSTER[0];
  const curve = useMemo(() => {
    const rnd = mulberry32(focus.seed ^ 0xfa71);
    const base = focus.volume.slope;
    return Array.from({ length: 8 }, (_, i) => Math.round((base - 1 + rnd() * 2 - i * 0.15) * 10) / 10);
  }, [focus]);
  const min = Math.min(...curve), max = Math.max(...curve);
  const range = Math.max(max - min, 1);
  const W = 320, H = 90;
  const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * W},${H - ((v - min) / range) * (H - 12) - 6}`).join(" ");

  return (
    <Card
      title="Fatigue Tracker"
      meta={`${alerts.length} athletes flagged`}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Roster alert */}
        <div>
          <div className="ts-pillLabel" style={{ marginBottom: 8 }}>Roster fatigue alert · SI slope &lt; −2 / window</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a) => (
              <div key={a.id} className="dm-fatigueRow">
                <div className="ts-recentSessionAvatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(a)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fullName(a)}</div>
                  <div style={{ fontSize: 11, opacity: 0.55 }}>{a.pos} · {a.team} · +{a.analysis.reactionDeltaMs}ms drift</div>
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "rgba(255,120,100,0.95)", fontSize: 14 }}>
                  {a.volume.slope} <span style={{ fontSize: 9, opacity: 0.6 }}>SI/win</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Longitudinal curve */}
        <div>
          <div className="ts-pillLabel" style={{ marginBottom: 8 }}>Longitudinal curve · {fullName(focus)}</div>
          <div style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid rgba(${isDark ? "255,255,255" : "20,20,40"},0.08)`, background: `rgba(${isDark ? "255,255,255" : "20,20,40"},0.02)` }}>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
              <line x1="0" y1={H - ((0 - min) / range) * (H - 12) - 6} x2={W} y2={H - ((0 - min) / range) * (H - 12) - 6} stroke={isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,40,0.12)"} strokeDasharray="4 4" />
              <polyline points={pts} fill="none" stroke="#ff6a5f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {curve.map((v, i) => (
                <circle key={i} cx={(i / (curve.length - 1)) * W} cy={H - ((v - min) / range) * (H - 12) - 6} r="3" fill="#ff6a5f" />
              ))}
            </svg>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, lineHeight: 1.5 }}>
              Slope has steepened over the last 8 sessions — a load-management flag, not a one-off bad day. Deload recommended.
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Individual Athletes — roster list + in-depth analysis
// ─────────────────────────────────────────────────────────────────────────────
function AthletesTab({ isDark, tier, can }: { isDark: boolean; tier: TierNum; can: (f: Feature) => boolean }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(ROSTER[0].id);
  const filtered = ROSTER.filter((a) => fullName(a).toLowerCase().includes(query.toLowerCase()) || a.pos.toLowerCase().includes(query.toLowerCase()));
  const athlete = ROSTER.find((a) => a.id === selectedId) ?? ROSTER[0];

  return (
    <div className="ts-dashGrid ts-dashMain">
      {/* Roster list */}
      <Card title="Roster" meta={`${ROSTER.length} athletes`}>
        <div className="ts-athleteFilterBar">
          <svg className="ts-athleteFilterIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            className="ts-athleteFilterInput"
            placeholder="Filter by name or position…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="ts-athleteFilterClear" onClick={() => setQuery("")} type="button">
              ✕
            </button>
          )}
        </div>
        <div className="ts-athleteList" style={{ maxHeight: 520 }}>
          {filtered.map((a) => {
            const selected = a.id === selectedId;
            return (
              <div
                key={a.id}
                className="ts-athleteRow"
                style={selected ? { borderColor: "rgba(180,0,255,0.45)", background: "rgba(180,0,255,0.08)" } : undefined}
                onClick={() => setSelectedId(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(a.id);
                  }
                }}
              >
                <div className="ts-athleteAvatar">{initials(a)}</div>
                <div className="ts-athleteInfo">
                  <div className="ts-athleteName">{fullName(a)}</div>
                  <div className="ts-athleteMeta">{a.pos} · {a.group} · {a.team}</div>
                </div>
                <div className="ts-athletePills">
                  {a.injury && <InjuryBadge injury={a.injury} compact />}
                  <span className="ts-athletePill ts-modePill ts-modePill--power">
                    <span className="ts-pillLabel">SI</span> {a.power.avg}
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="ts-athleteEmpty">No athletes match “{query}”.</div>}
        </div>
      </Card>

      {/* In-depth analysis */}
      <Card title="In-Depth Analysis" meta={fullName(athlete)}>
        <AthleteAnalysis athlete={athlete} isDark={isDark} tier={tier} can={can} />
      </Card>
    </div>
  );
}

// ── AI analysis — deterministic trend/technique read + a mode recommendation ──
type AiFinding = { label: string; value: string; dir: "up" | "down" | "flat" };
type AiRec = { mode: ModeKey; why: string };
type AiAnalysis = { summary: string; findings: AiFinding[]; primary: AiRec; secondary?: AiRec };

// Scores each axis's weakness, surfaces the trends behind the numbers, and maps
// the biggest gap to the mode that trains it. Rules-based (not an LLM) so it's
// reproducible and can't hallucinate — the "automated coaching intelligence"
// framing from the tier plan.
function analyzeAthlete(a: Athlete): AiAnalysis {
  const biasLabel =
    a.analysis.avgAngle > 12 ? "crosses centre line"
      : a.analysis.avgAngle < -12 ? "pulls to one side"
      : "balanced";

  const findings: AiFinding[] = [
    {
      label: "Power trend",
      value: `${a.power.delta >= 0 ? "+" : ""}${a.power.delta}% SI · ${a.analysis.fatigueNote}`,
      dir: a.analysis.fatigueNote.includes("up") ? "up" : a.analysis.fatigueNote.includes("down") ? "down" : "flat",
    },
    {
      label: "Consistency",
      value: `${a.analysis.consistency}% floor`,
      dir: a.analysis.consistency >= 80 ? "up" : a.analysis.consistency >= 65 ? "flat" : "down",
    },
    {
      label: "Reaction drift",
      value: `+${a.analysis.reactionDeltaMs} ms late-session`,
      dir: a.analysis.reactionDeltaMs <= 50 ? "up" : a.analysis.reactionDeltaMs <= 90 ? "flat" : "down",
    },
    {
      label: "Strike angle",
      value: `${a.analysis.avgAngle}° · ${biasLabel}`,
      dir: Math.abs(a.analysis.avgAngle) > 12 ? "down" : "up",
    },
  ];

  // Weakness scores — higher = bigger opportunity.
  const scored = [
    { key: "reaction", w: (a.reaction.avg - 260) / 90 + a.analysis.reactionDeltaMs / 90 },
    { key: "accuracy", w: (86 - a.accuracy.pct) / 14 + a.accuracy.offset / 5 },
    { key: "consistency", w: (80 - a.analysis.consistency) / 22 },
    { key: "angle", w: Math.abs(a.analysis.avgAngle) / 16 },
    { key: "fatigue", w: a.volume.slope < -4 ? (Math.abs(a.volume.slope) - 4) / 3 + 0.9 : -1 },
  ].sort((x, y) => y.w - x.w);

  const recFor = (key: string): AiRec => {
    switch (key) {
      case "reaction":
        return { mode: "reaction", why: `${a.first}'s cue-to-impact latency (${a.reaction.avg} ms) and +${a.analysis.reactionDeltaMs} ms late-session drift are the biggest gap. Program Reaction sets early while fresh and cap them at ~40 reps to hold response speed.` };
      case "accuracy":
        return { mode: "accuracy", why: `Placement is the soft axis (${a.accuracy.pct}%, ${a.accuracy.offset} cm off centre). Accuracy mode scores every strike by distance from the bullseye — the fastest way to tighten it.` };
      case "consistency":
        return { mode: "power", why: `Consistency is low (${a.analysis.consistency}% floor) — big strike-to-strike swings. Power-interval work with 8-count continuous combos raises the floor without chasing peaks.` };
      case "angle":
        return { mode: "target", why: `A directional skew of ${a.analysis.avgAngle}° repeats across sessions. Target mode's zone cues force varied strike angles — pair it with the Strike Compass to correct the bias.` };
      case "fatigue":
        return { mode: "volume", why: `SI is dropping ${a.volume.slope}/window under load. Shorten Volume windows to 4 s with 30 s rest to build work capacity without the late-session fade.` };
      default:
        return { mode: "power", why: "Balanced profile — keep progressing Power volume." };
    }
  };

  const focusName =
    scored[0].key === "consistency" ? "consistency"
      : scored[0].key === "angle" ? "strike angle"
      : scored[0].key === "fatigue" ? "fatigue resistance"
      : scored[0].key;

  const trendWord = a.analysis.fatigueNote.includes("up") ? "climbing" : a.analysis.fatigueNote.includes("down") ? "sliding" : "holding steady";

  return {
    summary: `${a.first}'s output is ${trendWord}. Across four sessions the clearest opportunity is ${focusName} — the recommended focus below trains exactly that.`,
    findings,
    primary: recFor(scored[0].key),
    secondary: scored[1].w > 0.6 ? recFor(scored[1].key) : undefined,
  };
}

function AiRecChip({ rec, primary, isDark }: { rec: AiRec; primary: boolean; isDark: boolean }) {
  const m = MODE_BY_KEY[rec.mode];
  const ink = isDark ? "255,255,255" : "20,20,40";
  return (
    <div
      style={{
        display: "flex",
        gap: 11,
        padding: "11px 13px",
        borderRadius: 12,
        border: `1px solid ${m.accent}${primary ? "88" : "44"}`,
        background: `${m.accent}${primary ? (isDark ? "22" : "18") : (isDark ? "14" : "10")}`,
      }}
    >
      <span
        className={`ts-athletePill ts-modePill ${m.pill}`}
        style={{ alignSelf: "flex-start", flexShrink: 0 }}
      >
        <span aria-hidden="true">{m.icon}</span> {m.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.5, marginBottom: 3 }}>
          {primary ? "Recommended focus" : "Also worth a block"}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: `rgba(${ink},0.85)` }}>{rec.why}</div>
      </div>
    </div>
  );
}

function AiAnalysisBlock({ athlete, isDark }: { athlete: Athlete; isDark: boolean }) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  const a = analyzeAthlete(athlete);
  const dirColor = (d: AiFinding["dir"]) =>
    d === "up" ? (isDark ? "rgba(80,220,160,0.95)" : "rgba(20,140,90,0.95)")
      : d === "down" ? (isDark ? "rgba(255,110,90,0.95)" : "rgba(200,50,40,0.95)")
      : `rgba(${ink},0.8)`;
  const dirGlyph = (d: AiFinding["dir"]) => (d === "up" ? "▲" : d === "down" ? "▼" : "→");

  return (
    <div style={{ borderRadius: 14, border: "1px solid rgba(180,0,255,0.30)", overflow: "hidden", background: `rgba(${ink},${isDark ? "0.02" : "0.015"})` }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 14px",
          background: "linear-gradient(120deg, rgba(180,0,255,0.18), rgba(180,0,255,0.05))",
          borderBottom: "1px solid rgba(180,0,255,0.22)",
          color: isDark ? "rgba(215,150,255,0.98)" : "rgba(120,0,200,0.95)",
        }}
      >
        <IconSpark size={15} />
        <span style={{ fontSize: 13, fontWeight: 800 }}>AI Analysis</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 999, border: "1px solid rgba(180,0,255,0.35)", background: "rgba(180,0,255,0.12)", marginLeft: "auto" }}>
          Auto
        </span>
      </div>

      <div style={{ padding: "12px 14px" }}>
        {/* Trend summary */}
        <div style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.85, marginBottom: 12 }}>{a.summary}</div>

        {/* Trend / technique signals */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.45, marginBottom: 8 }}>
          Trends spotted
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {a.findings.map((f, i) => (
            <div key={i} style={{ padding: "8px 11px", borderRadius: 10, border: `1px solid rgba(${ink},0.08)`, background: `rgba(${ink},0.02)` }}>
              <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.45, marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: dirColor(f.dir), display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 9 }}>{dirGlyph(f.dir)}</span> {f.value}
              </div>
            </div>
          ))}
        </div>

        {/* Recommendations */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.45, marginBottom: 8 }}>
          Which mode will help
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AiRecChip rec={a.primary} primary isDark={isDark} />
          {a.secondary && <AiRecChip rec={a.secondary} primary={false} isDark={isDark} />}
        </div>
      </div>
    </div>
  );
}

// Season-long Strength Index timeline: one point per week, PR / slump markers,
// and shaded bands for weeks missed to injury. This is the "highs and lows".
function SeasonTimeline({ athlete, isDark }: { athlete: Athlete; isDark: boolean }) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  const s = athlete.season;
  const played = s.filter((p) => p.si > 0);
  const max = Math.max(...played.map((p) => p.si));
  const min = Math.min(...played.map((p) => p.si));
  const range = Math.max(max - min, 1);
  const W = 520, H = 130, padL = 10, padR = 10, padT = 16, padB = 22;
  const x = (w: number) => padL + ((w - 1) / (SEASON_WEEKS - 1)) * (W - padL - padR);
  const y = (si: number) => padT + (1 - (si - min) / range) * (H - padT - padB);

  // Connect only played weeks; a gap (injury) breaks the line into segments.
  const segments: SeasonPoint[][] = [];
  let cur: SeasonPoint[] = [];
  for (const p of s) {
    if (p.si > 0) cur.push(p);
    else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);

  const hi = seasonHigh(athlete);
  const lo = seasonLow(athlete);
  const injuryWeeks = s.filter((p) => p.sessions === 0).map((p) => p.week);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      {/* injury bands */}
      {injuryWeeks.map((w) => (
        <rect key={`inj${w}`} x={x(w) - (W - padL - padR) / (SEASON_WEEKS - 1) / 2} y={padT - 6}
          width={(W - padL - padR) / (SEASON_WEEKS - 1)} height={H - padT - padB + 12}
          fill="rgba(255,80,80,0.10)" stroke="rgba(255,80,80,0.22)" strokeDasharray="2 3" />
      ))}
      {/* season high / low guide lines */}
      <line x1={padL} y1={y(hi.si)} x2={W - padR} y2={y(hi.si)} stroke="rgba(80,220,160,0.35)" strokeDasharray="3 4" />
      <line x1={padL} y1={y(lo.si)} x2={W - padR} y2={y(lo.si)} stroke="rgba(255,120,100,0.30)" strokeDasharray="3 4" />
      {/* line segments */}
      {segments.map((seg, si) => (
        <polyline key={si} fill="none" stroke="#b400ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          points={seg.map((p) => `${x(p.week)},${y(p.si)}`).join(" ")} />
      ))}
      {/* week markers */}
      {played.map((p) => {
        const isHi = p.week === hi.week, isLo = p.week === lo.week;
        const fill = p.note === "PR" || isHi ? "#50dca0" : p.note === "Slump" || isLo ? "#ff6a5f" : "#b400ff";
        return (
          <g key={p.week}>
            <circle cx={x(p.week)} cy={y(p.si)} r={isHi || isLo || p.note ? 3.6 : 2.4} fill={fill} />
            {p.note === "PR" && <text x={x(p.week)} y={y(p.si) - 8} textAnchor="middle" fontSize="8" fontWeight="800" fill="#50dca0">PR</text>}
            {p.note === "Return" && <text x={x(p.week)} y={y(p.si) - 8} textAnchor="middle" fontSize="8" fontWeight="800" fill="rgba(80,220,160,0.95)">RET</text>}
          </g>
        );
      })}
      {/* x-axis week labels (every 4th) */}
      {[1, 5, 9, 13, SEASON_WEEKS].map((w) => (
        <text key={`x${w}`} x={x(w)} y={H - 6} textAnchor="middle" fontSize="8" fill={`rgba(${ink},0.4)`}>W{w}</text>
      ))}
    </svg>
  );
}

function AthleteAnalysis({ athlete, isDark, tier, can }: { athlete: Athlete; isDark: boolean; tier: TierNum; can: (f: Feature) => boolean }) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`;
  const [section, setSection] = useState<"power" | "accuracy" | "reaction" | "form">("power");

  const totalSessions = athlete.power.sessions + athlete.accuracy.sessions + athlete.reaction.attempts / 12;
  const totalStrikes = athlete.power.sessions * 110 + athlete.reaction.attempts + athlete.accuracy.sessions * 85;

  // Sparkline
  const values = athlete.analysis.strengthTrend;
  const W = 180, H = 42;
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(max - min, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - ((v - min) / range) * (H - 6) - 3}`).join(" ");

  // Tier I: profile + history only. Axis breakdown accordion is Tier II+.
  const sections: { key: "power" | "accuracy" | "reaction" | "form"; icon: string; label: string; accent: string; accentBg: string; accentBdr: string }[] = [
    { key: "power", icon: "💥", label: "Power", accent: "#b400ff", accentBg: "rgba(180,0,255,0.09)", accentBdr: "rgba(180,0,255,0.25)" },
    { key: "accuracy", icon: "🎯", label: "Accuracy", accent: "#00dcff", accentBg: "rgba(0,220,255,0.07)", accentBdr: "rgba(0,220,255,0.22)" },
    { key: "reaction", icon: "⚡️", label: "Reaction", accent: "#ffcc00", accentBg: "rgba(255,200,0,0.07)", accentBdr: "rgba(255,200,0,0.22)" },
    { key: "form", icon: "📐", label: "Form & Angle", accent: isDark ? "rgba(255,255,255,0.8)" : "rgba(20,20,40,0.8)", accentBg: `rgba(${ink},0.05)`, accentBdr: `rgba(${ink},0.14)` },
  ];

  return (
    <div>
      {/* Profile header — always visible (Tier I) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div className="ts-athleteAvatar" style={{ width: 52, height: 52, fontSize: 17 }}>{initials(athlete)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{fullName(athlete)}</div>
            {athlete.injury && <InjuryBadge injury={athlete.injury} />}
          </div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{athlete.pos} · {athlete.group} · {athlete.unit} · {athlete.team}</div>
        </div>
      </div>

      {/* Injury note banner */}
      {athlete.injury && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14,
          padding: "10px 13px", borderRadius: 12,
          border: `1px solid ${INJURY_COLOR[athlete.injury.status].border}`,
          background: INJURY_COLOR[athlete.injury.status].bg,
        }}>
          <span style={{ fontSize: 15 }} aria-hidden="true">🩹</span>
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            <b>{athlete.injury.status} — {athlete.injury.area}.</b> {athlete.injury.note}.{" "}
            <span style={{ opacity: 0.7 }}>Flagged week {athlete.injury.sinceWeek} · {athlete.injury.gamesMissed} game{athlete.injury.gamesMissed !== 1 ? "s" : ""} missed.</span>
          </div>
        </div>
      )}

      {/* Overview strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderRadius: 10, overflow: "hidden", border: divider, marginBottom: 14 }}>
        {[
          { label: "Sessions", value: String(Math.round(totalSessions)) },
          { label: "Strikes", value: totalStrikes.toLocaleString() },
          { label: "Avg SI", value: String(athlete.power.avg) },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ padding: "10px 12px", borderRight: i < arr.length - 1 ? divider : "none", background: `rgba(${ink},${isDark ? "0.03" : "0.02"})` }}>
            <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Season timeline — highs & lows across the year (Tier I: session history) */}
      {(() => {
        const hi = seasonHigh(athlete);
        const lo = seasonLow(athlete);
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <div className="ts-pillLabel">Season · Strength Index by week</div>
              <div style={{ display: "flex", gap: 10, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: isDark ? "rgba(80,220,160,0.95)" : "rgba(20,140,90,0.95)" }}>▲ High {hi.si} (W{hi.week})</span>
                <span style={{ color: isDark ? "rgba(255,120,100,0.95)" : "rgba(200,50,40,0.95)" }}>▼ Low {lo.si} (W{lo.week})</span>
              </div>
            </div>
            <div style={{ padding: "8px 10px 2px", borderRadius: 12, border: divider, background: `rgba(${ink},${isDark ? "0.02" : "0.015"})` }}>
              <SeasonTimeline athlete={athlete} isDark={isDark} />
            </div>
          </div>
        );
      })()}

      {/* Axis breakdown — Tier II+ */}
      <LockGate
        locked={!can("athleteAxisBreakdown")}
        requiredTier={FEATURE_MIN_TIER.athleteAxisBreakdown}
        title="Per-axis athlete analysis"
        body="Force, placement and timing scored and banded independently — weakest axis surfaced first as “Focus here”, with consistency, cadence and spatial bias. Two axes describe a line; three describe a shape."
      >
        <>
          {/* Accordion tabs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 12 }}>
            {sections.map((sec) => {
              const active = section === sec.key;
              return (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => setSection(sec.key)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    padding: "8px 4px",
                    borderRadius: 10,
                    border: active ? `1px solid ${sec.accentBdr}` : `1px solid rgba(${ink},0.10)`,
                    background: active ? sec.accentBg : `rgba(${ink},${isDark ? "0.03" : "0.02"})`,
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{sec.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: active ? sec.accent : `rgba(${ink},0.55)` }}>{sec.label}</span>
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <div>
            {section === "power" && (
              <>
                <StatRow label="Consistency score" value={`${athlete.analysis.consistency}%`} sub="avg/peak ratio" highlight={athlete.analysis.consistency >= 80 ? "good" : athlete.analysis.consistency >= 65 ? "warn" : "bad"} ink={ink} divider={divider} />
                <StatRow label="Latest peak index" value={String(athlete.power.peak)} sub="/ 1000" highlight={athlete.power.peak >= 750 ? "good" : "warn"} ink={ink} divider={divider} />
                <StatRow label="Session trend" value={athlete.analysis.fatigueNote} highlight={athlete.analysis.fatigueNote.includes("up") ? "good" : athlete.analysis.fatigueNote.includes("down") ? "bad" : "warn"} ink={ink} divider={divider} />
                <StatRow label="Avg cadence" value={`${athlete.analysis.cadenceHz} Hz`} ink={ink} divider={divider} />
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6 }}>Peak strength index over time</div>
                  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
                    <polyline points={pts} fill="none" stroke="#b400ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                    {values.map((v, i) => (
                      <circle key={i} cx={(i / (values.length - 1)) * W} cy={H - ((v - min) / range) * (H - 6) - 3} r="2.5" fill="#b400ff" opacity="0.7" />
                    ))}
                  </svg>
                </div>
                <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: "rgba(180,0,255,0.08)", border: "1px solid rgba(180,0,255,0.18)", fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                  {athlete.analysis.consistency < 65
                    ? `Consistency is low (${athlete.analysis.consistency}%). Drill 8-count continuous combos to raise the floor.`
                    : athlete.analysis.fatigueNote.includes("down")
                    ? "Output trending down. Prioritise recovery and quality over quantity next session."
                    : athlete.analysis.fatigueNote.includes("up")
                    ? "Strength trending up. Add 10% volume or intensity next session."
                    : "Output is stable. Introduce power-interval training to break the plateau."}
                </div>
              </>
            )}
            {section === "accuracy" && (
              <>
                <StatRow label="Accuracy score" value={`${athlete.accuracy.pct}%`} highlight={athlete.accuracy.pct >= 85 ? "good" : athlete.accuracy.pct >= 75 ? "warn" : "bad"} ink={ink} divider={divider} />
                <StatRow label="Avg offset from centre" value={`${athlete.accuracy.offset} cm`} highlight={athlete.accuracy.offset <= 3 ? "good" : "warn"} ink={ink} divider={divider} />
                <StatRow label="Trend" value={`${athlete.accuracy.delta >= 0 ? "+" : ""}${athlete.accuracy.delta}%`} highlight={athlete.accuracy.delta >= 0 ? "good" : "bad"} ink={ink} divider={divider} />
                <StatRow label="Sessions" value={String(athlete.accuracy.sessions)} ink={ink} divider={divider} />
              </>
            )}
            {section === "reaction" && (
              <>
                <StatRow label="Avg reaction" value={`${athlete.reaction.avg} ms`} highlight={athlete.reaction.avg <= 300 ? "good" : athlete.reaction.avg <= 350 ? "warn" : "bad"} ink={ink} divider={divider} />
                <StatRow label="Best reaction" value={`${athlete.reaction.best} ms`} highlight="good" ink={ink} divider={divider} />
                <StatRow label="Late-session drift" value={`+${athlete.analysis.reactionDeltaMs} ms`} highlight={athlete.analysis.reactionDeltaMs <= 50 ? "good" : athlete.analysis.reactionDeltaMs <= 90 ? "warn" : "bad"} ink={ink} divider={divider} />
                <StatRow label="Attempts" value={String(athlete.reaction.attempts)} ink={ink} divider={divider} />
              </>
            )}
            {section === "form" && (
              <LockGate
                locked={!can("athleteLongitudinal")}
                requiredTier={FEATURE_MIN_TIER.athleteLongitudinal}
                title="Form & angle — longitudinal"
                body="Average incoming angle, directional bias detection, and drift tracked across the athlete's full history. Needs the unlimited history window Intelligence unlocks."
              >
                <>
                  <StatRow label="Avg incoming angle" value={`${athlete.analysis.avgAngle}°`} ink={ink} divider={divider} />
                  <StatRow label="Directional bias" value={athlete.analysis.avgAngle > 12 ? "Crosses centre line" : athlete.analysis.avgAngle < -12 ? "Pulls left" : "Balanced"} highlight={Math.abs(athlete.analysis.avgAngle) > 12 ? "warn" : "good"} ink={ink} divider={divider} />
                  <div style={{ marginTop: 14, padding: "9px 10px", borderRadius: 8, background: `rgba(${ink},0.04)`, border: `1px solid rgba(${ink},0.10)`, fontSize: 11, lineHeight: 1.6, opacity: 0.85 }}>
                    {Math.abs(athlete.analysis.avgAngle) > 12
                      ? "Consistent directional skew detected. Mix in mirror-side reps to even out the strike angle."
                      : "Angle distribution is balanced across the bag — no correction needed."}
                  </div>
                </>
              </LockGate>
            )}
          </div>
        </>
      </LockGate>

      {/* AI analysis — Tier III */}
      <div style={{ marginTop: 16 }}>
        <LockGate
          locked={!can("aiInsights")}
          requiredTier={FEATURE_MIN_TIER.aiInsights}
          title="AI analysis"
          body="Automated trend detection across this athlete's performance and technique, plus a recommendation for which impact mode will move the needle fastest — reproducible, not a guess."
        >
          <AiAnalysisBlock athlete={athlete} isDark={isDark} />
        </LockGate>
      </div>

      {tier === 1 && (
        <div className="ts-cardHint">
          <LockChip>Full per-axis breakdown, consistency and angle analysis unlock at {TIERS[1].label} — Analysis.</LockChip>
        </div>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  sub,
  highlight,
  ink,
  divider,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "good" | "warn" | "bad";
  ink: string;
  divider: string;
}) {
  const dark = ink === "255,255,255";
  const valColor =
    highlight === "good" ? (dark ? "rgba(80,220,160,0.95)" : "rgba(20,140,90,0.95)")
      : highlight === "warn" ? (dark ? "rgba(255,200,60,0.95)" : "rgba(180,120,0,0.95)")
      : highlight === "bad" ? (dark ? "rgba(255,100,80,0.95)" : "rgba(180,50,30,0.95)")
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

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Export & API
// ─────────────────────────────────────────────────────────────────────────────
function ExportTab({ isDark, tier, can }: { isDark: boolean; tier: TierNum; can: (f: Feature) => boolean }) {
  const ink = isDark ? "255,255,255" : "20,20,40";
  const divider = `1px solid rgba(${ink},${isDark ? "0.07" : "0.08"})`;

  return (
    <div className="ts-dashGrid ts-dashMain">
      {/* CSV export — Tier II */}
      <div className="ts-span2">
        <LockGate
          locked={!can("csvExport")}
          requiredTier={FEATURE_MIN_TIER.csvExport}
          title="Session-summary CSV export"
          body="One row per session — date, athlete, mode, strikes, duration, avg & peak SI, cadence, accuracy and reaction aggregates — scoped to your program and the current filters."
        >
          <Card title="Session-Summary CSV Export" meta="Tier II · one row per session">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.55 }}>
                    {["Date", "Athlete", "Mode", "Strikes", "Duration", "Avg SI", "Peak SI", "Cadence"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", borderBottom: divider, whiteSpace: "nowrap", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RECENT_SESSIONS.map((s) => (
                    <tr key={s.id}>
                      <td style={{ padding: "8px 12px", borderBottom: divider, whiteSpace: "nowrap" }}>{s.when}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider, whiteSpace: "nowrap" }}>{fullName(s.athlete)}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{MODE_BY_KEY[s.mode].label}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{s.numEvents}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{fmtDuration(s.durationMs)}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{s.avgSi}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{s.peakSi}</td>
                      <td style={{ padding: "8px 12px", borderBottom: divider }}>{s.cadenceHz} Hz</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
              <button type="button" className="ts-btn ts-btnSecondary" disabled title="Read-only demo" style={{ opacity: 0.6, cursor: "not-allowed" }}>
                ⬇ Download CSV
              </button>
              <span style={{ fontSize: 12, opacity: 0.5 }}>Disabled in this read-only demo. Export is capped at your tier's history window.</span>
            </div>
          </Card>
        </LockGate>
      </div>

      {/* Raw export — Tier III */}
      <LockGate
        locked={!can("rawExport")}
        requiredTier={FEATURE_MIN_TIER.rawExport}
        title="Raw session export"
        body="Full NDJSON and per-cell event_cells data — the underlying stream a program builds its own analysis pipeline on, beyond the session-summary CSV."
      >
        <Card title="Raw Session Export" meta="Tier III · NDJSON + event_cells">
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.6, padding: "12px 14px", borderRadius: 12, border: divider, background: `rgba(${ink},0.02)`, overflowX: "auto", whiteSpace: "pre" }}>
{`{"event_id":"e_8f21","t_ms":1420,"si":812,"peak_force_n":2840,
 "angle_deg":12,"cells":[{"r":6,"c":4,"mv":812},{"r":6,"c":5,"mv":640}]}
{"event_id":"e_8f22","t_ms":1930,"si":775,"peak_force_n":2610,
 "angle_deg":-8,"cells":[{"r":7,"c":4,"mv":770}]}`}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" className="ts-btn ts-btnSecondary" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>⬇ Export NDJSON</button>
            <button type="button" className="ts-btn ts-btnGhost" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>⬇ event_cells CSV</button>
          </div>
        </Card>
      </LockGate>

      {/* API access — Tier III */}
      <LockGate
        locked={!can("apiAccess")}
        requiredTier={FEATURE_MIN_TIER.apiAccess}
        title="API connection support"
        body="Per-program API keys, program-scoped read endpoints, per-key rate limiting, and an optional session-complete webhook — the integration surface strength-and-conditioning platforms expect."
      >
        <Card title="API Access" meta="Tier III · per-program keys">
          <div className="ts-pillLabel" style={{ marginBottom: 8 }}>API key</div>
          <div className="dm-keyRow">
            <span style={{ flex: 1, opacity: 0.8 }}>ts_live_sk_••••••••••••••••••••4e7a</span>
            <span className="dm-lockBadge">read-only</span>
          </div>
          <div className="ts-pillLabel" style={{ margin: "16px 0 8px" }}>Program-scoped endpoints</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              "/v1/sessions",
              "/v1/session-summaries",
              "/v1/events",
              "/v1/athletes",
              "/v1/teams",
            ].map((ep) => (
              <div key={ep} className="dm-endpoint">
                <span className="dm-verb">GET</span>
                <span style={{ opacity: 0.85 }}>{ep}</span>
              </div>
            ))}
          </div>
          <div className="ts-cardHint">Rate limited per key · usage logged · optional webhook on session completion.</div>
        </Card>
      </LockGate>
    </div>
  );
}
