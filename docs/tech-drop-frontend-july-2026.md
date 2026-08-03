# 🧪 Tech Drop — Frontend Updates (July 2026)

Draft entries for the [Tech Drop database](https://app.notion.com/p/0af82af1239e4eae9c3afba5710f1b86?v=f3660aa046c64dbe91c846198c33bd09).
Four entries, one per area. All are `Type: 💡 Other`, `Area: App/Data`.

Covers commits `5317b89` (New URL) → `ee0bd2e` (Live Agents II), 2026-07-23 → 2026-07-30.

---

## Entry 1

**Update:** Internal Admin / Observability Dashboard + Telemetry Pipeline

**Type:** 💡 Other · **Area:** App/Data

**What Changed:** New internal-only /admin observability dashboard plus a typed telemetry event pipeline across web and mobile. We can finally see upload failures, BLE connect failures, and funnel drop-off instead of guessing.

### Page body

**What shipped**

- **`/admin` dashboard** — internal-only observability page. Lazy-loaded so its code never ships in coaches' bundles, and not linked in nav.
- **Access gating** — gated on the `internal_admins` table via the `is_internal_admin()` RPC. Non-internal users get a plain 404-equivalent (no "access denied" message, which would confirm the route exists).
- **Panels** — platform pulse (programs / coaches / athletes / devices / session counts + sparkline), upload health (missing summaries, missing events, events-with-no-cells, complete), and session activity.
- **Zero-dependency charts** — sparklines and bars are inline SVG/CSS, so no charting library ships. The Recharts-vs-Chart.js decision stays open.
- **Telemetry pipeline** — `src/lib/telemetry.ts`, `telemetryEvents.ts`, and `errorReporting.tsx`. All event names and prop shapes route through typed wrappers so the three copies of session/BLE logic can't drift.
- **Event taxonomy** — auth (login/signup succeeded+failed), onboarding step completion, BLE (connect attempted/succeeded/failed, disconnected), session (started/stopped/discarded), and upload (started, per-stage failed, succeeded).
- **Backing SQL** — `supabase/telemetry_events.sql` and `telemetry_admin.sql`. Every number on the page comes from a SECURITY DEFINER RPC returning pre-aggregated rows only; the browser never pulls raw cross-program data.

**Why it matters**

Upload failures used to be silent — a partial write looked identical to a success. Per-stage failure events now make partial writes visible, and the onboarding guard no longer swallows auth errors into the onboarding funnel (a network blip or expired token used to be indistinguishable from a real drop-off, and could trap a fully-onboarded user in onboarding).

Plan of record: `docs/observability-and-code-audit-plan.md`

---

## Entry 2

**Update:** Landing & Marketing Pages — Real Testimonials, SEO, Legal Refresh

**Type:** 💡 Other · **Area:** App/Data

**What Changed:** Landing page now runs real athlete testimonials (VJ, Tyshon Reed) instead of placeholder coach quotes, with full SEO/OG metadata, new logo assets, and rewritten Privacy/Terms/Contact pages.

### Page body

**Landing page**

- Replaced placeholder coach quotes with real athlete testimonials — **VJ** (Professional Football Player) and **Tyshon Reed** (D1 Football Player). Section renamed "Coaches Say" → **"Athletes Say"**.
- Removed the "Performance-grade capture" stats section (3600/sec, 96 cells, <100ms, Listen+Burst) — it was spec-sheet noise above the fold.
- `ImpactCounter` now supports a `prefix` prop for currency/symbol-led figures.
- Audience copy updated: programs can "run our custom AI-powered analytics Dashboard" rather than just standalone.
- Contact form submissions rerouted to **calvin@trenchsports.ai**.

**SEO & metadata**

- Full metadata in `index.html`, new OG image (`trench-sports-og.png`) and logo (`trench-sports-logo.png`).
- New `FooterLogo` component and Master TS logo enhancement asset set.
- Landing nav trimmed to match the new section list.

**Supporting pages**

- **Privacy** and **Terms** substantially rewritten (~80 lines each).
- **Contact** page restyled.
- **Dashboard** — new `exportSessionsModal` for session data export.
- **Login / Signup** — telemetry instrumentation added.

**Why it matters**

This is the first version of the site we can point real prospects at — actual social proof from athletes who used the pad, and link previews that don't look broken when shared.

---

## Entry 3

**Update:** Mobile App — Dev vs Prod Environments + Instrumented Session Flow

**Type:** 💡 Other · **Area:** App/Data

**What Changed:** Capacitor config is now environment-aware (npm run cap:dev loads the local Vite server with live reload; cap:prod loads the deployed build), and the mobile session/upload flow is fully instrumented.

### Page body

**Environment switching**

- `capacitor.config.ts` is now environment-aware via a `CAP_ENV` flag:
  - `npm run cap:dev` → native shell loads the **local Vite dev server** (live reload, cleartext http to localhost)
  - `npm run cap:prod` → native shell loads the **deployed production build**
- Override with `CAP_SERVER_URL` when testing on a physical device (use the Mac's LAN IP, e.g. `http://192.168.1.20:5173`).
- Note: `server.url` is baked into the native iOS project at `cap sync` / `cap copy` time, so switching environments means re-running sync.

**Session & upload flow** (`mobile/home.tsx`, `mobile/session.tsx` — ~460 lines changed)

- Upload now emits `session.upload_started`, per-stage `upload_stage_failed` (sessions / events / event_cells / session_summaries, with chunk index), and `upload_succeeded` with total_ms, raw_bytes, event_count, cell_count.
- BLE connect/disconnect instrumented — attempt, success (with duration, device model, fw version, attempt #, slot), failure (classified: cancel / gatt / adapter / timeout / unknown), and disconnect (including whether it happened mid-session and elapsed time).
- Session stop now carries a reason: `user`, `auto_timeout`, `disconnect`, or `error`.
- Bag indicator swapped from the 🥊 emoji to the **TS Power Bolt** logomark.
- Mobile dashboard, login, and layout updated to match; native BLE adapter and command layer touched.

**Why it matters**

Previously a failed upload on device was effectively undebuggable — we saw a generic error and nothing about which stage broke. Dev/prod switching also removes the deploy-to-test loop for mobile UI work.

---

## Entry 4

**Update:** Automated Code Audit Agents (7) + Audit Runner Script

**Type:** 💡 Other · **Area:** App/Data

**What Changed:** Seven specialized audit agents plus scripts/audit.mjs now run against diffs to catch multi-tenant isolation gaps, PII leaks in telemetry, partial-write bugs, and drift between the triplicated session/BLE code paths.

### Page body

Seven agents in `.claude/agents/`, each triggered by diffs to specific paths, plus `scripts/audit.mjs` as the runner.

| Agent | Catches | Triggers on |
|---|---|---|
| **tenancy-rls-auditor** | Multi-tenant (program) isolation gaps, missing RLS coverage. Highest-value — with no API layer, RLS *is* the entire authorization model. | DB access changes |
| **write-path-integrity-auditor** | Partial-failure handling, outbox durability, unchecked chunk results, missing backoff (finding A) | `uploadSession` / `saveSession` paths |
| **payload-load-auditor** | Unbounded payloads, duplicate storage, unchunked bulk inserts, unfiltered reads on high-volume tables (findings B & C) | write/query changes |
| **triplication-drift-auditor** | One copy of the triplicated session/BLE logic changing without the other two (finding H) | `session.tsx`, `mobile/session.tsx`, `mobile/home.tsx` |
| **telemetry-pii-auditor** | PII leakage into event props, taxonomy violations, tracking inside hot loops or renders | diffs containing `track(` or telemetry files |
| **ble-state-machine-auditor** | Connect/disconnect/notification lifecycle leaks, non-idempotent handlers, double-connects, lost buffered data | `src/bluetooth/**`, `connectBle` |
| **migration-hygiene-auditor** | `schema.sql` drift, non-idempotent statements, unacknowledged destructive ops | `supabase/*.sql` |

Also added: `.d.ts` declarations for the remaining untyped JSX components (`createAthlete`, `editAthlete`, `editProfile`, `hitSimulator`, `manageTeam`, `modal`, `program`) so `tsconfig` type-checking covers them.

**Why it matters**

The session/BLE logic exists in three places and will keep drifting — that's a bug class guaranteed to recur, and it's now mechanically checked instead of relying on someone remembering. Same for RLS: a missed policy is a cross-program data leak, and it's the one thing nothing else in the stack would catch.
