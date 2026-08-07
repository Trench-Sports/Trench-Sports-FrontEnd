// src/content/useCases.ts
// All audience use-case pages' copy as typed, serializable data — the single
// edit surface for content revisions. No JSX lives here: device visuals are
// referenced by a `VisualKey` string that useCaseVisuals.tsx resolves against
// its component registry, so this file stays a plain data module.
//
// Adding a fifth audience = one entry in USE_CASES + one route. Nothing else.

// Real app screenshots (Teamworks-style). Captured by scripts/capture-usecase-shots.mjs
// from the /dummy demo dashboard — re-run that script to refresh when the UI changes.
import coachDashboardShot from "../assets/useCases/coach-dashboard.png";
import sessionSummaryShot from "../assets/useCases/session-summary.png";
import leaderboardShot from "../assets/useCases/leaderboard.png";
import teamComparisonShot from "../assets/useCases/team-comparison.png";
import exportApiShot from "../assets/useCases/export-api.png";

export type UseCaseSlug = "college" | "pro" | "sports-science" | "facilities";

// Keys into the VISUALS registry in useCaseVisuals.tsx. Keep in sync with it.
export type VisualKey =
  | "coachDashboard"
  | "placementHeatmap"
  | "symmetryPanel"
  | "sessionSummary"
  | "phoneLiveSession"
  | "phoneAthleteProfile"
  | "leaderboard";

export type Cta = { label: string; to: string };

export type OutcomeRow = {
  num: string;
  kicker: string;
  title: string;
  body: string;
  tags: string[];
  visual: VisualKey;              // coded fallback when no `image` is set
  device: "laptop" | "phone";
  image?: string;                 // real app screenshot; takes priority over `visual`
  imageAlt?: string;
};

export type UseCaseContent = {
  slug: UseCaseSlug;
  /** GTM tag → /contact?audience=… */
  audienceTag: string;
  seo: { title: string; description: string; canonical?: string; ogImage?: string };
  hero: {
    kicker: string;
    headline: string;
    sub: string;
    primaryCta: Cta;   // → /contact?audience=…&inquiry=…
    secondaryCta: Cta; // → /dashboard
    stats?: { value: string; label: string }[];
  };
  problem: { kicker: string; title: string; body: string; bullets: string[] };
  workflow: { kicker: string; title: string; steps: { title: string; body: string }[] };
  outcomes: { kicker: string; title: string; rows: OutcomeRow[] };
  proof: { kicker: string; title: string; testimonialNames: string[]; note?: string };
  objections: { q: string; a: string }[];
  closing: { title: string; body: string; ctaLabel: string };
};

// ── Pages ────────────────────────────────────────────────────────────────────
// College is filled in first (Andrew's brief). The other three slots follow the
// same shape once their copy is signed off.

