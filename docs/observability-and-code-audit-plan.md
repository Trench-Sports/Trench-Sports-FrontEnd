# Platform Observability & Code Audit — Build Plan

**Status:** draft for review · **Date:** 2026-07-30 · **Owner:** Jay

Two workstreams:

1. **Telemetry + an internal-only analytics page** — see how the platform is actually being used, where it breaks, and where load is heading.
2. **Local audit agents on git hooks** — catch bugs before they reach main.

They're related. The instrumentation work surfaces a specific list of real failure modes, and those failure modes are exactly what the audit agents should be trained to prevent. Read Part 1 before Part 2.

---

## 0. Where things stand

| | Today |
|---|---|
| Stack | Vite 6 + React 18 + TS (strict), react-router-dom 7, SPA — no SSR, no API layer |
| Backend | Supabase JS direct from browser. No server, no Edge Functions — but several Postgres RPCs already exist (`find_program_by_code`, `create_program`, `get_core_teams_for_program`, `get_coach_core_team`; see `supabase/live_functions_snapshot.sql`). `server.js` is a static host with `/health`. |
| Native | Capacitor 8 iOS + BLE |
| Telemetry | **None** |
| Error handling | **No ErrorBoundary, no `window.onerror`, no `unhandledrejection`.** Ad-hoc `console.warn`/`console.error` with tags like `[BLE]`, `[outbox]` |
| Tests | **None** |
| Lint / format | **None** |
| CI | **None** — no `.github/` |
| Typecheck | `strict: true` in tsconfig, but no `typecheck` script and it isn't run anywhere. Note `include: ["src"]` with no `allowJs`, so 8 files are invisible to `tsc` entirely: `src/bluetooth/router.js` and `src/components/{modal,program,manageTeam,createAthlete,editAthlete,editProfile,hitSimulator}.jsx` — one of which (`program.jsx:321`) queries `programs` directly. |

Every user-visible failure today is invisible to you unless a coach emails about it.

### 0.1 Things worth knowing before designing anything

These came out of reading the write paths, and they drive most of the decisions below.

**A. Session upload is four non-transactional inserts.**
`uploadSession` (`src/pages/session.tsx:1022-1486`) writes in sequence:

1. `sessions` — one row, `raw: frames.map(f => f.raw)` (L1066-1082)
2. `events` — chunked at 500 (`CHUNK` L1063, insert L1185-1188)
3. `event_cells` — chunked at 500 (L1206-1209)
4. `session_summaries` — one row (L1430)

Nothing wraps these. A failure at step 3 leaves a session row with events and no cells and no summary. `supabase/fix_summary_session_triggers.sql` only backfills denormalized columns onto an *already-inserted* summary row — it does not create a missing one. So there's no reconciliation and no way to detect the partial state today.

**B. `sessions.raw` is large and fully redundant — but it is bounded.** The whole raw frame array goes into one jsonb column. It is *not* unbounded: sessions auto-stop at `SESSION_MAX_MS = 30_000` (`session.tsx:56`, auto-stop at L2157-2161), with a user-selectable 30/45/60s cap (`src/lib/sessionSettings.ts:33`). Practical ceiling ≈ 60s × 25Hz ≈ 1500 frames per row. So this is a cost and query-latency concern, not a runaway one.

The sharper issue: `events.raw` is also `jsonb NOT NULL` (`schema.sql:133`) and stores the same per-frame payload again. **You are storing the raw sensor data twice.** Worth a panel to size, and possibly worth dropping one copy.

**C. `event_cells` is the row-count driver.** One row per grid cell per event — routinely 10-100x the `events` count. It will dominate table size and insert time long before anything else does.

**D. The offline outbox is only wired into one page.** `src/storage/sessionOutbox.ts` is imported exactly once across all of `src/` — `src/pages/mobile/home.tsx:16` (`flushOutbox` L4251-4262, `enqueue` L4359). **`src/pages/session.tsx` and `src/pages/mobile/session.tsx` never touch it.** On upload failure they set `saveState="error"` and keep `framesRef.current`, so the user can re-press Save (`session.tsx:3133-3137`, `canSave` L3184) — but a refresh, navigation, or discard loses the session permanently. Partial recovery, no durability.

