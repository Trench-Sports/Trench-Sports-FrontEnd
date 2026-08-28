# Partner API + Teamworks AMS Integration — Plan

Status: draft v0.3 · 2026-08-21 · owner: Jay
Three decisions settled — see §10. Four still open (3-6).
Supersedes the marketing promise in `src/pages/dummy.tsx:2492-2521` and
`src/content/useCases.ts:271-272,288`, neither of which is implemented.
Closes `supabase/entitlements.sql:836-837` — "Raw NDJSON / event_cells export and
the per-program API surface. §10 phases 6 and 7."

---

## 0. What this is for

Two distinct products that share one substrate. Keeping them separate in the plan
matters, because they have different buyers and different failure modes.

**A. Partner API (pull).** A program gets a token scoped to their program and
calls `api.trenchsports.ai/v1/...` to pull their own hitting data into whatever
dashboard, warehouse or R notebook they already run. Read-only. This is the
generic answer to "can we get our data out".

**B. Teamworks AMS connector (push).** Trench pushes session summaries into the
program's AMS instance as event records, so hitting data lands next to their GPS,
wellness and load data without anyone writing code. This is the enterprise
close — most college programs already live in AMS and will not build against a
REST API themselves.

B is the reason A has to exist, but B is not a special case of A. B is Trench
calling *out* to Teamworks with the program's AMS credentials; A is a partner
calling *in* with a Trench token. Different auth in both directions.

---

## 1. The one architectural decision that matters

`supabase/entitlements.sql:781-782` currently says:

> service_role keeps full access, which is what the future API surface (§6.5)
> and any edge function will run as.

**Do not build it that way.** `service_role` bypasses RLS entirely, which means
the API layer would have to re-implement program scoping *and* the tier masking
whitelist. That would be the **third** copy of predicates that
`entitlements.sql:429-432` already flags as a sync hazard:

1. `supabase/rls_policies.sql` — the RLS policies
2. `supabase/entitlements.sql` §6 — the `tiered_*` definer functions that
   duplicate those policies verbatim
3. …the API layer, if we scope in TypeScript

A third copy drifting is how a partner ends up reading another program's
sessions, or a Tier I program reads `si_fatigue_slope`.

### The shape instead: shared scoping core, two thin callers

Refactor §6 so the row-scoping and masking logic lives in one place that takes
its identity as parameters, and give it two callers:

```
                    ┌─────────────────────────────────────┐
                    │  scoped_session_summaries(          │
   browser ────────►│    p_program_id, p_role,            │
   (JWT)            │    p_core_team_id, p_tier, filters) │
        │           │  — SECURITY DEFINER, no auth.uid()  │
        │           └─────────────────────────────────────┘
        │                      ▲                 ▲
        │                      │                 │
   tiered_session_summaries()  │                 │  api_session_summaries(
   — resolves identity from ───┘                 └── p_key_hash, filters)
     auth.uid() via                                  — resolves identity from
     get_my_program_id() /                             api_keys, then delegates
     get_my_role() /
     get_my_core_team_id()
```

Both callers stay `SECURITY DEFINER`. Neither duplicates a predicate. The RLS
policies remain the single authored source of the scoping rule, and the shared
core is the single *implementation* of it.

### Why not a synthetic `auth.users` row per key

The tempting alternative is to give each API key a machine user in
`auth.users` + `profiles`, mint a short-lived JWT for it, and let RLS apply
untouched with zero refactor. Rejected because:

- it counts against `programs.max_coaches` and shows up in the coach list UI
- it is a real credential-able account — a password reset turns an API key into
  a login
- newer Supabase projects use asymmetric JWT signing keys, so hand-signing a
  JWT is no longer a stable documented path

The refactor is a day of SQL. The synthetic-user path is a permanent liability.

### Key resolution happens in SQL, not in Node

`api_session_summaries(p_key_hash text, ...)` resolves the program itself. The
Node layer never handles a `program_id` and therefore cannot get scoping wrong —
the worst a bug in the HTTP layer can do is return an error.

**Pass the SHA-256 hash, not the plaintext.** Node hashes the bearer token and
passes the digest. This is a deliberate improvement on
`redeem_coach_invite(p_token text)` (`supabase/coach_invite_links.sql:267`),
where the plaintext token crosses into Postgres and can land in
`log_statement`/`pg_stat_statements` output.

---

## 2. Where the API runs — Vercel Functions

Asked directly: what's industry standard and easier to monitor and control.

**Recommendation: Vercel Functions in this repo, under `/api/v1/*`.**

| | Vercel Functions | Supabase Edge Functions |
|---|---|---|
| Runtime | Node, same tsconfig, can import `src/lib/entitlements.ts` types | Deno, separate toolchain and import conventions |
| Observability | Per-route logs, latency and error rate in the dashboard we already deploy from; log drains to a real APM later | Function logs only, weakly queryable, no per-route view |
| Rate limiting / abuse control | Vercel Firewall rules at the edge — blocks before the function bills | None; must be hand-rolled |
| Deploy | Same commit, same PR preview as the frontend | Second deploy pipeline, drifts from the app |
| Fit for purpose | Designed as an application/API surface | Designed as database-adjacent hooks |

The genuine cost is latency: a Vercel function in `iad1` calling Supabase adds a
network hop an Edge Function wouldn't. At partner-API volume (batch pulls, not
interactive) that is irrelevant, and it buys a single toolchain for a small team.

