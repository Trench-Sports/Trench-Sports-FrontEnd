# App Store Connect metadata — Trench Sports iOS

Copy-paste source for the App Store listing. Written for the **coach / program**
buyer, not the individual athlete.

Bundle ID: `com.trenchsports.demo` · Version `1.0` · Build `1`

Every field below is inside Apple's limit. Character counts are stated so you can
see the headroom before editing. **Name, subtitle and keywords are the only
fields Apple indexes for search** — 160 characters total. The description and
promotional text do not affect ranking, so they are written to convert, not to
rank.

---

## App Name — 30 char limit

```
Trench Sports
```

**13 / 30.**

If you want the extra ASO surface, this is the alternative — it keeps "Impact
Data" in the indexed name without reading as keyword stuffing, which Apple now
rejects:

```
Trench Sports: Impact Data
```

**26 / 30.** Recommend the short version for v1. The name is what appears under
the icon in search results, and a clean brand name tests better for a product
whose buyers already know it by name from a sales conversation.

---

## Subtitle — 30 char limit

```
Football impact & force data
```

**28 / 30.**

This is doing real work: it puts **football** into the indexed set, so the
keywords field below does not have to spend 9 characters on it.

Alternatives, if positioning shifts:

| Subtitle | Chars | Use when |
|---|---|---|
| `Contact data for coaching staff` | 31 ❌ | over limit — don't |
| `Measure every rep of contact` | 28 | emphasis on per-rep capture |
| `Impact analytics for programs` | 29 | leans B2B/enterprise |

---

## Promotional Text — 170 char limit

Shown above the description. **Editable without submitting a new build** — use it
for launch news, season timing, and pilot announcements.

```
Now shipping to programs for the 2026 season. Connect a Trench adapter, run a session, and see force, placement and reaction time for every athlete on your roster.
```

**163 / 170.**

Swap-ins for later, no resubmission needed:

- Off-season: `Spring ball starts now. Baseline your roster in one session and track every athlete's Strength Index through camp.` (114)
- After a feature ship: `New: multi-bag sessions. Run up to five adapters at once and capture a full position group in a single period.` (110)

---

## Description — 4,000 char limit

```
The trenches are the least-measured part of football. GPS covers movement. Force plates cover the weight room. Nothing measures the block, the strike, or where the hands actually land.

Trench Sports does.

A Trench adapter mounts to your bag, sled or shield and reads a 96-cell pressure grid. Pair it to this app over Bluetooth and every significant contact is captured as it happens — how hard, how fast, exactly which cells were struck, and at what angle. No wearables on the athlete. No calibration step. No post-processing.

BUILT FOR A COACHING STAFF

Run your roster, not one athlete. Pick a player, queue the rest of the line behind them, and work down the group without touching a menu. Connect up to five adapters at once and the screen splits into a live matrix, each bag colour-matched to its own LED so you always know which tile is which.

FIVE SESSION MODES

Power — every impact captured, force and placement logged live.
Accuracy — each strike scored by how close it lands to the bullseye.
Reaction — wait for the signal, then strike. Time to impact, in milliseconds.
Volume — maximum strikes in five seconds on the cue.
Target — a called zone, then a strike. Reaction and accuracy scored together.

WHAT YOU GET BACK

Strength Index, 0-1000, scores how fast an athlete reaches peak output rather than how long they can lean on the bag — so it reads explosiveness, not bodyweight. Alongside it: reaction time, accuracy and average offset from target, strike rate, and output trend across the windows of a single session.

Session review gives you an impact heatmap with a replay scrubber, a Strike Compass that reconstructs incoming angle in 3D, athlete and team leaderboards per mode, and a Most Improved view that ranks change rather than level — so the athlete quietly improving fastest stops going unnoticed.

WORKS WHERE YOU COACH

Capture runs entirely on the device. Sessions recorded on a field with no signal are held on the phone and upload themselves the moment you are back on a network. Nothing is lost between the practice field and the office.

EXPORT AND INTEGRATE

Pull any filtered view to CSV. On Intelligence-tier programs, read your data programmatically through per-program API keys and a session-complete webhook, so Trench numbers land in the AMS your staff already uses.

REQUIRES TRENCH HARDWARE

This app is the companion to the Trench Sports adapter and sensor pad. Without one it will connect to nothing — there is no standalone mode. Programs subscribe by tier: Foundation, Analysis or Intelligence, which set the session modes, history window and analysis features available to the account. Talk to us at trenchsports.ai.
```