Related: `src/storage/rawRecorder.ts` is imported by nothing. It's dead code, despite `sessionOutbox.ts:17` describing itself as mirroring its conventions.

**E. The outbox has no backoff.** `flush` (L152-180) counts attempts via `bumpAttempt` but never delays or caps. A permanently-failing item retries every 30s forever (`mobile/home.tsx:4441-4450`).

**F. `RequireOnboarding` swallows every error.** `src/router.tsx:83-85` — any thrown error (network blip, RLS denial, expired token) redirects to `/onboarding`. In an analytics funnel this is indistinguishable from a genuine onboarding drop-off. Fix this before you trust any onboarding numbers.

**G. No BLE auto-reconnect.** Disconnects surface as a manual "Retry Connection" button (`connectAttempt`, `session.tsx:2543`). Dropout frequency is currently unmeasured, so there's no data to justify building reconnect — measuring it is step one.

**H. The session page logic is triplicated, not duplicated.** `uploadSession` exists in **three** places, ~465-475 lines each:

- `src/pages/session.tsx:1022-1486`
- `src/pages/mobile/session.tsx:1736-2200`
- `src/pages/mobile/home.tsx:1770-2245` — same four inserts, same `CHUNK = 500`, same `raw` write; differs only in allowing null `programId`/`athleteId` and adding `deviceUid`/`location`

The whole surrounding function set is triplicated too — `connectBle` (2578 / 3547 / 3660), `disconnectBle` (2691 / 3660 / 3778), `connectAdditionalBag` (2709 / 3678 / 3796), `disconnectSlot` (2775 / 3769 / 3893), `startSession` (2910 / 3904 / 4096), `stopSession` (3021 / 4019 / 4217), `saveSession` (3052 / 4050 / 4265).

Every instrumentation hook below has to be added three times, and every drift-detection rule needs three-way coverage. This is the largest single tax on both workstreams.

**I. `/m/home` has no login.** The mobile MVP runs anonymously. Telemetry must accept unauthenticated writes, which has security implications (§1.4).

---

# Part 1 — Telemetry & the internal analytics page

## 1.1 What we're trying to answer

Three buckets. Being explicit about the questions keeps the event taxonomy from sprawling.

**Product / usage**
- How many programs, coaches, athletes are active weekly? Which are going dormant?
- Do coaches who complete onboarding run a second session? A tenth?
- Which session modes actually get used?
- What's the drop-off from app open → device paired → session started → session saved?

**Reliability**
- BLE connect success rate, by platform, firmware version, and device model
- Mid-session dropout rate and how much data it costs
- Upload success rate per stage (the four inserts in finding A)
- Outbox depth and age — how much data is stranded on devices right now
- Unhandled error rate by route

**Load & capacity**
- Rows/day and bytes/day into `sessions`, `events`, `event_cells`
- p50/p95 `sessions.raw` vs `events.raw` size — how much are you paying for the duplicate copy in finding B?
- Total DB size against the Supabase plan ceiling, and projected days to hit it
- Upload duration vs payload size — where the latency curve turns
- Peak concurrent sessions, by hour and weekday

## 1.2 Event taxonomy

Dot-namespaced, past tense, low cardinality in `name` with details in `props`. Start with this set and resist adding more until a real question needs one.