Industry standard for a versioned public API is a typed service behind a
gateway. Vercel Functions + Vercel Firewall is the closest thing to that inside
the footprint we already pay for. Revisit only if we outgrow it.

### Two concrete deployment notes

1. **`vercel.json` needs the rewrite narrowed.** Today it is
   `{"source": "/(.*)", "destination": "/index.html"}`. Vercel evaluates the
   filesystem before rewrites, so `/api/*` functions *should* win — but relying
   on that ordering for the security-relevant surface is careless. Make it
   explicit:

   ```json
   { "source": "/((?!api/).*)", "destination": "/index.html" }
   ```

2. **Host it on its own subdomain eventually.** `api.trenchsports.ai` rather
   than `trench-sports-front-end.vercel.app/api`. Lets us set independent CORS,
   cache and firewall policy, and means partners' credentials never share an
   origin with the app. Phase 7, not day one.

---

## 3. Token model

Follows the `coach_invites` pattern (`supabase/coach_invite_links.sql`) with two
deliberate departures.

```sql
create table public.api_keys (
  id               uuid        not null default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  program_id       uuid        not null references public.programs(id) on delete cascade,
  created_by       uuid        references public.profiles(user_id) on delete set null,

  -- SHA-256 hex of the plaintext. The plaintext is NEVER stored.
  key_hash         text        not null unique,
  -- First 14 chars of the plaintext, e.g. 'ts_sk_live_a4f'. Display only, so an
  -- admin can tell two keys apart in the UI without us storing the secret.
  key_prefix       text        not null,

  label            text,
  environment      text        not null default 'live'
                     check (environment in ('live','test')),
  scopes           text[]      not null default array['sessions:read','athletes:read','teams:read'],

  expires_at       timestamptz,          -- NULL = no expiry
  revoked_at       timestamptz,
  last_used_at     timestamptz,
  request_count    bigint      not null default 0,

  -- Rate limit override; NULL falls back to the tier default.
  rate_limit_rpm   integer,

  constraint api_keys_pkey primary key (id)
);

create index api_keys_program_idx on public.api_keys (program_id, created_at desc);
```

**Departure 1 — no plaintext column, ever.** `supabase/schema.sql:103-106`
records that `coach_invites` later had a plaintext `token` column added back so
admins could re-copy a live link. That trade is defensible for a 72-hour
onboarding link. It is not defensible for a long-lived read credential on an
entire program's athlete data. `key_prefix` solves the identification problem
that motivated it; if a key is lost, roll it.

**Departure 2 — no expiry by default.** Invites expire in 72h. API keys are
integration infrastructure; a surprise expiry breaks a partner's pipeline at
3am. `expires_at` exists for programs that want rotation policy, defaults NULL.

### Format

```
ts_sk_live_<43 chars base64url>     # 32 bytes of CSPRNG
ts_sk_test_<43 chars base64url>
```

`sk` = secret key, mirroring the convention partners already recognise from
Stripe. `dummy.tsx` currently advertises `ts_live_sk_...`; align the marketing
copy to whichever we ship, but ship this ordering — prefix-then-environment
grep-matches better in leaked-credential scanners.

### RLS

Reads: program admins, own program only. `key_hash` is a hash and safe to
expose, but there is no reason to — return it through an RPC that omits it.
Writes: **no policy at all.** Every mutation goes through definer RPCs, exactly
as with `coach_invites`, so nothing can forge, widen scope on, or un-revoke a
key.

```sql
create_api_key(p_label text, p_scopes text[], p_environment text)
  -> (key_id uuid, key text, key_prefix text)   -- plaintext returned ONCE
list_api_keys()      -> id, key_prefix, label, scopes, created_at, last_used_at, request_count
revoke_api_key(p_key_id uuid) -> boolean
```

All three: admin-only, own-program-only, `programs.status <> 'suspended'`,
and gated on `(my_entitlements()->'features'->>'apiAccess')::boolean`.

### Scopes

| Scope | Grants | Min tier |
|---|---|---|
| `athletes:read` | roster | III |
| `teams:read` | team tree | III |
| `sessions:read` | session summaries, masked to tier | III |
| `events:read` | per-strike events | III |
| `raw:read` | `event_cells`, raw NDJSON | III |
| `webhooks:manage` | subscribe/unsubscribe | III |
| `ams:push` | connector writes to AMS | III |

Scope is **intersected** with the tier, never a substitute for it. A key with
`raw:read` on a program that drops to Tier II returns 402, not 200. The tier
check stays in SQL where `my_tier()` already lives; the scope check happens in
Node because it is a property of the credential, not the data.

---

## 4. Endpoints (v1)

Base: `https://api.trenchsports.ai/v1` (interim: `/api/v1` on the app domain).
Auth: `Authorization: Bearer ts_sk_live_...`. JSON only. No cookies, no CORS
for `*` — partners call server-to-server.

```
GET  /v1/whoami
GET  /v1/teams
GET  /v1/athletes
GET  /v1/sessions
GET  /v1/sessions/{session_id}
GET  /v1/sessions/{session_id}/events
GET  /v1/exports/sessions.csv          (csvExport feature)
GET  /v1/exports/events.ndjson         (raw:read + rawExport feature)
```

