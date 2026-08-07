# "Who It's For" Use-Case Pages — Build Plan

**Source:** Andrew's brief, `Trench_UseCase_Pages_Brief.docx` (Aug 5, 2026)
**Visual reference:** Teamworks industry pages (`/professional-sports`, `/collegiate-sports`, `/olympics-ngbs`)
**Author:** Jay · Aug 6, 2026 · *plan, not yet built*

---

## 1. What we're building

Four audience pages — `/college`, `/pro`, `/sports-science`, `/facilities` — off **one content-driven template**, plus the homepage cleanup the brief asks for.

The Teamworks pages we're modelling are, structurally, a stack of alternating text/visual rows: hero → social proof strip → three "value pillar" rows where each row pairs a claim with a **dashboard or mobile-app screenshot** → testimonial → success stories → form. That alternating device-visual rhythm is the thing worth stealing. Our aesthetic stays ours: dark `#07070a`, purple radial glows, glass panels, animated mockups.

We already have most of this. `landing.tsx`'s `ts-featureRow` section is the Teamworks pattern — and `.ts-featureRow:nth-child(even)` already flips left/right automatically (`styles.css:3228`). We are extending an existing pattern, not inventing one.

---

## 2. Architecture

### 2.1 New files

| File | Purpose |
|---|---|
| `src/content/useCases.ts` | All four pages' copy as typed data. Single edit surface for Andrew's revisions. |
| `src/pages/useCasePage.tsx` | The one reusable template component. Reads a content object, renders the page. |
| `src/components/deviceFrame.tsx` | `<LaptopFrame>` and `<PhoneFrame>` chrome wrappers. |
| `src/components/useCaseVisuals.tsx` | Animated coach-dashboard, heatmap, session-summary and phone-live-session mockups. |
| `src/hooks/useSeo.ts` | Sets title / description / OG / canonical on mount. |

### 2.2 Files we touch

| File | Change |
|---|---|
| `src/router.tsx` | Four routes under the existing `AppLayout` shell. |
| `src/pages/landing.tsx` | Repoint the four `Learn more→` links (line 528); fix claim language (lines 288–289, 336); optionally add a slim audience nav. |
| `src/pages/contact.tsx` | Read `?audience=` and `?inquiry=`; preselect inquiry type; stamp the audience into the outgoing subject/body. |
| `src/components/platformVisuals.tsx` | Fix the caption at line 169 ("before it shows up as an injury report") and the "Fatigue Index" label at line 133. |
| `src/styles.css` | New `ts-uc-*` block appended, reusing existing tokens. |
| `index.html` | Nothing required — `useSeo` overwrites at runtime. |

### 2.3 Content schema

```ts
// src/content/useCases.ts
export type UseCaseSlug = "college" | "pro" | "sports-science" | "facilities";

export type UseCaseContent = {
  slug: UseCaseSlug;
  audienceTag: string;              // GTM tag → /contact?audience=…
  seo: { title: string; description: string; ogImage?: string };
  hero: {
    kicker: string;                 // "College Athletics"
    headline: string;
    sub: string;
    primaryCta: { label: string; to: string };   // → /contact?audience=…
    secondaryCta: { label: string; to: string }; // → /dashboard
    stats?: { value: string; label: string }[];  // Teamworks-style strip
  };
  problem: { kicker: string; title: string; body: string; bullets: string[] };
  workflow: { kicker: string; title: string; steps: { title: string; body: string }[] };
  outcomes: {                        // alternating device rows — the Teamworks core
    kicker: string;
    title: string;
    rows: {
      num: string;
      kicker: string;
      title: string;
      body: string;
      tags: string[];
      visual: VisualKey;             // keyed into useCaseVisuals registry
      device: "laptop" | "phone";
    }[];
  };
  proof: { kicker: string; title: string; testimonialNames: string[]; note?: string };
  objections: { q: string; a: string }[];
  closing: { title: string; body: string; ctaLabel: string };
};
```

Two supporting registries so content stays serializable (no JSX in the content file):

- `VISUALS: Record<VisualKey, React.ComponentType>` in `useCaseVisuals.tsx`
- Testimonials get lifted out of `landing.tsx` into `src/content/testimonials.ts` and referenced by name, so a quote edit propagates everywhere.

### 2.4 Template section order

Andrew's seven-section template, with the Teamworks device rhythm layered into section 4:

1. **Hero** — headline, subhead, Request Demo, secondary View Demo Dashboard, optional stat strip
2. **The problem today** — their blind spot, in their words
3. **How Trench fits your workflow** — 3 steps, reuses `ts-howGrid`
4. **What you get** — 3 alternating device rows *(this is the Teamworks section)*
5. **Proof** — audience-filtered testimonials
6. **Objections** — 1–2, accordion styled like the contact-page FAQ
7. **Closing CTA band** — reuses `ts-ctaBanner`