| Event | Fires when | Key props |
|---|---|---|
| `app.opened` | App/SPA boot | `platform`, `app_version`, `cold_start` |
| `app.error` | Global error handler | `message`, `stack_hash`, `route` |
| `auth.signup_succeeded` / `_failed` | `signup.tsx:74-105` | `error_code` |
| `auth.login_succeeded` / `_failed` | `login.tsx:45-79` | `error_code` |
| `onboarding.step_completed` | Each `complete*` fn in `onboarding.tsx` | `step`, `path` (coach/admin-join/admin-create) |
| `onboarding.guard_failed` | `router.tsx:83` catch | `reason` — **fixes finding F** |
| `ble.connect_attempted` | `connectBle` entry | `platform`, `slot` |
| `ble.connect_succeeded` | `session.tsx:2654` | `duration_ms`, `device_model`, `fw_version`, `attempt_n` |
| `ble.connect_failed` | `session.tsx:2662-2688` | `error_class` (cancel/gatt/adapter), `attempt_n` |
| `ble.disconnected` | `onDisconnect` L2609/L2634 | `during_session` (bool), `session_elapsed_ms` |
| `session.started` | `startSession` L2910 | `mode`, `num_bags` |
| `session.stopped` | `stopSession` L3021 | `duration_ms`, `event_count`, `reason` |
| `session.discarded` | `discardSession` L3141 | `duration_ms` |
| `session.upload_started` | `uploadSession` entry | `event_count`, `cell_count`, `raw_bytes` |
| `session.upload_stage_failed` | Any of the 4 inserts | `stage`, `error_code`, `chunk_index` — **fixes finding A** |
| `session.upload_succeeded` | After summaries insert | `total_ms`, `raw_bytes`, `event_count`, `cell_count` |
| `outbox.enqueued` | `sessionOutbox.ts:68` | `queue_depth` |
| `outbox.flush_succeeded` / `_failed` | L168 / L171 | `attempt_n`, `age_ms`, `queue_depth` |

Deliberately excluded for now: page views (route changes are low-signal here), and per-strike events (already in `events`).

## 1.3 Schema

```sql
create table public.app_events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),   -- server time, authoritative
  client_ts   timestamptz,                          -- device clock; diff = skew
  name        text not null,
  client_id   text not null,        -- anon uuid in localStorage, survives logout
  user_id     uuid references auth.users(id) on delete set null,
  program_id  uuid references public.programs(id) on delete set null,
  session_id  text,                 -- intentionally no FK: may not exist yet
  device_id   text,
  platform    text check (platform in ('web','ios')),
  app_version text,
  ok          boolean,
  error_code  text,
  duration_ms integer,
  props       jsonb not null default '{}'
);

create index on public.app_events (ts desc);
create index on public.app_events (name, ts desc);
create index on public.app_events (program_id, ts desc) where program_id is not null;
create index on public.app_events (ts desc) where ok is false;
```

Notes:

- `session_id` has **no** foreign key on purpose. `session.started` fires before the `sessions` row exists, and upload-failure events describe sessions that will never exist. An FK would drop exactly the events you most need.
- Promote `duration_ms`, `ok`, `error_code` out of `props` into real columns — they're queried in nearly every panel and jsonb extraction in aggregates gets slow.
- `client_id` is what lets you track the anonymous `/m/home` MVP funnel (finding I).

**Retention.** Raw events for 90 days, then delete. Roll up to daily aggregates before deleting so the long-range trend lines survive. `pg_cron` nightly.

**Rollups.** A `telemetry_daily` table (`day, name, program_id, platform, count, ok_count, p50_duration, p95_duration`), refreshed nightly. The admin page reads rollups for anything over 7 days old and raw events for anything newer. Without this the page gets slow within a couple of months.

**Capacity metrics** come from Postgres itself, not from events — a `telemetry_storage_daily` snapshot table populated nightly with `pg_total_relation_size` for `sessions`/`events`/`event_cells`/`app_events`, plus `percentile_cont` over `pg_column_size(raw)` for `sessions`. That's the finding-B tripwire.

## 1.4 Security: the open-insert problem

`/m/home` is anonymous, so `app_events` needs an insert policy for `anon`. That's a public write endpoint on your database. Handle it deliberately:

```sql
alter table public.app_events enable row level security;

create policy "anyone can insert telemetry"
  on public.app_events for insert
  to anon, authenticated
  with check (
    length(name) <= 64
    and length(client_id) <= 64
    and pg_column_size(props) < 4096
  );

-- No select/update/delete policy for anon or authenticated.
-- Internal reads bypass RLS via a security-definer RPC (below).
```

Additional hardening, in rough priority order:

1. **Name whitelist** — a `check (name = any(array[...]))` or a lookup-table FK. Blocks garbage taxonomy from a stale client and accidental PII in event names.
2. **Rate limit** — a `before insert` trigger rejecting more than N inserts per `client_id` per minute. Cheap insurance.
3. **PII rule** — never put athlete names, emails, or raw sensor values in `props`. Worth stating in the doc and enforcing in the audit agent (§2.4).
4. If abuse ever materializes, move ingestion behind a Supabase Edge Function with a shared secret. Don't do this on day one; it's a real added moving part.