**~2,740 / 4,000.** Deliberate headroom — Apple truncates the visible portion at
about three lines on a phone, so the first two sentences carry the weight and the
rest rewards the reader who taps "more".

### Claims deliberately left out — read before you add anything

| Claim on the website | Why it is not here |
|---|---|
| Newtons of force | `strengthIndexInfo.tsx` says outright there is no honest calibration constant for the resistive sensors and a Newton figure would be "fabricated precision". The app shows volts and Strength Index. Do not put Newtons in a store listing your own code calls fabricated. |
| "3,600 events/second" | That number is cell-samples per second (96 cells × ~37 Hz), not discrete impacts. As written it reads as 3,600 strikes per second. If you want it, say "cell readings", not "events". |
| "<100ms feedback" | Plausible but unmeasured in the repo. Replaced with "as it happens", which is defensible. |
| "2,400,000+ impact events logged" | A landing-page counter. Fine on your own site, but a store listing is a factual representation and this one has no in-app provenance. |
| Accelerometer / impact acceleration | Model V has an ADXL372 fitted but `models.ts` states the firmware does not read it yet. Not a shipping feature. |
| "Fatigue Tracker", injury, return-to-play, rehab | **Your own compliance rule**, enforced in `scripts/capture-usecase-shots.mjs`: that script hard-fails a build if any of `injury\|injuries\|return.to.play\|fatigue\|rehab` appears in a marketing shot. The same rule has to hold for store copy, which is more public than a screenshot. The in-app feature is called "fatigueTracker" internally; the listing calls what it does — "output trend across the windows of a single session" — without the word. This matters beyond your own policy: performance data described in injury terms invites Apple to review the app as a medical device. |
| Duke, Wake Forest, "trusted by D1 / Power 5 / NBA G-League" | All flagged unapproved in `useCases.ts` and the landing logo marquee is commented out. Naming an institution that has not signed off is a legal problem, not just a review one. |

---

## Keywords — 100 char limit

Comma-separated, **no spaces after commas** — a space costs a character and buys
nothing. Do not repeat words already in the app name or subtitle; Apple indexes
those separately and a repeat is a wasted character.

```
strength,conditioning,coach,athlete,roster,leaderboard,bag,sensor,bluetooth,S&C,combine,reps,power
```

**98 / 100.**

Already covered elsewhere and correctly absent here: *trench*, *sports*
(app name), *football*, *impact*, *force*, *data* (subtitle).

Hold these in reserve for a v1.1 keyword test once you have install data:
`sled`, `blocking`, `lineman`, `pads`, `practice`, `velocity`, `explosive`.

---

## What's New — 4,000 char limit

For the 1.0 submission Apple hides this field; it appears from 1.1 onward. Draft
for the first update:

```
First release.

Connect a Trench adapter over Bluetooth and capture force, placement, reaction time and strike angle live. Five session modes, athlete and team leaderboards, impact heatmaps with session replay, and CSV export.
```

---

## URLs

| Field | Value |
|---|---|
| Marketing URL | `https://www.trenchsports.ai` |
| Support URL | `https://www.trenchsports.ai/contact` |
| Privacy Policy URL | `https://www.trenchsports.ai/privacy` |

⚠️ **Support URL is mandatory and Apple loads it.** `/contact` must render a real
way to reach a human — a form that submits, or a visible email address. A page
that 404s or that is behind a login is an automatic 1.5 rejection. Verify it in a
private window before you submit.

---

## Category and ratings

| Field | Value |
|---|---|
| Primary category | Sports |
| Secondary category | Health & Fitness |
| Age rating | 4+ (no objectionable content — answer "None" to every questionnaire item) |
| Content rights | Does not contain, show, or access third-party content |

---

## App Privacy answers

These must match `ios/App/App/PrivacyInfo.xcprivacy` exactly — App Store Connect
cross-checks them and a mismatch is a rejection.

| Data type | Collected | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | App Functionality |
| Name | Yes | Yes | No | App Functionality |
| User ID | Yes | Yes | No | App Functionality |
| Precise location | Yes | Yes | No | App Functionality |
| Product interaction | Yes | Yes | No | Analytics, App Functionality |
| Crash data | Yes | Yes | No | App Functionality |
| Other data (training measurements) | Yes | Yes | No | App Functionality |