**`/v1/whoami` ships first and matters more than it looks.** It returns the
key's program name, tier, scopes, unlocked modes, history window and current
rate-limit state. Every partner integration debugging session starts here, and
it lets us validate the whole auth + metering + rate-limit path with no data
endpoints built yet.

```json
{
  "program": { "id": "…", "name": "Example State Football" },
  "tier": "III",
  "scopes": ["sessions:read","athletes:read","teams:read","events:read","raw:read"],
  "modes": ["power","accuracy","reaction","volume","target"],
  "history_days": null,
  "rate_limit": { "limit": 60, "remaining": 59, "reset_at": "2026-08-20T14:31:00Z" }
}
```

### `/v1/sessions` response

One object per session summary. Field names are snake_case and mirror the DB so
there is no translation table to maintain. `heatmap` is omitted from the list
response and present on the by-id response — same rule
`tiered_session_summaries` already applies at line 527, for the same reason
(a full contact grid per row makes list calls enormous).

```json
{
  "data": [
    {
      "session_id": "…",
      "athlete": { "id": "…", "first_name": "…", "last_name": "…" },
      "core_team_id": "…",
      "mode": "power",
      "date_of_record": "2026-08-19T15:04:00Z",
      "ingested_at": "2026-08-19T22:11:03Z",
      "num_events": 42,
      "session_duration_ms": 184000,
      "quality": {
        "strength_index": { "mean": 612.4, "min": 388, "max": 841, "std": 96.2 }
      },
      "peak_force_stats": {
        "peak_mv": 1820, "avg_mv": 1140, "peak_v": 1.82, "avg_v": 1.14,
        "note": "N conversion requires sensor calibration"
      },
      "cadence_hz_avg": 0.31
    }
  ],
  "next_cursor": "eyJpIjoiMjAy…",
  "has_more": true
}
```

The `quality` and `*_stats` objects are **whatever `mask_quality` /
`mask_stats` return for the program's tier** — we pass them through unchanged
rather than reshaping. Document them as "tier-dependent, additive" so adding a
metric to the pipeline is not a breaking API change.

Note that `peak_force_stats.note` is a scalar and therefore survives
`mask_stats` at every tier — partners will see the calibration caveat in the
payload, which is the right outcome while §6.4 is unresolved. Do not strip it.

### Conventions

- **Cursor pagination.** `?limit=` (default 100, max 200), `?cursor=`.
  Opaque base64 of `(ingested_at, session_id)`. No offset pagination — the
  offline outbox inserts rows out of order and offsets would skip records.
- **Incremental sync.** `?since=<iso8601>` filtered on `ingested_at`.
- **Filters.** `?mode=`, `?athlete_id=`, `?core_team_id=`, `?from=`, `?to=`
  (the latter two on `date_of_record`). These map onto the existing
  `tiered_session_summaries` parameters; do not invent new ones.
- **Errors.**
  ```json
  { "error": { "type": "tier_required", "message": "raw:read requires Tier III",
               "request_id": "req_a4f…" } }
  ```
  `401` bad/revoked key · `403` scope not on key · `402` tier does not include
  it · `404` not found *or* not in your program (never distinguish — that is an
  enumeration oracle) · `422` bad params · `429` rate limited with
  `Retry-After` · `500` with a `request_id` that appears in our logs.

### Three things the API must never return

1. **`programs.onboarding_code`.** `rls_policies.sql:88` makes `programs`
   world-readable for anonymous onboarding-code lookup, so the code is already
   more exposed than it should be. Do not compound it.
2. **`program_id IS NULL` rows.** The pre-signup `/m/home` funnel writes real
   sessions with a NULL program under the anon key
   (`supabase/reenable_rls_anon_uploads.sql:1-26`). Every API query must filter
   `program_id = <resolved>` explicitly rather than relying on a join to exclude
   them.
3. **`sessions.raw` / `events.raw`** on any endpoint other than the explicit
   NDJSON export. It is the full per-frame sample stream and will time out a
   list call.

---

## 5. Rate limiting and usage metering

**Rate limit: Postgres token bucket, not Redis.** One `UPDATE … RETURNING` per
request against a small table, inside the same connection the request already
needs. Adds a round trip; avoids adding Upstash to the stack for a surface that
will do thousands of requests a day, not thousands a second. Vercel Firewall
sits in front as the crude abuse backstop (per-IP, per-path), so a leaked key
being hammered never reaches Postgres.

Defaults, per key: **60 req/min, 10 000 req/day, 200 rows/page.** Overridable
per key via `api_keys.rate_limit_rpm` for a program doing a genuine warehouse
backfill.

**Usage metering: mirror the `app_events` design** from
`supabase/telemetry_events.sql:17-33`, which already got this right —
insert-only for the API role, **no select/update/delete**, reads exclusively via
`is_internal_admin()` definer RPCs.

```sql
create table public.api_requests (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  key_id      uuid        not null references public.api_keys(id) on delete cascade,
  program_id  uuid        not null,
  route       text        not null,      -- '/v1/sessions', normalised, never the raw path
  method      text        not null,
  status      integer     not null,
  duration_ms integer,
  rows_returned integer,
  ip          inet,
  request_id  text
);
create index api_requests_key_ts_idx     on public.api_requests (key_id, ts desc);
create index api_requests_program_ts_idx on public.api_requests (program_id, ts desc);
```