**Internal access.** Don't overload the existing program-scoped `user_role` enum. Add a separate table:

```sql
create table public.internal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
```

Every admin-page query goes through `security definer` RPCs that check `exists (select 1 from internal_admins where user_id = auth.uid())` and return **pre-aggregated** rows only. The admin page should never be able to pull raw cross-program athlete data down to the browser — with no API layer, an RPC boundary is your only place to enforce that. This isn't a new pattern for the repo: `create_program`, `find_program_by_code`, and `get_core_teams_for_program` already work this way (`supabase/live_functions_snapshot.sql`), so follow their conventions.

## 1.5 Client tracker

New file `src/lib/telemetry.ts`. Requirements:

- `track(name, props?)` — never throws, never blocks the caller. Wrap the whole body in try/catch; telemetry must not be able to break a session.
- **Batch.** Buffer in memory, flush every 10s or at 20 events, whichever first. One insert per flush. Given finding C, do not add a write per user action.
- **Flush on `visibilitychange` → hidden**, not `beforeunload` (unreliable on iOS). Use `navigator.sendBeacon` where available.
- **Survive offline.** On flush failure, persist the buffer to IndexedDB and retry on `online`. `sessionOutbox.ts` already has this shape — mirror it rather than inventing a second pattern, and consider extracting the shared retry logic.
- **Backoff**, unlike the outbox: exponential to a 5-minute cap, drop the buffer past 500 events. Do not repeat finding E.
- **Auto-context.** `client_id`, `platform`, `app_version`, and current `user_id`/`program_id` attach automatically. Call sites pass only what's specific to the event.
- **Kill switch.** A `VITE_TELEMETRY_ENABLED` env flag, plus a runtime check so you can turn it off without a deploy.