// TODO(Andrew): four items still need your sign-off — none are rendered yet:
//   1. Duke pilot — exact "framed honestly as a pilot" wording (→ proof.note)
//   2. Wake Forest — nameable, or say "a Power-4 S&C staff"?
//   3. Founding-partner line for /college — approved wording, or draft it?
//   4. Stat strip — currently the honest hardware specs; swap if you'd rather.
export const USE_CASES: Partial<Record<UseCaseSlug, UseCaseContent>> = {
  college: {
    slug: "college",
    audienceTag: "College Athletics",
    seo: {
      title: "Contact Data for College Football Programs | Trench Sports",
      description:
        "Measure force, speed, and placement on every contact rep. Objective development and evaluation data for your entire roster.",
      // canonical points at the marketing domain, not the Vercel preview host.
      canonical: "https://trenchsports.ai/college",
    },
    hero: {
      kicker: "College Football",
      headline: "Objective contact data for your entire roster.",
      sub: "Trench measures force, speed, and placement on every contact rep — turning trench work you used to coach by eye into development and evaluation data you can stand behind, across the whole roster.",
      primaryCta: { label: "Request a Demo", to: "/contact?audience=college&inquiry=sales" },
      secondaryCta: { label: "View Demo Dashboard", to: "/dummy" },
      stats: [
        { value: "96", label: "sensor cells per pad" },
        { value: "3,600/sec", label: "peak sampling rate" },
        { value: "<100ms", label: "feedback latency" },
      ],
    },
    problem: {
      kicker: "The Problem Today",
      title: "The trenches are the least-measured part of the game.",
      body: "Weight-room numbers and GPS tell you how much an athlete lifts and how far they run. Neither tells you what happens at the point of contact — the block, the strike, the hand placement that actually decides the rep. That work still gets coached by eye and graded from film, one player at a time, which doesn't scale to a full roster and leaves development and evaluation resting on subjective reads.",
      bullets: [
        "No objective number for force, speed, or placement on a contact rep",
        "Position battles and rep quality graded subjectively, from film",
        "Progress across a season is felt, not measured",
        "No shared, roster-wide record staff and athletes can point to",
      ],
    },
    workflow: {
      kicker: "How It Fits",
      title: "Built to drop into how your program already trains.",
      steps: [
        {
          title: "Mount to any surface",
          body: "The 96-cell pad mounts to a sled, shield, or standard training surface. Battery-powered, no wires, no calibration — set up in seconds before a period.",
        },
        {
          title: "Athletes train at full speed",
          body: "Reps run exactly as they do now. Listen mode idles in the background and captures every significant contact automatically — no wearables, no change to the drill.",
        },
        {
          title: "Staff read the data live",
          body: "Force, speed, and placement land on the coach dashboard the moment a rep finishes, logged to each athlete's profile for the whole roster to review.",
        },
      ],
    },
    outcomes: {
      kicker: "What You Get",
      title: "From one rep to the whole roster — measured the same way.",
      rows: [
        {
          num: "01",
          kicker: "Coach Dashboard",
          title: "See every athlete on one screen.",
          body: "A roster-wide view with per-athlete force, speed, and rep counts updating live. Sort the depth chart by the numbers, compare position groups, and pull up any player's session in a click — evaluation that scales past what film review ever could.",
          tags: ["Roster-wide view", "Live force column", "Session selector"],
          visual: "coachDashboard",
          device: "laptop",
          image: coachDashboardShot,
          imageAlt: "Trench coach dashboard showing a football roster with per-athlete strikes, force, and session type",
        },
        {
          num: "02",
          kicker: "Placement Heatmap",
          title: "Show exactly where the contact lands.",
          body: "Every rep resolves into a hand-placement heatmap across the 96-cell grid, so technique work stops being 'get your hands inside' and becomes something an athlete can see and repeat. Track placement consistency rep over rep, session over session.",
          tags: ["12×8 cell grid", "Placement mapping", "Rep consistency"],
          visual: "placementHeatmap",
          device: "laptop",
          image: sessionSummaryShot,
          imageAlt: "Trench session summary: a hand-placement heatmap with peak force, strength index, cadence, and 3D strike angle",
        },
        {
          num: "03",
          kicker: "Athlete Profile",
          title: "Give players a reason to buy in.",
          body: "Each athlete gets their own profile — force and placement trends, session history, and personal bests they can pull up on their phone. Objective progress they can see turns 'trust me, you're getting better' into proof, and drives the buy-in that makes a program stick.",
          tags: ["Athlete trends", "Session history", "Personal bests"],
          visual: "phoneAthleteProfile",
          device: "phone",
        },
      ],
    },
    proof: {
      kicker: "Proof",
      title: "Players already feel the difference.",
      testimonialNames: ["Tyshon Reed", "Jon Gullette", "Brandon Johnson"],
      // note: TODO(Andrew) — Duke pilot line goes here once wording is approved.
    },
    objections: [
      {
        q: "Is this only useful for linemen?",
        a: "No. Any position with a measurable contact point benefits — DBs and receivers at the catch point, linebackers taking on blocks, backs running through contact. Linemen are the clearest fit because the trenches see contact on every snap, but the pad measures force, speed, and placement for anyone who strikes it.",
      },
      {
        q: "Do athletes have to change how they train?",
        a: "No. The pad mounts to the surfaces you already use and captures contact automatically in the background. Athletes run their normal reps at full intensity — there are no wearables to strap on and nothing new to learn.",
      },
      {
        q: "How long does setup take?",
        a: "Seconds. It's battery-powered with no wires and no calibration step — mount it, connect, and the dashboard starts logging. A staffer can have it running before the period starts.",
      },
    ],
    closing: {
      title: "Put a number on the trenches.",
      body: "See the coach dashboard, the placement heatmaps, and the athlete profiles running on your own roster's data. Request a demo and we'll set it up for your program.",
      ctaLabel: "Request a Demo",
    },
  },

  pro: {
    slug: "pro",
    audienceTag: "Professional Teams",
    seo: {
      title: "Contact Analytics for Professional Teams | Trench Sports",
      description:
        "Per-rep force, speed, and placement metrics that integrate with the AMS stack you already run.",
      canonical: "https://trenchsports.ai/pro",
    },
    hero: {
      kicker: "Professional Football",
      headline: "The contact data your AMS stack is missing.",
      sub: "Your staff already tracks speed, load, and output. Trench adds the one input nobody measures — force, speed, and placement on every contact rep — and feeds it straight into the systems you already run.",
      primaryCta: { label: "Request a Demo", to: "/contact?audience=pro&inquiry=sales" },
      secondaryCta: { label: "View Demo Dashboard", to: "/dummy" },
      stats: [
        { value: "96", label: "sensor cells per pad" },
        { value: "3,600/sec", label: "peak sampling rate" },
        { value: "<100ms", label: "feedback latency" },
      ],
    },
    problem: {
      kicker: "The Problem Today",
      title: "The most-measured athletes on earth, with one blind spot.",
      body: "A pro program tracks everything — GPS load, force plates, sleep, output. But the trenches, where the game is won, are still graded by film and feel. There's no objective per-rep number for what happens at the point of contact, no way to rank or compare the room on it, and whatever you do capture lives in a silo away from the AMS your staff runs every day.",
      bullets: [
        "Every system in the building — except the one measuring contact",
        "Linemen benchmarked by film and feel, not numbers",
        "No objective way to rank or compare the room on contact output",
        "Contact data stuck in a silo, not in your AMS",
      ],
    },
    workflow: {
      kicker: "How It Fits",
      title: "Built to slot into a stack you already run.",
      steps: [
        {
          title: "Add it to the room",
          body: "The 96-cell pad mounts to the sleds, shields, and surfaces your staff already uses. Battery-powered, no wires, no calibration — it's ready before the period starts.",
        },
        {
          title: "Capture every contact rep",
          body: "Athletes train at full speed. Listen mode captures each significant contact automatically — no wearables, no change to the session, no extra load on your staff.",
        },
        {
          title: "Push it to your stack",
          body: "Force, speed, and placement land on the dashboard live, then export by CSV or per-program API into the AMS you already run — one more objective input, not another silo.",
        },
      ],
    },
    outcomes: {
      kicker: "What You Get",
      title: "Rank it, compare it, and pipe it into your systems.",
      rows: [
        {
          num: "01",
          kicker: "Athlete Leaderboard",
          title: "Rank the room by the numbers.",
          body: "A Strength Index leaderboard across the whole roster, per mode — peak and average output, sessions logged, sortable in a click. Settle depth-chart debates with objective contact data instead of film and feel.",
          tags: ["Strength Index 0–1000", "Per-mode ranking", "Whole-roster"],
          visual: "leaderboard",
          device: "laptop",
          image: leaderboardShot,
          imageAlt: "Trench athlete leaderboard ranking football players by strength index across Power sessions",
        },
        {
          num: "02",
          kicker: "Team Comparison",
          title: "Compare squads, units, and position groups.",
          body: "See mean output by squad, unit, or position group, in any mode — how the O-line stacks up against the D-line, Varsity against JV, one position room against the next. Benchmarking your staff can act on.",
          tags: ["Squad / Unit / Position", "Per-mode output", "Head-to-head"],
          visual: "symmetryPanel",
          device: "laptop",
          image: teamComparisonShot,
          imageAlt: "Trench team comparison showing mean power per squad, Varsity versus JV",
        },
        {
          num: "03",
          kicker: "Export & API",
          title: "Plugs into the stack you already run.",
          body: "Session-summary CSV export plus per-program API access and webhooks, so per-rep contact metrics flow into your AMS alongside everything else your staff tracks. No silo, no manual re-entry.",
          tags: ["CSV export", "API & webhooks", "AMS-ready"],
          visual: "sessionSummary",
          device: "laptop",
          image: exportApiShot,
          imageAlt: "Trench session-summary CSV export table with per-session strikes, strength index, and cadence",
        },
      ],
    },
    proof: {
      kicker: "Proof",
      title: "Built for how pros actually train.",
      testimonialNames: ["Vincent Anthony Jr.", "Wes Williams", "Brandon Johnson"],
    },
    objections: [
      {
        q: "We already run an AMS — does this replace it?",
        a: "No — it feeds it. Contact metrics export by CSV and per-program API/webhooks so they land in the AMS your staff already uses. Trench is one more objective input in the system you know, not another platform to log into.",
      },
      {
        q: "How is this different from force plates or GPS?",
        a: "Force plates measure the weight room and GPS measures movement around the field. Neither measures the contact itself — the force, speed, and placement at the point of impact, on every rep. That's the specific gap Trench fills.",
      },
      {
        q: "Will it slow down a pro practice?",
        a: "No. It's battery-powered with no calibration and captures in the background while athletes train at full speed. A staffer sets it up in seconds, and there's nothing for players to wear or operate.",
      },
    ],
    closing: {
      title: "Measure the reps that decide games.",
      body: "See the leaderboard, the team comparisons, and the export running on your own roster's data — then pipe it into the stack you already run. Request a demo and we'll set it up.",
      ctaLabel: "Request a Demo",
    },
  },
};

export function getUseCase(slug: string): UseCaseContent | undefined {
  return USE_CASES[slug as UseCaseSlug];
}