`route` must be the *normalised* template, not the actual path — a raw path
carries `session_id`s into a table we will later graph, and cardinality
explodes. Add `admin_api_pulse()` alongside `admin_platform_pulse()` so API
usage shows up on the internal dashboard from day one; usage data is also how we
find out which endpoints to deprecate.

Retention: 90 days of rows, then roll into a daily aggregate. Decide before
launch, not after the table is 400M rows.

---

## 6. Prerequisite schema work

These are not optional and none of them are API-specific — they are gaps the API
would expose.

### 6.1 `session_summaries.ingested_at` — **the important one**

There is no monotonic column to sync on. `date_of_record` is the date the
session was *hit*, not when it reached us, and `src/storage/sessionOutbox.ts` is
an IndexedDB retry outbox — a coach records offline on Friday and the rows land
Monday. A partner polling `?since=<last date_of_record seen>` would **silently
never see that session.** Silent data loss in a sync API is the worst class of
bug we could ship here.

```sql
-- Three steps, in this order. Adding the column as
-- `not null default now()` in one statement stamps every historical row with
-- the migration time, and a follow-up `where ingested_at is null` backfill
-- then matches zero rows — which defeats the entire purpose of the column for
-- all existing data.
alter table public.session_summaries add column ingested_at timestamptz;

-- Backfill: no better signal exists for historical rows.
update public.session_summaries set ingested_at = date_of_record
 where ingested_at is null;

alter table public.session_summaries
  alter column ingested_at set default now(),
  alter column ingested_at set not null;

create index idx_session_summaries_ingested
  on public.session_summaries (program_id, ingested_at desc);
```

Also add `updated_at` with a trigger if we ever reprocess summaries. Today
`tools/processSession.ts` can rewrite them, so: yes, add it.

### 6.2 Indexes

`entitlements.sql:411-422` creates four. `/v1/athletes` and `/v1/teams` also
need `athletes(program_id, core_team_id)` and `team_members(team_id)`.

### 6.3 Athlete → AMS user mapping

```sql
alter table public.athletes add column ams_user_id integer;
create unique index athletes_ams_user_idx
  on public.athletes (program_id, ams_user_id) where ams_user_id is not null;
```

Unique per program, not globally — two programs on different AMS instances can
legitimately hold the same integer id.

### 6.4 Units — RESOLVED: Strength Index substitutes for force

`session_summaries.peak_force_stats` is voltage-only today:
`peak_mv`, `avg_mv`, `peak_v`, `avg_v`, with the stored note
*"N conversion requires sensor calibration"*. Meanwhile
`src/processing/eventBuilder.ts:25-57` has `peak_force_n`, `impulse_ns`,
`peak_pressure_kpa` in the TS types that **do not all map to DB columns.**

Pushing millivolts into an AMS field a strength coach reads as "Peak Force (N)"
is worse than pushing nothing.

**Decided by Jay (2026-08-20): Strength Index is the exported intensity metric.
No force or pressure fields go to AMS.** SI is a unitless 0–1000 index and is
honest about being one, so it carries no calibration debt. This unblocks the
connector immediately.

Three implementation consequences:

1. **Nothing voltage-derived crosses into AMS.** `peak_force_stats` is not in
   the form spec at all — not renamed, not relabelled. `peak_mv` in a field
   called "Contact Intensity" is the same lie with better manners.
2. **The API still returns `peak_force_stats`** with its `note` intact (§4). The
   pull API's contract is "here is your data as stored"; the push connector's
   contract is "here is a metric a coach can act on". Different products,
   different bars.
3. **Label it as an index everywhere it surfaces.** The AMS field name carries
   the range so the number is self-describing to a coach who has never opened
   Trench — see the revised §7.5 table.

When calibration lands, newtons and kPa arrive as **additive fields in a v2 of
the form spec**, not as a redefinition of the SI fields. Programs on v1 keep
working; SI stays in the form permanently as the cross-program comparable.

### 6.5 Pre-existing leak: `iei_ms` skips `mask_stats`