**Global error capture** — new file `src/lib/errorReporting.ts`, installed in `src/main.tsx` (19 lines today, with a dead `App` import at L7 that is never rendered — clean that up while you're in there):

- `window.addEventListener('error' | 'unhandledrejection')` → `app.error`
- A React `<ErrorBoundary>` wrapping `<RouterProvider>` directly, so a render crash reports and shows a recovery UI instead of a white screen
- Hash the stack for grouping; **truncate messages and strip anything that could carry athlete data**

This one file is arguably the highest value-per-line item in the whole plan.

## 1.6 The admin page

Route `/admin`, gated on `internal_admins`. Not linked from any nav. Renders nothing but a 404-equivalent for non-internal users — no "access denied" message, which just confirms the route exists.

Reuse the existing `AppLayout`. Panels:

**1 — Platform pulse (top strip).** Active programs (7d), sessions today vs 7-day average, events ingested today, current outbox depth across all clients, error count (24h). Small sparkline each.

**2 — Load & capacity.** The finding-B/C panel, and the one that will actually save you money:
- Table sizes over time, stacked area (`event_cells` will dominate — that's expected, watch the slope)
- `sessions.raw` size p50/p95/max over time, with a threshold line
- Total DB size vs plan limit + **projected days to limit** from a 30-day linear fit
- Rows/day by table

**3 — Session funnel.** `app.opened` → `ble.connect_succeeded` → `session.started` → `session.stopped` → `session.upload_succeeded`. Split by platform. The gap between `stopped` and `upload_succeeded` is your data-loss rate, and finding D says it's currently silent.

**4 — Upload health.** Success rate by stage. Failure counts by `error_code`. Duration vs payload size scatter. A "partial writes" count: sessions with a row but no summary — a direct query against existing tables, buildable today with zero instrumentation.

**5 — BLE reliability.** Connect success rate by platform/firmware/model. Attempts-to-success histogram. Mid-session dropout rate and average data lost per dropout. This is what tells you whether auto-reconnect (finding G) is worth building.

**6 — Concurrency & timing.** Sessions per hour heatmap (hour × weekday). Peak concurrent sessions. Drives when to schedule migrations and whether load is spiky enough to matter.

**7 — Program health table.** Per program: plan, status, trial end, coaches, athletes, sessions (7d/30d), last activity, error rate. Sortable. Doubles as a churn-risk and support-triage view. Flag programs approaching `max_sessions_per_month` / `max_athletes` / `max_devices` — those limits exist in `programs` but nothing currently surfaces when someone is near them.

**8 — Error feed.** Grouped by `stack_hash`, sorted by count(24h), with first/last seen and affected user count.

**Rendering.** Recharts if you want React-native components; Chart.js if you want smaller bundle. Either is fine — but **lazy-load the admin route** so its charting library never ships to coaches.

## 1.7 Build order

| Phase | Work | Why here |
|---|---|---|
| **0** | Fix finding D (wire outbox into both session pages) and finding F (log instead of swallow in `RequireOnboarding`) | Real bugs. Fix before measuring, or you'll measure the bug. |
| **1** | `errorReporting.ts` + ErrorBoundary + `app_events` table + RLS + `telemetry.ts` | Errors alone justify the page |
| **2** | `/admin` route + `internal_admins` + Panels 1, 4, 7 | These need no new instrumentation — pure queries over existing tables |
| **3** | Instrument BLE + session + outbox hook points across **all three** page sets — `session.tsx`, `mobile/session.tsx`, `mobile/home.tsx` (finding H) | The bulk of the call-site work |
| **4** | Panels 3, 5, 6 + `telemetry_storage_daily` cron + Panel 2 | Needs a couple weeks of data to be meaningful |
| **5** | `telemetry_daily` rollups + 90-day retention + Panel 8 grouping | Do before the raw table gets big, not after |

Phase 2 is the fastest path to something useful — Panels 1, 4, and 7 are queries over `sessions`, `session_summaries`, `programs`, and `profiles` that you can write today.

---

# Part 2 — Local audit agents

## 2.0 One honest caveat

Local hooks are bypassable (`--no-verify`), don't run for collaborators, and can't protect `main`. They're the right *starting* point — fast feedback, zero CI cost, nothing to configure in GitHub. But the moment a second engineer pushes to this repo, the same checks should run in CI as the actual gate. Design the checks as **standalone scripts** that hooks call, so moving them into CI later is a five-line YAML file and no rework.

## 2.1 Foundation first

Agents reviewing an unlinted, untested, never-typechecked codebase spend their budget reporting things a linter catches for free. Build the cheap deterministic layer first.

**a. Typecheck script.** `"typecheck": "tsc --noEmit"`. `strict` is already on and this has apparently never run — expect a backlog of real findings on the first run. Fix them before wiring the hook, or the hook is useless from day one.

Caveat: `include: ["src"]` with no `allowJs` means the 8 `.js`/`.jsx` files listed in §0 are silently skipped. Either migrate them to TS or add `allowJs` + `checkJs` and accept a second backlog. Until then, don't assume typecheck coverage is complete — `program.jsx` queries Supabase directly and is entirely unchecked.

**b. ESLint** (flat config) with `typescript-eslint` and `eslint-plugin-react-hooks`. The rule that matters most here is `react-hooks/exhaustive-deps` — this codebase is heavy on `useEffect` with BLE subscriptions and async cleanup, which is precisely where stale-closure bugs live. Add `no-floating-promises` too; the Supabase call sites are full of un-awaited promises.

Heads up: there's already an `// eslint-disable-next-line react-hooks/exhaustive-deps` at `session.tsx:2164`, written when no linter existed. Expect pre-existing suppressions sitting on exactly the BLE/session effects that most need review. Audit every disable comment when the rule lands rather than treating a clean run as a clean bill of health.

**c. Prettier.** Not about taste — it makes diffs small, which makes the agents cheaper and more accurate.

**d. Vitest**, targeting the pure modules where tests are easy and valuable:
- `src/processing/` — `normalize`, `calibration`, `eventBuilder`, `liveMetrics`. Pure functions over sensor data. Golden-file tests against a recorded session would be high-value and cheap.
- `src/bluetooth/protocol.ts` — frame parsing. Feed it malformed input.
- `src/storage/sessionOutbox.ts` — enqueue/flush/retry with a fake IndexedDB.

Don't chase coverage on the React pages. The processing pipeline is where a silent numerical regression would be most damaging and least visible.

**e. Hook runner.** `simple-git-hooks` + `lint-staged` (lighter than husky, one dev dep).

## 2.2 Hook layout

**pre-commit — fast and deterministic only, target under 5s.** No LLM calls; anything slower than a few seconds here trains you to use `--no-verify` reflexively.

```
lint-staged:
  *.{ts,tsx} → eslint --fix, prettier --write
  *.{js,jsx,json,css,md} → prettier --write
```

**pre-push — the real gate, 30-90s.**

```
1. tsc --noEmit                        (fast, deterministic, blocking)
2. vitest run                          (blocking)
3. audit agents over the diff          (see below)
```

**Rules that make hooks survivable:**

- Agents run on `git diff origin/main...HEAD`, never the whole repo. Scope is cost.
- Findings written to `.audit/findings.md`, printed as a summary.
- Severity levels: `CRITICAL` blocks the push; `WARN` prints and continues.
- **Start every new agent in warn-only mode.** Promote it to blocking after it's been right for a couple of weeks. An agent that false-positives on day one gets disabled on day two.
- `SKIP_AUDIT=1 git push` as the documented escape hatch — better than people learning `--no-verify`, which skips the deterministic checks too.
- Hard timeout per agent (60s), fail open on timeout. A flaky network must never block a push.
- Run the independent agents concurrently.

## 2.3 Agent implementation

Each agent is a markdown prompt in `.claude/agents/`, invoked via `claude -p` from `scripts/audit.mjs`, given the diff plus a short repo-context preamble, and required to return structured findings:

```json
{ "severity": "CRITICAL|WARN|INFO", "file": "...", "line": 0,
  "rule": "...", "finding": "...", "fix": "..." }
```

Give every agent the same preamble: no API layer, browser talks to Supabase directly, RLS is the only authorization boundary, the session page logic is triplicated across `session.tsx` / `mobile/session.tsx` / `mobile/home.tsx`, and `/m/home` is anonymous. Without that context the reviews will be generic.

## 2.4 The agents

Ordered by value. Each derives from a real property of this codebase, not a generic checklist.

**1. Tenancy & RLS auditor — highest value.**
With no API layer, RLS is your entire authorization model. Triggers on any diff touching `.from(`, `.rpc(`, or `supabase/*.sql`.
- Every new query filters by `program_id` (or is provably scoped by an RLS policy that does)
- New tables have RLS enabled and a policy — not just enabled, which silently denies everything
- New policies don't widen access to other programs
- No `service_role` key anywhere in `src/`
- New columns holding athlete PII are covered by an existing policy

**2. Write-path integrity auditor.**
Derived from finding A. Triggers on diffs to `uploadSession`, `saveSession`, or any new multi-step insert.
- Multi-insert sequences handle partial failure — rollback, cleanup, or outbox
- Failed uploads reach the outbox (finding D — encode the fixed version as the rule)
- Chunked inserts check every chunk's result, not just the last
- New retry loops have backoff and a cap (finding E)

**3. Triplication drift auditor.**
Finding H. Maintains the list of triplicated functions — `uploadSession`, `connectBle`, `disconnectBle`, `connectAdditionalBag`, `disconnectSlot`, `startSession`, `stopSession`, `saveSession` — across all **three** files: `src/pages/session.tsx`, `src/pages/mobile/session.tsx`, `src/pages/mobile/home.tsx`. Flags a change to one copy without corresponding changes to the other two, and reports which of the three was missed. Purely mechanical, catches a class of bug that is currently guaranteed to recur. Note `mobile/home.tsx` legitimately differs (nullable `programId`/`athleteId`, extra `deviceUid`/`location`) — the agent needs to know that so it doesn't flag intentional divergence.

**4. BLE state-machine auditor.**
Triggers on `src/bluetooth/**` and `connectBle`/`disconnectBle`/`connectAdditionalBag`/`disconnectSlot`.
- Every `startNotifications` has a matching teardown on the unmount/disconnect path
- Disconnect handlers are idempotent — they fire on user action *and* on dropout
- No double-connect on the same slot
- Disconnect during an active session preserves buffered data
- `useEffect` cleanups actually remove listeners

**5. Payload & load auditor.**
Findings B and C.
- New array/jsonb writes without an explicit bound flagged (this is how `sessions.raw` happened — it's only safe today because a 30-60s session timer caps it)
- New duplicate storage of data already persisted elsewhere (finding B: `sessions.raw` and `events.raw` hold the same payload)
- New bulk inserts are chunked
- New queries on `events`/`event_cells` have a bounded predicate — no unfiltered `select *`
- No `select('*')` on wide tables when specific columns would do

**6. Migration hygiene auditor.**
- New SQL in `supabase/` has a matching `schema.sql` update (the file says the live project is source of truth — drift is inevitable without a check)
- Migrations are idempotent (`if not exists`)
- No destructive statement without an explicit acknowledgement comment

**7. Telemetry PII auditor.** *(add alongside Part 1 Phase 3)*
- No athlete names, emails, DOB, or raw sensor values in `track()` props
- Event names match the taxonomy in §1.2
- No `track()` call inside a render body or an unguarded hot loop

## 2.5 Build order

| Phase | Work | Effort |
|---|---|---|
| **0** | `typecheck` script, run it, fix the backlog | Unknown until you run it — do this first to size it |
| **1** | ESLint + Prettier + `simple-git-hooks` + `lint-staged`; pre-commit live | Half a day |
| **2** | Vitest + first tests on `src/processing/` and `sessionOutbox`; pre-push runs typecheck + tests | 1-2 days |
| **3** | `scripts/audit.mjs` harness + Agent 1 (tenancy), warn-only | 1 day |
| **4** | Agents 2 and 3. Promote Agent 1 to blocking if it's earning its keep | 1 day |
| **5** | Agents 4-6 | 1 day |
| **6** | Agent 7, alongside telemetry Phase 3 | Half a day |

---

## 3. Decisions still open

1. **Charting library** — Recharts (React-idiomatic, heavier) vs Chart.js (lighter, imperative). Either works; pick one and lazy-load it.
2. **Does the audit-agent budget bother you?** A `claude -p` call per agent per push adds up. Mitigations: diff-only scope, skip on merge commits, run the expensive agents on pre-push only rather than pre-commit.
3. **How much are the two raw copies actually costing?** One query answers it and it sets Panel 2's priority:
   ```sql
   select 'sessions.raw' as col, count(*),
          pg_size_pretty(avg(pg_column_size(raw))::bigint) as avg,
          pg_size_pretty(max(pg_column_size(raw))::bigint) as max,
          pg_size_pretty(sum(pg_column_size(raw))::bigint) as total
   from public.sessions
   union all
   select 'events.raw', count(*),
          pg_size_pretty(avg(pg_column_size(raw))::bigint),
          pg_size_pretty(max(pg_column_size(raw))::bigint),
          pg_size_pretty(sum(pg_column_size(raw))::bigint)
   from public.events;
   ```
   If the two totals are comparable, dropping one copy is the single cheapest capacity win available and should jump the queue.
4. **Extract shared session code before or after instrumenting?** Extracting first means instrumenting once instead of three times — a bigger win than it looked before finding H was fully counted. But it's a large refactor on the most critical path in the app with zero tests behind it. Leaning: instrument all three, let Agent 3 hold the line on drift, extract later once `src/processing/` has test coverage. Revisit if the three-way instrumentation turns out to be more painful than expected.
5. **Telemetry consent — probably already covered.** `src/pages/privacy.tsx:32-36` already says the platform collects "how you interact with the platform, device type, browser, and session duration … processed in aggregate." That reads as sufficient for the taxonomy in §1.2. Have someone confirm, but this likely isn't a blocker. Do keep the PII rule (§1.4) strict regardless — some athletes are minors.
6. **Migrate the 8 `.js`/`.jsx` files to TypeScript?** They're currently outside typecheck, outside the strict guarantees, and one of them queries Supabase. Small, contained, and it closes a real hole in both workstreams. Good candidate for filler work between phases.