---

## 3. The device visuals

Coded mockups, not screenshots — same approach as `platformVisuals.tsx`, so nothing goes stale when the dashboard UI changes and there's no image pipeline to maintain. Real footage swaps into the same slots later.

**`deviceFrame.tsx`**
- `LaptopFrame` — rounded bezel, glass top bar with three dots and a fake URL chip, purple glow behind it (`ts-featureMockupGlow` already does this)
- `PhoneFrame` — 19.5:9 aspect, notch, subtle side-button detail, sits at ~320px wide in a row
- Both accept `children` and a `label` badge (e.g. `LIVE`)

**Mockups** (all pausing off-screen). `useVisible` already exists at `platformVisuals.tsx:14` but is module-private — extract it to `src/hooks/useVisible.ts` and import it in both files rather than duplicating.

| Key | Device | Shows |
|---|---|---|
| `coachDashboard` | laptop | Roster table, per-athlete force column ticking, session selector |
| `placementHeatmap` | laptop | The 12×8 grid resolving into a hand-placement heatmap over reps |
| `symmetryPanel` | laptop | Left/right bars converging, consistency band, red/yellow/green readout |
| `sessionSummary` | laptop | Auto-generated summary card — rep count, avg force, top strike |
| `phoneLiveSession` | phone | Live rep counter + force readout mid-session |
| `phoneAthleteProfile` | phone | Athlete card, trend sparkline, session history |
| `leaderboard` | phone | Head-to-head board for the facilities page |

Per-page assignment:

- **College** — coachDashboard (laptop) · placementHeatmap (laptop) · phoneAthleteProfile (phone)
- **Pro** — symmetryPanel (laptop) · sessionSummary (laptop) · phoneLiveSession (phone)
- **Sports Science** — symmetryPanel (laptop) · placementHeatmap (laptop) · sessionSummary (laptop)
- **Facilities** — leaderboard (phone) · coachDashboard (laptop) · phoneLiveSession (phone)

Build order: `coachDashboard` and `phoneLiveSession` first (used most), then the rest.

---

## 4. Audience-tagged demo routing

Per your call, CTAs go to the contact page rather than opening a modal.

```
/college         → /contact?audience=college&inquiry=sales
/pro             → /contact?audience=pro&inquiry=sales
/sports-science  → /contact?audience=sports-science&inquiry=sales
/facilities      → /contact?audience=facilities&inquiry=partnership
```

In `contact.tsx`:

1. `useSearchParams()` reads both params.
2. `inquiry` initial state seeds from the param (falls back to `"general"`).
3. A hidden `audience` value is prepended to the outgoing subject line:
   `[SALES · COLLEGE] Message from …` — and added as an `Audience:` line in the body.
4. A small confirmation chip renders above the form — *"College Athletics enquiry"* — so the visitor sees continuity from the page they came off.

⚠️ **Flag:** `contact.tsx:82` currently builds a `mailto:` link, so nothing lands in a CRM and there's no way to count leads. The `RequestDemoModal` in `landing.tsx:28` POSTs to `formsubmit.co/ajax/calvin@trenchsports.ai`. If GTM wants segmented inbound they can actually query, we should move the contact form to the same POST endpoint (or a real endpoint) as part of this work. Worth a decision before build — see §8.

---

## 5. SEO

Client-side `useSeo` hook, as chosen:

```ts
useSeo({ title, description, canonical, ogImage });
```

Sets `document.title`, and upserts `meta[name=description]`, `og:title`, `og:description`, `og:url`, `og:image`, `twitter:*`, and `link[rel=canonical]`. Restores nothing on unmount — the next page overwrites. No dependency added.

Per-page:

| Slug | Title | Description |
|---|---|---|
| `/college` | Contact Data for College Football Programs \| Trench Sports | Measure force, speed, and placement on every contact rep. Objective development and evaluation data for your entire roster. |
| `/pro` | Contact Analytics for Professional Teams \| Trench Sports | Per-rep force, speed, and placement metrics that integrate with the AMS stack you already run. |
| `/sports-science` | Standardized Contact Testing for Sports Science Staff \| Trench Sports | Repeatable contact-measurement protocols — consistency, symmetry, and output, measured the same way every session. |
| `/facilities` | Measurable Training for Performance Facilities \| Trench Sports | Turn every session into measurable data — a new draw for athletes and a new line of revenue. |