`entitlements.sql:537` returns `s.iei_ms` raw whenever `v_comparative` is true,
while every sibling stats column goes through `mask_stats`. But `iei_ms` is
written as `{...statSummary, values: [...]}`
(`src/pages/session.tsx:1473-1475`) — it carries the full inter-event-interval
array. So **Tier II already receives a distribution today**, contradicting §7 of
the tier spec ("Tier II sees the mean and rank, Tier III sees the
distribution").

This is a bug in the existing entitlements work, not something the API
introduces. But the API turns it from a React component nobody renders into a
documented JSON field partners will build against, at which point removing it is
a breaking change. **Fix it in phase 1, before anything is public:**

```sql
-- entitlements.sql:537
case when v_comparative then public.mask_stats(s.iei_ms, v_tier) end,
```

Then re-check the other jsonb columns waved through at 532-538 —
`angles_deg`, `most_contacted_cell_rc`, `center_of_mass_mm` — for array-valued
keys under the same logic.

### 6.6 Athlete email required at Tier III — and the trial trap

Live data, 2026-08-21: **7 of 40 athletes have an email (17.5%).** §7.3 makes
email the only trustworthy AMS match key, so at that coverage tier-1 matching
maps seven athletes and the other 33 fall to name-only — which §7.3 says must be
*proposed, never auto-committed*. The mapping UI stops being a screen attached to
phase 5 and becomes the bulk of it.

Root cause is upstream, not drift: `src/components/importRoster.tsx:698` writes
`r.data.email || null`, and line 636 validates the *format* only when a value is
present. Email has always been optional on the main bulk-entry path.

**Decided by Jay (2026-08-21): email is required for Tier III programs.** Three
implementation consequences, and the second one is the trap.

1. **Enforce in the database, not just React.** There is no API layer — the
   browser writes `athletes` directly, so a React validation is advisory.
   `entitlements_enforcement.sql:249` (`tg_limit_athletes`) is the established
   pattern: a `before insert` trigger that reads tier via `effective_limit` /
   `program_tier`. The email rule belongs beside it as a sibling trigger, with
   the UI reduced to producing a good error message.

2. **Scope on `plan = 'III'`, NOT `program_tier(id) = 'III'`.**
   `program_tier` (`entitlements.sql:160-178`) deliberately returns `'III'` for
   any trial program still inside its window — "show the ceiling", per the
   comment at line 155. Enforcing on `program_tier` therefore blocks roster
   import for every brand-new signup during onboarding, which is exactly where
   `importRoster` is used most and where friction costs conversions. Assigned
   Tier III is the paying integrator; trials get a hard warning, not an error.

3. **Upgrades arrive dirty.** A trigger on insert grandfathers in every athlete
   a program created before it reached Tier III, so their AMS mapping still
   cannot match. Surface "N athletes missing email" on the phase-5 AMS setup
   screen, where the admin is already in a fixing mindset, rather than adding an
   update-path trigger that fires while a coach edits an unrelated field.

**Also add an optional `AMS User ID` column to `importRoster`.** Email only helps
matching *probabilistically*, and only when both sides have it. `ams_user_id`
(§6.3) is the field AMS actually requires, and a program already living in AMS
can paste userIds at import time. The importer's CSV parsing, validation,
duplicate detection and cap-checking are all built already — one more optional
column reuses the lot, and it is a deterministic mapping path that works at
100-athlete roster scale without a human confirming anything.

---

## 7. Teamworks AMS connector (push)

Docs read: [Getting Started](https://docs.ams.teamworksapp.com/docs/getting-started),
[Authentication](https://docs.ams.teamworksapp.com/docs/authentication),
[Data Structures](https://docs.ams.teamworksapp.com/docs/understanding-ams-data-structures),
[Pushing Data](https://docs.ams.teamworksapp.com/recipes/pushing-data-to-ams),
[Syncing Data](https://docs.ams.teamworksapp.com/recipes/syncing-data-to-an-external-system).

### 7.1 What AMS actually is, and why that shapes everything

AMS (formerly Smartabase) is a **no-code platform**. There is no canonical
"training session" object — every organisation's admins built their own forms
with their own names, and *the API addresses forms and fields by those exact
case-sensitive names.* From the docs: "you will not find terms like 'Training
Sessions' … anywhere in this documentation."

Three consequences:

1. **Every program is a bespoke field mapping** unless we impose one. See 7.5.
2. **Schema discovery is a runtime step**, not a build-time constant, and must
   be re-run whenever a program's AMS builder edits the form.
3. **Data is stored per User.** Everything hangs off an integer `userId`. We
   cannot push anything until every Trench athlete is mapped to an AMS user.

### 7.2 Auth — and the hard problem it creates

AMS has **no OAuth and no API keys.** v1 is HTTP Basic Auth with an AMS
*username and password*; v2/v3 use a two-step session flow that still starts
from username and password.

So: **to push into a program's AMS, we must hold that program's AMS
credentials.** There is no delegated-access path. This is the single biggest
security consideration in this document and it needs to be a deliberate
decision, not an implementation detail.

```sql
create table public.ams_connections (
  program_id        uuid        primary key references public.programs(id) on delete cascade,
  created_at        timestamptz not null default now(),
  ams_server        text        not null,   -- 'x.smartabase.com'
  ams_app_name      text        not null,   -- site name in the URL path
  ams_username      text        not null,
  ams_password_enc  bytea       not null,   -- AES-256-GCM, key in Vercel env
  ams_password_nonce bytea      not null,
  event_form_id     integer,
  event_form_name   text,
  field_map         jsonb       not null default '{}'::jsonb,
  date_format       text        not null default 'DD/MM/YYYY',
  status            text        not null default 'pending'
                      check (status in ('pending','active','error','disabled')),
  last_error        text,
  last_user_sync_at timestamptz,
  last_user_sync_token bigint,   -- AMS lastSynchronisationTimeOnServer
  last_push_at      timestamptz
);

alter table public.ams_connections enable row level security;
-- NO policies. Not one. Readable only by definer functions and service_role.
```

Rules, non-negotiable:

- RLS on, **zero policies** — same technique as `internal_admins`
  (`supabase/telemetry_admin.sql:25-50`), which is invisible to the browser
  entirely.
- Password encrypted app-side (AES-256-GCM, key in a Vercel env var) *before*
  it reaches Postgres, so a database read alone does not yield credentials.
  Consider Supabase Vault / pgsodium instead — decide in phase 4.
- Never logged, never returned by any endpoint, never echoed back into a form
  field. Write-only from the admin UI.
- Credentials are collected **per program**, entered by that program's AMS
  administrator. Trench never uses one shared AMS account across customers.

**Onboarding blocker to surface in the UI:** the docs state that if a site
enforces MFA, SSO, or Terms Documents, the API account **must be exempted by an
AMS administrator first**, and the account needs Coach access to every athlete
plus Read+Write on the target form. That is a task for the program's IT, it can
take days, and it will be the number-one reason a connector sits in `pending`.
Say so explicitly on the setup screen with a copy-pasteable request.

Also send `X-APP-ID: trenchsports.ams.integration` on every request — optional
per the docs, but it is how Teamworks support identifies our traffic when
something breaks.

### 7.3 Roster mapping

`POST /api/v1/usersynchronise` with `lastSynchronisationTimeOnServer: 0` and
empty `userIds` on first run, then the stored token thereafter. Cache the users;
the docs are explicit that we should never fetch the full list on every call.

Match Trench `athletes` → AMS users on:

1. `email` exact, case-insensitive — the only trustworthy key
2. `first_name` + `last_name` + DOB
3. `first_name` + `last_name` alone → **propose, never auto-commit.** Surface
   these in the admin UI for a human to confirm. Silently mapping two athletes
   named J. Williams is a data-integrity incident that shows up months later.

Handle all three response branches or the cache rots:

- `users[]` → upsert
- `mergedUsers[]` → `{oldId, newId}`; drop `oldId`, repoint any
  `athletes.ams_user_id = oldId` to `newId`
- `idsOfDeletedUsers[]` → null out `ams_user_id`, mark the athlete unmapped

Store the returned `lastSynchronisationTimeOnServer` in
`last_user_sync_token`. Re-sync nightly.

### 7.4 Form discovery

Per the docs, before building anything: `GET /api/v3/forms/summaries` to list
forms the account can see, then `GET /api/v3/forms/event/{form_id}` for exact
field names and types. Persist the result in `field_map`.

Re-run discovery on a schedule and on every push failure. A builder renaming one
field breaks the integration silently otherwise — `eventimport` will happily
accept a payload and drop the unrecognised keys.

### 7.5 The reference form spec — the actual product decision

Rather than mapping fields bespoke per customer, **publish a Trench Sports
reference AMS event form** and ask each program's AMS builder to create it once.
Then `field_map` is a default, not a project.

Proposed form: `Trench Sports Session`, one record per session, single row.

| AMS field name | Source | Type |
|---|---|---|
| `Session ID` | `session_summaries.session_id` | Text |
| `Mode` | `mode` | Text |
| `Strikes` | `num_events` | Number |
| `Duration (s)` | `session_duration_ms / 1000` | Number |
| `Strength Index Avg (0-1000)` | `quality.strength_index.mean` | Number |
| `Strength Index Peak (0-1000)` | `quality.strength_index.max` | Number |
| `Strength Index Low (0-1000)` | `quality.strength_index.min` | Number |
| `Cadence (Hz)` | `cadence_hz_avg` | Number |
| `Accuracy (%)` | `quality.accuracy_pct` | Number · accuracy mode only |
| `Avg Reaction (ms)` | `quality.avg_reaction_ms` | Number · reaction mode only |
| `SI Trend` | `quality.si_trend` | Text · volume mode only |
| `SI Fatigue Slope` | `quality.si_fatigue_slope` | Number · volume mode only |
| `Trench Link` | deep link to the session in Trench | Text |

**No force or pressure fields — settled, not deferred (§6.4).** Strength Index
is the exported intensity metric. The `(0-1000)` in each field name is load-
bearing: an AMS coach seeing `Strength Index Avg: 612` next to a GPS field in
m/s² needs the range inline to read it, and it pre-empts the "is this newtons?"
question that would otherwise arrive as a support ticket.

`min` is included because `si_fatigue_slope` is only written for volume-mode
sessions. On a power, accuracy, reaction or target session the SI floor next to
the SI average is the only within-session drop-off signal in the payload, and it
costs one field.

**Two accessor traps, both verified against the write path:**

1. `quality.strength_index` is `statSummary(siVals)` — `{mean, min, max, std}`
   (`src/pages/session.tsx:905-911,1496`). There is **no `.avg` and no
   `.peak`.** Reading those returns `undefined`, which coerces to an empty
   string and pushes blank Strength Index fields into a customer's AMS with a
   `SUCCESSFULLY_IMPORTED` response. Exactly the silent failure §7.6 warns
   about.
2. The per-event `events.strength_index` is a **different shape** —
   `{ value }` (`session.tsx:1169`). `/v1/sessions/{id}/events` cannot reuse the
   summary accessor.

**Four of the eleven fields are mode-conditional**, not sparse by accident
(`session.tsx:1489-1501`): `accuracy_pct` exists only for accuracy sessions,
`avg_reaction_ms` only for reaction, `si_trend` / `si_fatigue_slope` only for
volume. A power session therefore pushes a record with four empty fields. Say so
in the form spec we hand to AMS builders, or coaches will read mostly-blank
records as a broken integration. Consider instead **one AMS form per mode**, or
a single form where the mode-specific fields live in a clearly labelled section.

`Trench Link` is worth more than it looks: it turns every AMS record into a
funnel back into our dashboard, which is where the analysis actually lives.

### 7.6 Push mechanics

Use **v1 `POST /api/v1/eventimport?informat=json&format=json`** with Basic Auth.
v3 is cleaner (flat payload, addressed by numeric `formId`) but requires
maintaining a session across the two-step login and re-authing on expiry. Start
with v1; the payload shape is uglier but the auth is stateless, which matters
for a serverless function that may cold-start per invocation.

```json
{
  "formName": "Trench Sports Session",
  "startDate": "19/08/2026",
  "startTime": "3:04 PM",
  "finishDate": "19/08/2026",
  "finishTime": "3:07 PM",
  "userId": { "userId": 1009 },
  "rows": [ { "row": 0, "pairs": [ { "key": "Mode", "value": "power" } ] } ]
}
```

Four traps in that payload, all from the docs:

1. **Every `value` must be a string**, including numeric fields. Coerce, don't
   trust `JSON.stringify` of a number to happen by accident.
2. **Field names are case-sensitive and must match the form exactly.** Drive
   them from `field_map`, never from a hard-coded literal.
3. **Date format.** The docs' examples are `08/05/2026` for a date described as
   8 May — DD/MM/YYYY, consistent with AMS's Australian origin. But this is
   almost certainly instance-configurable and a US college site may well be
   MM/DD/YYYY. Hence `ams_connections.date_format`, and hence: **verify against
   the customer's live instance during setup by pushing one test record and
   reading it back.** Do not assume. Silently swapping day and month for eleven
   months of the year is the exact kind of bug nobody notices until the season
   is over.
4. **Update replaces, it does not patch.** Adding `existingEventId` replaces the
   whole event — any field omitted is *cleared*. Always send the complete
   payload.

Success is `{"state": "SUCCESSFULLY_IMPORTED", "ids": [137342]}`. Anything else
is a failure regardless of HTTP status; check `state`, not just `resp.ok`.

### 7.7 Idempotency and delivery

```sql
create table public.ams_push_log (
  session_id     text        primary key references public.sessions(id) on delete cascade,
  program_id     uuid        not null,
  ams_event_id   integer,              -- from ids[0]; presence = pushed
  attempts       integer     not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  status         text        not null default 'pending'
                   check (status in ('pending','pushed','failed','skipped')),
  last_error     text
);
```

Store `ams_event_id` so a re-push sends `existingEventId` and updates in place.
Without it, every retry creates a duplicate record in the customer's AMS — and
we will not be the ones who have to clean that up.

**Trigger: Vercel Cron every 15 minutes, polling the outbox.** Not a Postgres
`pg_net` webhook on insert. Reasons:

- Retries, exponential backoff and dead-lettering are trivial in a cron loop
  and awkward in a trigger
- It survives AMS being down for an afternoon without losing anything
- It is inspectable — `select * from ams_push_log where status = 'failed'` is
  the whole debugging story
- It matches the outbox pattern already used client-side in
  `src/storage/sessionOutbox.ts`, including its "parked" concept for rows that
  should stop being retried

Latency is 15 minutes worst case. For a strength coach reviewing yesterday's
session, that is invisible. Add a Supabase Database Webhook for near-real-time
later if a customer actually asks.

Backoff: 1m, 5m, 30m, 2h, 12h, then park as `failed` and alert internally.
`status = 'skipped'` for sessions whose athlete has no `ams_user_id` — those are
a mapping problem to surface in the UI, not a failure to retry forever.

### 7.8 Roster sync the other direction — explicitly deferred

Pulling athletes *out* of AMS to auto-create Trench athletes is the obvious next
ask and `usersynchronise` already gives us the data. Not in scope here: it needs
a conflict-resolution policy (who wins when a name differs?) and it interacts
with `programs.max_athletes` enforcement, which
`entitlements_enforcement.sql` only recently started enforcing. Separate plan.

---

## 8. Webhooks (phase 6)

Promised in `dummy.tsx:2492-2521` as "optional webhook on session completion".

Events: `session.completed`, `session.summary.updated`, `ams.push.failed`.

Signing: `X-Trench-Signature: t=<unix>,v1=<hmac_sha256(t + "." + body, secret)>`,
per-endpoint secret shown once. Reject timestamps older than 5 minutes on the
receiving side and document that. Same outbox + backoff machinery as `ams_push_log`
— build it once in phase 5 and reuse it.

---

## 9. Phases

| # | Deliverable | Depends on | Notes |
|---|---|---|---|
| 0 | Schema prereqs: `ingested_at`, `updated_at`, indexes, `athletes.ams_user_id` | — | §6. Ship independently, low risk |
| 1 | Refactor §6 into shared scoping core + `api_*` callers; fix the `iei_ms` mask leak | 0 | §1, §6.5. Otherwise a pure refactor — existing output must be unchanged |
| 2 | `api_keys` + RPCs + admin UI + `/v1/whoami` + rate limit + `api_requests` | 1 | No data endpoints. Proves the whole auth path |
| 3 | `/v1/teams`, `/v1/athletes`, `/v1/sessions`, `/v1/sessions/{id}` | 2 | The actual pull API |
| 4 | `/v1/sessions/{id}/events`, CSV + NDJSON exports | 3 | Tier III raw export, closes `entitlements.sql:836` |
| 5 | `ams_connections` + credential vault + form discovery + roster mapping UI | 0 | §7.2–7.5. Ship the setup flow before the push |
| 6 | `ams_push_log` + Vercel Cron + idempotent upsert | 5 | §7.6–7.7. The enterprise close |
| 7 | Outbound webhooks | 6 | Reuses phase 6 machinery |
| 8 | Public docs, sandbox `ts_sk_test_` key, OpenAPI spec, `api.trenchsports.ai` | 3 | Do not launch phase 3 publicly without this |

Phases 2 and 5 are independently valuable and touch different code. They can run
in parallel.

---

## 10. Decisions

### Decided by Jay, 2026-08-20

1. **AMS push sits at Tier III, under the existing `apiAccess` flag.** No
   separate SKU, no `amsIntegration` feature flag. `tier_features`
   (`entitlements.sql:266`) needs no change, and the `ams:push` scope in §3 is
   gated on `apiAccess` like every other scope. Implementation note: this means
   **a program dropping from Tier III to Tier II must stop pushing to AMS.**
   Handle it explicitly — `ams_connections.status` moves to `disabled` and the
   outbox parks rather than failing, so reinstating the tier resumes the
   connector without a manual re-setup. A silently dead connector that a coach
   discovers three weeks later is a churn event.
2. **Strength Index is the exported intensity metric; no force or pressure
   fields.** See §6.4 and §7.5. Calibration is no longer a dependency for any
   phase in §9.

### Decided by Jay, 2026-08-21

7. **Athlete email is required for Tier III programs** — scoped to
   `plan = 'III'`, not `program_tier() = 'III'`, so active trials are warned and
   not blocked. Enforced by a trigger in `entitlements_enforcement.sql`, not in
   React. Plus an optional `AMS User ID` column in `importRoster`, which is the
   deterministic mapping path. See §6.6. Numbered 7 rather than 3 so the open
   items keep the numbers the runbook cites.

### Still open

3. **Credential storage mechanism** — app-level AES-GCM with a Vercel env key,
   or Supabase Vault / pgsodium? Vault keeps the key out of our application
   code; app-level keeps decryption off the database host. Recommendation:
   Vault, with the caveat that it needs a spike first.
4. **Key expiry default** — NULL as proposed, or force annual rotation? Security
   review may want rotation; partners will hate it. Recommendation: NULL, with
   `expires_at` available and a rotation reminder email at 12 months.
5. **Does a partner key ever see another core team's data?** Today
   `tiered_session_summaries` scopes a coach to their core team and an admin to
   the program. An API key is program-level, i.e. admin-equivalent. Confirm that
   is intended — a program with several sports on one Trench account would be
   handing its whole roster to one integration.
6. **`programs_select_public`** (`rls_policies.sql:88`) makes program names,
   locations, plans and onboarding codes readable by `anon`. Unrelated to this
   plan, but it should be tightened before we publish API docs that draw
   attention to the schema.

---

## 11. Verification plan

Per-phase, in the style of the `VERIFY` blocks in
`supabase/coach_invite_links.sql:485-529`.

**Phase 1 (refactor).** Before/after diff of `tiered_session_summaries()` output
for a Tier I, Tier II and Tier III program — must be byte-identical. This is the
whole safety argument for the refactor.

**Phase 2 (keys).**
- Key from program A returns 404, never 403, for program B's session id
- Revoked key → 401 immediately, not after a cache TTL
- Key on a `status = 'suspended'` program → 402
- Key on a Tier II program → 402 on every endpoint (`apiAccess` false)
- 61 requests in a minute → the 61st is 429 with `Retry-After`
- Plaintext key appears in exactly one place ever: the create response body.
  Grep the logs, grep `api_keys`, grep `pg_stat_statements`.

**Phase 3 (reads).**
- Tier I key: `quality` contains `strength_index` and nothing else; no
  `si_fatigue_slope`
- Tier II key: no distribution (array-valued) keys in `peak_force_stats`,
  `impulse_stats` or `duration_ms_stats` — `mask_stats`
  (`entitlements.sql:383-398`) strips them below Tier III.
  **But see §6.5 — `iei_ms` bypasses `mask_stats` entirely and will leak an
  array at Tier II. Fix before phase 3, then assert it here.**
- `?since=` picks up a session backdated via `date_of_record` but inserted now —
  the §6.1 regression test. **This is the one to write first.**
- Cursor pagination over 500 sessions returns each exactly once with concurrent
  inserts happening
- No response anywhere contains `onboarding_code`, `raw`, or a NULL-program row

**Phase 6 (AMS push).**
- Push one session, read it back through `/api/v1/synchronise`, assert every
  field round-trips **and the date is the date we meant** (§7.6 trap 3)
- Push the same session twice → one AMS record, updated, not two
- Kill the AMS credential mid-run → status `failed`, backoff honoured, no
  duplicate on recovery
- Rename a field in the AMS form → discovery detects it and the connector errors
  loudly rather than pushing a payload that silently drops the field
- Athlete with no `ams_user_id` → `skipped`, surfaced in the UI, not retried
  forever
- No AMS field ever receives a voltage-derived value. Assert on the outbound
  payload, not just the form spec — a `field_map` edit is all it would take
- **Downgrade Tier III → Tier II mid-season:** connector moves to `disabled`,
  outbox parks, admin sees why. Restore the tier → the parked sessions push,
  once each, with no duplicates (§10 decision 1)