Answer **No** to "Do you or your third-party partners use data for tracking?"
Telemetry writes to your own Supabase `app_events` table and is never joined to
third-party advertising data. If an ad SDK is ever added this answer changes and
the app must call `ATTrackingManager` first.

---

## Notes for App Review

Paste this into the **Notes** box. It is the single highest-leverage field in the
submission, because the two things most likely to get this app rejected are both
things a reviewer cannot discover on their own.

```
WHAT THIS APP IS

Trench Sports is the companion app for the Trench Sports training adapter — a Bluetooth LE sensor pad that mounts to a heavy bag, sled or blocking shield and measures the force, placement and timing of each contact. Coaching staffs at football programs use it to record training sessions and review athlete output.

HARDWARE IS REQUIRED — HOW TO REVIEW WITHOUT IT

The capture path needs a physical Trench adapter, which we cannot ship to the review team. So that you can evaluate the full app, we have provided:

1. A demo account (credentials below). Sign in and open Dashboard. It is populated with real recorded sessions and exercises every review, leaderboard, heatmap, replay and export screen without any hardware present.

2. A built-in simulator. From the session screen, the app runs a hit simulator that generates synthetic impacts so the live-capture UI, all five session modes, and the save/discard flow can be exercised end to end on a device with no adapter paired.

If you prefer, we will ship an adapter to the review team overnight — reply on this thread and we will arrange it same day.

DEMO ACCOUNT
  Username: <FILL IN>
  Password: <FILL IN>
This account is provisioned at the Intelligence tier so every gated feature is visible.

PERMISSIONS AND WHY

• Bluetooth — the only way the app receives data from the adapter. Requested when the user taps "Connect to Bag".
• Location (When In Use) — a single GPS fix at session start, so a coach can tell a field session from a weight-room session in the history list. It is a user setting (Session Settings ▸ Location) and can be turned off with no loss of core function. We do not track location in the background or over time.

ACCOUNT DELETION
Accessible in-app at Profile ▸ Edit Profile ▸ Delete account, with a confirmation step. It deletes the account and its associated data, per Guideline 5.1.1(v).

SUBSCRIPTIONS
Program subscriptions (Foundation / Analysis / Intelligence) are sold business-to-business under a contract with the institution — they are not purchasable from inside the app, and the app contains no purchase flow, no pricing, and no links to buy. Access is provisioned by us against the program's account. This is a Guideline 3.1.3(b) "Multiplatform / Enterprise Services" arrangement: the app is a reader for an account the organisation buys elsewhere, in the same way a team-management or athlete-monitoring platform operates.
```

Fill in the demo credentials before submitting. A reviewer who cannot sign in
rejects on Guideline 2.1 the same day, and the resubmission costs you a fresh
review queue.

---

## Residual risk on this submission

### ✅ Resolved: remote-loading

`capacitor.config.ts` used to set `server.url` to `https://www.trenchsports.ai`,
so the shipped binary was a WKWebView browsing the live website. Production
builds now bundle `dist/` and run from `capacitor://localhost`. That closes the
Guideline 2.5.2 exposure — deploys no longer change the reviewed app — and
substantially weakens any 4.2 "repackaged website" argument.

See `RUNBOOK.md` for what bundling costs you operationally. The short version:
firmware now ships inside the IPA, so a firmware bump is an App Store release.

### ⚠️ Open: iPad runs the phone layout

`isMobile()` returns true whenever Capacitor is native, so an iPad renders the
phone UI across a 1024pt screen. There is no iPad breakpoint in `src/`.
Restricting iPad to portrait narrows how bad this looks; it does not fix it.

This is a live **Guideline 4.0** risk, knowingly accepted for 1.0. If review
comes back on it, the fast answer is `TARGETED_DEVICE_FAMILY = "1"` and an
iPhone-only resubmission. Decide whether you'd rather do that or build a tablet
layout *before* the rejection arrives, so the decision isn't made under time
pressure.

### ⚠️ Open: `VITE_OTA_AUTH_SECRET` ships in plaintext

Every `VITE_*` value is inlined into the JavaScript at build time. This one is
now a plaintext string inside an IPA that anyone can unzip. That was already
true of the website bundle, so bundling does not make it worse — but it is the
moment it starts sitting on strangers' phones. Not a blocker for this
submission; worth a real look before the install base grows.