**Known limit:** the app is a client-rendered Vite SPA with a catch-all rewrite in `vercel.json`. Google renders JS and will index these fine. LinkedIn, Twitter and Slack unfurls will *not* — they'll show the generic `index.html` tags. Logged as a follow-up: a build-time prerender step for the four slugs. Not blocking launch, but it means paid/social links to these pages will look generic until it's done.

---

## 6. Compliance cleanup (brief, ground rule 1)

Measurement language only. Concrete edits:

| Location | Now | Becomes |
|---|---|---|
| `landing.tsx:288` | "AI flags load asymmetry, tempo drift, and **fatigue signatures**" | "…flags load asymmetry, tempo drift, and output decline across sessions" |
| `landing.tsx:289` | tag `"Fatigue detection"` | `"Output trends"` |
| `landing.tsx:336` | "Validated metrics for **return-to-play**, load management, and fatigue monitoring" | "Standardized, repeatable contact metrics — consistency, symmetry, and output. Data you can take into the training room." |
| `platformVisuals.tsx:169` | "AI flags what to fix — **before it shows up as an injury report**" | "AI flags what to fix — rep by rep, session over session" |
| `platformVisuals.tsx:133` | "Fatigue Index" | "Output Index" |

Same rule applies to all new copy. The `/sports-science` page is the highest-risk surface — no injury, medical, readiness, or return-to-play framing anywhere on it.

**Brand note to settle:** the brief specifies Power Purple `#422A7C`. The site currently runs `--accent: #b400ff` (`styles.css:6`) throughout. These are very different purples. The new pages will inherit whatever `--accent` is, so this is a site-wide decision, not a per-page one — flagging it rather than silently picking one. See §8.

---

## 7. Phased build

**Phase 1 — skeleton (est. half a day)**
Content schema + all four content entries with the brief's draft copy · `useCasePage.tsx` rendering every section with plain panels, no device frames yet · four routes · repoint homepage links · `useSeo`. **Outcome: four real, navigable, reviewable pages.** Andrew can start marking up copy here.

**Phase 2 — the visuals (est. a day)**
`deviceFrame.tsx` · the seven mockups · wire into the outcome rows · `ts-uc-*` CSS · responsive pass (rows stack, phone frames shrink, mockups pause off-screen).

**Phase 3 — routing + cleanup (est. half a day)**
Contact-page audience params and tagged subject line · compliance copy edits on homepage and platform visuals · objection accordions.

**Phase 4 — verification**
`npm run typecheck` and `node scripts/audit.mjs` (both run on pre-push already) · all four pages at 375 / 768 / 1440 · light and dark theme (`themeToggle` exists — the new CSS must use tokens, not hardcoded colors) · every CTA lands on the right tagged URL · view-source check that no banned claim words survive: `grep -rniE "injury|return.to.play|fatigue|prevent|rehab" src/`.

---

## 8. Open questions for Andrew

1. **Contact form endpoint.** It's a `mailto:` today. If GTM needs segmented, countable leads, we should move it to a real POST endpoint in this build. Ship as-is with the tag in the subject line, or fix the plumbing now?
2. **Power Purple.** Brief says `#422A7C`; site runs `#b400ff`. Is the brief specifying a rebrand of the whole site, or just print/deck usage?
3. **Duke pilot framing.** Exact wording you want, given "framed honestly as a pilot."
4. **Wake Forest.** Is the testing partnership publicly nameable, or do we say "a Power-4 S&C staff"?
5. **Founding-partner line** on `/college` — do you have approved wording, or should I draft?
6. **Nav.** Should the four pages appear in a site-wide header/footer nav, or stay reachable only from the homepage cards? Right now there is no persistent top nav on marketing pages — `landingNav` is a scroll-spy for homepage sections only, so a cross-page nav is a new component if you want one.
7. **Stat strip.** Teamworks leads with "330+ orgs / 1M+ athletes." Our honest equivalents are hardware specs (96 cells, 3,600 events/sec, <100ms) rather than customer counts. Use the specs, or drop the strip on audience pages?

---

## 9. Definition of done

- [ ] Four routes live, each with distinct title/meta/canonical
- [ ] One template component; adding a fifth audience = one content entry
- [ ] Homepage cards link to their own pages
- [ ] Every CTA lands on `/contact` with the correct `audience` tag
- [ ] Zero injury / return-to-play / prevention language anywhere in `src/`
- [ ] Football-first framing in every hero
- [ ] Responsive at 375 / 768 / 1440, both themes
- [ ] `npm run typecheck` and `scripts/audit.mjs` clean
- [ ] Copy reviewed and signed off by Andrew before publish
