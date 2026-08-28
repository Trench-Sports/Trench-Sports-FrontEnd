# API + Push Infrastructure — Build Runbook

Status: v1.1 · 2026-08-21 · owner: Jay
Preflight 0.1-0.5 partially run; 0.4 returned 7/40 athletes with email → step 1b.
Companion to `docs/api-and-integrations-plan.md`. The plan says *what* and *why*;
this says *in what order, in which file, and what to check before moving on*.

Three things you asked for, and where each one lands:

| Ask | Lands in | Step |
|---|---|---|
| Secret token to pull the API directly | `api_keys` + `/api/v1/*` Vercel Functions | 3–4 |
| Internal dashboard: who has access to what | `admin_access_matrix()` + a panel in `src/pages/admin.tsx` | 5 |
| Teamworks AMS push | `ams_connections` + `ams_push_log` + Vercel Cron | 7–9 |

**Nine steps. Steps 1–5 are one sequence; 6–9 can run in parallel with 4–5 once
step 1 has shipped.**

---

## Corrections to the plan, found by reading the schema

Five of these change what you type. Read them before step 1.

1. **The `ingested_at` backfill in plan §6.1 is wrong, and it fails loudly.**
   The plan backfills from `date_of_record`, calling it the best available
   signal. It isn't. `public.sessions.created_at` is `timestamptz NOT NULL
   DEFAULT now()` (`supabase/schema.sql:135`) — that *is* the row-arrival time,
   which is exactly what `ingested_at` means. And `session_summaries.
   date_of_record` is **nullable** (`schema.sql:212`), so the plan's backfill
   leaves NULLs behind and the follow-up `alter column ... set not null` throws.
   Corrected statement in step 1.

2. **`session_summaries.program_id` is nullable** (`schema.sql:195`). This is the
   same hole plan §4 flags — the pre-signup `/m/home` funnel writes real sessions
   with a NULL program. Make the new sync index partial so those rows can never
   be paged over by an API cursor.

3. **The plan never says which Supabase key the Vercel function holds.** It has
   to be `service_role`, and that does *not* contradict §1. Detail in step 3.

4. **`tiered_session_summaries` is dropped by exact signature**
   (`entitlements.sql:450`). The refactor changes the signature, so that DROP
   line must change with it or the old overload survives and PostgREST sees two
   candidate functions. Detail in step 2.

5. **`schema.sql:12` is stale about `programs.plan`, and it broke query 0.5
   below.** The file still shows the old CHECK
   `['trial','free','pro','enterprise']`, but `entitlements.sql:71-79` migrated
   the column to `['trial','I','II','III']`. Query 0.5 as first written filtered
   `plan in ('pro','enterprise')`, which matches **nothing** — it would have
   silently reported that you have no Tier III test population. Corrected in
   step 0. Trust `entitlements.sql` over `schema.sql` on anything tier-related;
   `schema.sql`'s own header admits it drifts.

---

## Step 0 — Preflight (30 minutes, no code)

Run these against live Supabase before you write a migration. Each one can
change what you build.

```sql
-- 0.1 pgcrypto is where it needs to be. Must return `pgcrypto | extensions`.
--     coach_invite_links.sql:36 already depends on this; api_keys will too.
select extname, extnamespace::regnamespace from pg_extension where extname = 'pgcrypto';

-- 0.2 How much orphan data would an API cursor walk over?
select count(*) filter (where program_id is null)  as null_program,
       count(*) filter (where date_of_record is null) as null_date,
       count(*)                                     as total
from public.session_summaries;

-- 0.3 Does every summary have a parent session row? Decides whether the
--     step-1 backfill can rely on the join alone.
select count(*) from public.session_summaries ss
 left join public.sessions s on s.id = ss.session_id
 where s.id is null;

-- 0.4 AMS matching viability. Plan §7.3 makes email the only trustworthy key,
--     but athletes.email is NULLABLE (schema.sql:62). If this is under ~60%,
--     the roster-mapping UI is the main phase-5 work, not the push itself.
select count(*) as athletes,
       count(email) as with_email,
       count(date_of_birth) as with_dob
from public.athletes;

-- 0.5 Who are the Tier III programs? This is your phase-3 test population,
--     AND the population the step-1b email rule applies to. Note the split
--     between plan='III' (paying integrators) and plan='trial' (inside window,
--     shown the ceiling by program_tier) — the email rule hits only the former.
--     Do NOT filter on plan in ('pro','enterprise'): those values no longer
--     exist. See correction 5.
select id, name, plan, status, is_grandfathered,
       public.program_tier(id) as tier
  from public.programs
 where public.program_tier(id) = 'III'
 order by name;
```

**Also know this before you start:** `.simple-git-hooks` runs
`npm run typecheck && node scripts/audit.mjs` on every push, and `audit.mjs:78`
fires audit agents on *any* change under `supabase/**.sql`. Every step below
touches SQL, so budget an audit review pass per push. That's a feature — it's the
RLS reviewer — but it isn't free.

---

## Step 1 — Schema prereqs (plan phase 0)

New file: `supabase/api_prereqs.sql`. Idempotent, safe to re-run, ships alone.
Nothing here is API-specific; it closes gaps the API would expose.

```sql
begin;

-- ── 1a. ingested_at — the monotonic sync column ─────────────────────
-- WHY: date_of_record is when the session was HIT. src/storage/sessionOutbox.ts
-- is an IndexedDB retry outbox, so a Friday session can land Monday. A partner
-- polling ?since=<last date_of_record> would silently never see it. Silent
-- data loss is the worst bug class available to a sync API.
alter table public.session_summaries add column if not exists ingested_at timestamptz;
alter table public.session_summaries add column if not exists updated_at   timestamptz;

-- Backfill. NOT from date_of_record (plan §6.1) — sessions.created_at is
-- `not null default now()` and is literally the arrival timestamp. The
-- coalesce chain matters because date_of_record is nullable, and without it
-- the `set not null` below fails on those rows.
update public.session_summaries ss
   set ingested_at = coalesce(s.created_at, ss.date_of_record, now())
  from public.sessions s
 where s.id = ss.session_id
   and ss.ingested_at is null;

-- Sweep any summary with no parent session row (check 0.3).
update public.session_summaries
   set ingested_at = coalesce(date_of_record, now())
 where ingested_at is null;

alter table public.session_summaries
  alter column ingested_at set default now(),
  alter column ingested_at set not null;

update public.session_summaries set updated_at = ingested_at where updated_at is null;
alter table public.session_summaries
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.touch_session_summary()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_session_summaries_touch on public.session_summaries;
create trigger trg_session_summaries_touch
  before update on public.session_summaries
  for each row execute function public.touch_session_summary();

-- ── 1b. Indexes ──────────────────────────────────────────────────────
-- Partial: NULL-program rows must never be reachable by an API cursor, and
-- excluding them keeps the index smaller than the table's row count.
create index if not exists idx_session_summaries_ingested
  on public.session_summaries (program_id, ingested_at desc)
  where program_id is not null;

-- /v1/athletes and /v1/teams (plan §6.2). Neither exists today.
create index if not exists idx_athletes_program_core
  on public.athletes (program_id, core_team_id);
create index if not exists idx_team_members_team
  on public.team_members (team_id);

-- ── 1c. AMS user mapping ─────────────────────────────────────────────
-- Unique per program, not globally: two programs on different AMS instances
-- can legitimately hold the same integer id.
alter table public.athletes add column if not exists ams_user_id integer;
create unique index if not exists athletes_ams_user_idx
  on public.athletes (program_id, ams_user_id) where ams_user_id is not null;

commit;
```

## Step 1b — Athlete email required at Tier III (plan §6.6)

Same file, same migration. Preflight 0.4 came back **7 of 40 athletes with an
email — 17.5%**, against the ~60% the AMS match path needs. Without this, step 7
maps seven athletes and hands 33 to a human.

```sql
-- Required for Tier III only. NOT program_tier(), which returns 'III' for any
-- trial inside its window (entitlements.sql:155-178, "show the ceiling") — that
-- would block roster import during onboarding, which is where importRoster gets
-- used most. Assigned Tier III is the paying integrator; trials get a UI warning.
create or replace function public.tg_require_athlete_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan text;
begin
  if new.program_id is null or nullif(trim(new.email), '') is not null then
    return new;
  end if;

  select plan into v_plan from public.programs where id = new.program_id;

  if v_plan = 'III' then
    raise exception
      'Athlete email is required for Tier III programs (needed for Teamworks AMS matching)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_require_athlete_email on public.athletes;
create trigger trg_require_athlete_email
  before insert or update of email on public.athletes
  for each row execute function public.tg_require_athlete_email();
```

**`insert or update of email`, not insert-only.** The original rule here was
insert-only, on the reasoning that an update-path trigger would fire while a
coach edits an unrelated field on a legacy athlete and produce a baffling error.
That reasoning is right but the remedy was too broad: insert-only leaves a hole
where a Tier III athlete's email can be *cleared* after the fact. As shipped in
`supabase/api_prereqs.sql`, `update of email` fires only when the UPDATE actually
touches that column, and the function additionally returns early unless the email
is going from present to absent. So:

- editing `position` on a legacy emailless athlete → trigger does not fire
- inserting an emailless athlete on a `plan = 'III'` program → **23514**
- clearing an existing email on a `plan = 'III'` program → **23514**
- a legacy emailless row on an upgraded program → still editable

The last one is the residual consequence and it is intentional: **a program
upgrading to Tier III arrives with dirty rows.** Every athlete created before the
upgrade is grandfathered in and still unmappable. Handle it in step 7's setup
screen as "N athletes missing email", where the admin is already fixing things,
not by widening this trigger.

**Then the three UI sites**, none of which are load-bearing for correctness now
that the DB enforces it — they exist to produce a good message instead of a
Postgres error:

- `src/components/importRoster.tsx:636` — currently format-checks only when a
  value is present, and line 698 writes `r.data.email || null`. For a
  `plan = 'III'` program, a missing email becomes `status: "error"`; everyone
  else gets `status: "warning"` with the reason "required for Teamworks AMS
  matching". Coaches supply data when they know what breaks without it.
- Any single-athlete add form — check the web dashboard **and** both mobile
  paths. This codebase triplicates.

**Also add an optional `AMS User ID` column to `importRoster`** (plan §6.6). Email
helps matching only probabilistically and only when both sides have it;
`ams_user_id` is what AMS actually requires, and a program already in AMS can
paste userIds at import. The importer's parsing, validation, duplicate detection
and cap-checking already exist — one column reuses all of it and gives you a
deterministic mapping path at 100-athlete scale.

**Verify:**

```sql
-- On a plan='III' program: must raise 23514.
-- On a plan='trial' or 'II' program: must succeed.
-- Existing rows must be untouched — this is insert-only.
select p.plan, count(*) filter (where a.email is null) as missing_email, count(*)
  from public.athletes a join public.programs p on p.id = a.program_id
 group by p.plan order by p.plan;
```

---

**Then** grant read on the new column, because `entitlements.sql:784` revoked
whole-table SELECT and grants back a named column list. `ingested_at` is not on
it, so it is currently unreadable by `authenticated`:

```sql
grant select (ingested_at, updated_at) on public.session_summaries to authenticated;
```

**Verify before moving on:**

```sql
-- No NULLs, and historical rows did NOT all get stamped with the migration time.
select count(*) as n, min(ingested_at), max(ingested_at) from public.session_summaries;
select count(*) from public.session_summaries where ingested_at is null;  -- 0
-- Sanity: ingested_at should differ from date_of_record for at least some rows.
select count(*) from public.session_summaries where ingested_at <> date_of_record;
```

Then update `supabase/schema.sql` — its header says the live project is the
source of truth and the file must be kept in sync.

---

## Step 2 — Scoping core refactor (plan phase 1)

The one architectural decision. Edit `supabase/entitlements.sql` §6 in place.

**Goal:** the row-scoping and masking logic lives in one function that takes
identity as parameters. Two thin callers resolve identity differently. No
predicate is written twice.

```
scoped_session_summaries(p_program_id, p_role, p_core_team_id, p_tier, filters…)
        ▲                                          ▲
tiered_session_summaries()              api_session_summaries(p_key_hash, filters…)
  identity from auth.uid()                identity from api_keys
```

**2a. Extract the core.** Take the body of `tiered_session_summaries`
(`entitlements.sql:451-553`) and lift lines 511-551 into
`public.scoped_session_summaries(...)`, replacing the four `declare` lookups
(`my_tier()`, `get_my_program_id()`, `get_my_role()`, `get_my_core_team_id()`)
with parameters. `SECURITY DEFINER`, `set search_path = public`, **no `auth.uid()`
anywhere in the body**, and `revoke all ... from public` — the core is never
directly callable.

**2b. Add the API-shaped parameters to the core**, not to the browser caller:

- `p_since timestamptz` → `and ss.ingested_at >= p_since`
- `p_cursor_ingested timestamptz` + `p_cursor_session_id text` → the keyset
  predicate `(ss.ingested_at, ss.session_id) < (p_cursor_ingested, p_cursor_session_id)`
- `p_limit int` → **NOT** `limit least(coalesce(p_limit, 100), 200)`. That is
  wrong and it fails silently: `least(NULL, 200)` returns **200** in Postgres,
  because LEAST ignores NULLs. The browser caller passes no limit, so that
  expression would cap the entire app at 200 rows. Use
  `limit case when p_limit is null then null else least(greatest(p_limit, 1), 200) end`
  — `LIMIT NULL` is unlimited.
- Add `ingested_at` to the core's `returns table` list, **appended last**, and
  do NOT add it to `tiered_session_summaries` — see 2c.
- Order the core by `ingested_at desc, session_id desc` **always**, not only
  when a cursor is in play, and let the browser caller re-sort by
  `date_of_record desc`. A conditional ORDER BY inside the core needs either
  CASE expressions (which defeat the `(program_id, ingested_at desc)` index and
  force a sort of the whole filtered set) or two duplicated `return query`
  branches. Re-sorting in the caller costs nothing — that path has no LIMIT, so
  Postgres was already sorting the full result — and it keeps the keyset
  predicate aligned with the only sort the core ever emits.
- Keep `and ss.program_id = p_program_id` **explicit**. Never rely on the athletes
  join to exclude NULL-program rows.

**2c. Do NOT change `tiered_session_summaries`' signature or return type.**
The earlier instruction here was to add `ingested_at` to it and update the DROP
to match. That is wrong, and it breaks the CSV export: `export_session_summaries`
(6c) does `select * from public.tiered_session_summaries(...)` into its own fixed
22-column `returns table`, so a 23rd column is a column-count mismatch at
runtime. Eleven call sites in `src/pages/dashboard.tsx` also read named fields
off the result.

Keep the browser caller at exactly 5 args and exactly 22 return columns. The
core carries `ingested_at` and the four API params; the caller projects
`ingested_at` away and passes NULL for the rest. Two payoffs beyond not breaking
6c: the existing DROP at `entitlements.sql:450` stays correct as written, and the
byte-identical proof becomes a genuine `select *` diff instead of an
old-column-list approximation.

The DROP trap the original text was worried about is still real, just for the
**new** function: add a `drop function if exists public.scoped_session_summaries(…)`
with its full 13-argument signature ahead of the `create or replace`, or a
re-run after adding a column fails. Same trap at line 576 for
`tiered_session_events` whenever 6b gets the same treatment (step 6 — it still
carries its own copy of the predicate for now, and the §6 header records that).

**2d. Fix the `iei_ms` mask leak — do it now, not later.**
`entitlements.sql:537` returns `s.iei_ms` raw whenever `v_comparative` is true,
while every sibling stats column goes through `mask_stats`. But `iei_ms` is
written as `{...statSummary, values: [...]}` (`src/pages/session.tsx:1473-1475`),
so it carries the full inter-event-interval array — **Tier II receives a
distribution today**, contradicting the tier spec. Harmless while it's an
unrendered React field. Not harmless once it's a documented API response, at
which point removing it is a breaking change.

```sql
-- entitlements.sql:537
case when v_comparative then public.mask_stats(s.iei_ms, v_tier) end,
```

Then re-check the three columns waved through at 532-534 — `angles_deg`,
`most_contacted_cell_rc`, `center_of_mass_mm` — for array-valued keys under the
same logic. `mask_stats` (`entitlements.sql:383-398`) strips exactly and only
array-valued keys below Tier III, so the test is `jsonb_typeof(value) = 'array'`
on live data. `angles_deg` is already clean — it is written as bare
`statSummary(angleVals)` (`session.tsx:1478`), four scalars, no `values` array —
so the two to actually check are `most_contacted_cell_rc` and
`center_of_mass_mm`:

```sql
select key, jsonb_typeof(value), count(*)
from public.session_summaries s,
     lateral jsonb_each(coalesce(s.angles_deg,'{}') || coalesce(s.center_of_mass_mm,'{}'))
group by 1,2 order by 3 desc;
```

**2e. The safety argument, and it is the whole safety argument.** This step is a
pure refactor: output must be byte-identical. Prove it, don't assume it.

The harness is `supabase/verify_step2_refactor.sql`. `copy … to '/tmp/…'` does
not work against hosted Supabase (no filesystem access from the SQL editor), so
it snapshots into real tables instead and diffs them in SQL. Run **Part A before
applying the refactor** — once it is applied the "before" is unrecoverable
without a revert.

Four test users, not three: a coach at each of Tier I / II / III for the masking
branches, **plus an admin at Tier III**. The admin branch is the one
`api_session_summaries` will pass in step 3, so skipping it leaves the API's own
scoping path as the only unproven one.

Three things the harness checks that a plain `select *` diff would miss:

- **Row multiplicity.** `EXCEPT` is set-based and collapses duplicates, so a
  doubled row passes a naive diff. Count separately.
- **Emission order.** Captured via `row_number() over ()`. This matters here
  specifically because the core's ORDER BY changed and the caller's re-sort is
  what compensates — that compensation is the thing under test. Ties on
  `date_of_record` reshuffle harmlessly and the check excludes them.
- **`least(NULL, 200)`.** D5 asserts the browser still gets every row. Use the
  largest Tier III program you have; under 200 summaries the test proves nothing.

Plus two greps against `pg_proc` rather than the file, so they check what is
actually installed: the core must contain no `auth.uid()` / `get_my_*` /
`my_tier()`, and the caller must contain no `mask_*` or `session_summaries s`.

The `iei_ms` fix in 2d will legitimately change the Tier II output. Capture the
before/after with 2d **reverted**, confirm identical, then apply 2d as its own
commit with its own one-line diff. Two commits, two proofs.

---

## Step 3 — Token model and the API's own identity (plan phase 2, SQL half)

New file: `supabase/api_keys.sql`.

**First, the decision the plan left implicit: which Supabase key does the Vercel
function hold?**

`service_role`. And that does not contradict plan §1. §1's objection is to
*re-implementing scoping in TypeScript* — the thing that would make the API a
third copy of the predicates. Under this design the function's entire SQL surface
is `rpc("api_session_summaries", { p_key_hash })`; it never sees a `program_id`
and has nothing to scope. `service_role` is transport, not authority. Two rules
make that stick:

- **The function never calls `.from(...)`.** Only `.rpc(...)`, only `api_*`
  functions. Add it to `scripts/audit.mjs` as a trigger on `api/**` so the
  reviewer catches a stray table read.
- **`revoke execute on function public.api_* from anon, authenticated;`** The
  publishable key ships in the browser bundle. Without this revoke, anyone
  holding a leaked `key_hash` — which is a *hash*, so it might reasonably be
  logged or pasted — could call the RPC directly from a browser console. Hash
  possession must not be sufficient; only service_role + hash.

Then the table, per plan §3:

```sql
create table if not exists public.api_keys (
  id             uuid        not null default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  program_id     uuid        not null references public.programs(id) on delete cascade,
  created_by     uuid        references public.profiles(user_id) on delete set null,
  key_hash       text        not null unique,      -- SHA-256 hex. Plaintext NEVER stored.
  key_prefix     text        not null,             -- 'ts_sk_live_a4f' — display only
  label          text,
  environment    text        not null default 'live' check (environment in ('live','test')),
  scopes         text[]      not null default array['sessions:read','athletes:read','teams:read'],
  expires_at     timestamptz,                      -- NULL = no expiry (see Decisions)
  revoked_at     timestamptz,
  last_used_at   timestamptz,
  request_count  bigint      not null default 0,
  rate_limit_rpm integer,                          -- NULL falls back to tier default
  constraint api_keys_pkey primary key (id)
);
create index if not exists api_keys_program_idx on public.api_keys (program_id, created_at desc);

alter table public.api_keys enable row level security;
-- No write policies at all. Every mutation goes through the definer RPCs below,
-- exactly as with coach_invites — so nothing can forge a key, widen its scope,
-- or un-revoke it.
```

**Three RPCs**, modelled directly on `create_coach_invite`
(`coach_invite_links.sql:140-205`) — copy its guard ladder verbatim: authenticated
→ has a program → role is `admin` → program not `suspended`. Add one more rung
the invite flow doesn't need:

```sql
if not coalesce((public.my_entitlements()->'features'->>'apiAccess')::boolean, false) then
  raise exception 'API access requires Tier III' using errcode = '42501';
end if;
```

```sql
create_api_key(p_label text, p_scopes text[], p_environment text)
  returns (key_id uuid, key text, key_prefix text)   -- plaintext returned ONCE
list_api_keys()  returns (id, key_prefix, label, scopes, created_at, last_used_at, request_count, revoked_at)
revoke_api_key(p_key_id uuid) returns boolean
```

Generation, mirroring `coach_invite_links.sql:184-194` but base64url not hex:

```sql
v_secret := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
v_token  := 'ts_sk_' || p_environment || '_' || v_secret;
-- store: encode(extensions.digest(v_token, 'sha256'), 'hex') and left(v_token, 14)
```

`list_api_keys` must **not** return `key_hash`. It is only a hash, but there is
no reason to hand it out, and rule two above makes hash possession worth
something.

Note the departure from `coach_invites` and hold the line on it: `schema.sql:103-106`
records that a plaintext `token` column was added back to `coach_invites` so
admins could re-copy a live link. Defensible for a 72-hour onboarding link.
**Not defensible for a long-lived read credential on a program's entire athlete
roster.** `key_prefix` solves the "which key is this" problem that motivated it.
If a key is lost, roll it.

**Then the API-side caller**, in the same file:

```sql
create or replace function public.api_resolve_key(p_key_hash text)
returns table (key_id uuid, program_id uuid, tier text, scopes text[], rate_limit_rpm integer)
language plpgsql stable security definer set search_path = public as $$
  -- one lookup: joins api_keys → programs → program_tier(); returns zero rows for
  -- revoked, expired, suspended-program or non-Tier-III keys. Zero rows = 401/402
  -- decided in Node from which check failed, so return a reason column too.
$$;

create or replace function public.api_session_summaries(p_key_hash text, /* filters */)
-- resolves identity via api_resolve_key, then delegates to
-- scoped_session_summaries(p_program_id, 'admin', null, v_tier, …)
```

Note `p_role => 'admin'`: a program-level key is admin-equivalent, so it spans
every core team. That is **plan decision 5 / runbook open decision 6, and it is
still open** — see Decisions below. Whatever you choose, it is one argument in one call site here,
which is the point of the refactor.

**Verify (plan §11, phase 2):**

- Key from program A → **404**, never 403, for program B's session id
- Revoked key → 401 immediately, no cache TTL
- Key on a `status='suspended'` program → 402
- Key on a Tier II program → 402 on every endpoint
- Plaintext appears in exactly one place ever: the create response body.
  `grep` the Vercel logs, `select * from api_keys`, and `pg_stat_statements`.
- `set role authenticated; select public.api_session_summaries('…');` →
  permission denied

---

## Step 4 — The HTTP surface (plan phase 2, Node half)

**4a. Directory and toolchain.** There is no `api/` directory today. Create
`api/v1/whoami.ts`. Vercel auto-detects `api/**` in a Vite project with no config
change — but three things in this repo need adjusting:

```jsonc
// tsconfig.json — include is ["src"] today (tsconfig.json:18), so nothing under
// api/ is typechecked, and `types` (line 16) has no node types. Do NOT widen
// this file; the DOM lib and vite/client types don't belong in a serverless
// function. Add api/tsconfig.json instead:
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["."]
}
```

```jsonc
// package.json — typecheck currently misses api/ entirely.
"typecheck": "tsc --noEmit && tsc --noEmit -p api"
```

```jsonc
// vercel.json — narrow the rewrite. Vercel evaluates the filesystem before
// rewrites so /api/* *should* win, but relying on that ordering for the
// security-relevant surface is careless. Be explicit.
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

`npm install @vercel/node` (dev dep). Node is pinned to `24.x`
(`package.json:7`), which is a supported Vercel runtime — no `runtime` field
needed.

**Local dev gotcha:** `server.js:45` is `app.get("*", …)` serving `index.html`,
so `npm start` will swallow `/api/*`. Use `vercel dev` for API work, or add an
`/api` guard to `server.js`. Don't debug a 200-with-HTML for an hour.

**4b. One middleware, every route through it.** `api/_lib/withKey.ts`:

```
1. Read Authorization: Bearer. Missing/malformed → 401.
2. sha256 hex the whole token (including the ts_sk_live_ prefix — hash what you
   compare, not a substring).
3. rpc('api_resolve_key', { p_key_hash }). Zero rows → 401. Reason column
   decides 401 vs 402.
4. Scope check IN NODE — scope is a property of the credential, not the data.
   Missing scope → 403. Tier check stays in SQL where my_tier() lives.
5. Rate limit (4c). Over → 429 + Retry-After.
6. Run the handler.
7. finally: insert one api_requests row. ALWAYS, including on throw.
```

Never pass a `program_id` from Node into any RPC. If a parameter named
`program_id` appears anywhere under `api/`, the refactor has been defeated.

**4c. Rate limit: Postgres token bucket, not Redis.** One
`update … returning` per request, on the connection the request already needs.
Adds a round trip; avoids adding Upstash for a surface doing thousands of
requests a *day*. Defaults per key: 60 rpm, 10 000/day, 200 rows/page,
overridable via `api_keys.rate_limit_rpm`. Put a Vercel Firewall rule
(per-IP, per-path) in front as the crude backstop so a leaked key being hammered
never bills a function invocation.

**4d. `api_requests`** — mirror the `app_events` design in
`supabase/telemetry_events.sql:17-33`, which already got this right:
insert-only for the API role, **no select/update/delete**, reads exclusively
through `is_internal_admin()` definer RPCs.

```sql
create table public.api_requests (
  id bigserial primary key,
  ts timestamptz not null default now(),
  key_id uuid not null references public.api_keys(id) on delete cascade,
  program_id uuid not null,
  route text not null,        -- '/v1/sessions/{id}' — the NORMALISED template
  method text not null, status integer not null,
  duration_ms integer, rows_returned integer, ip inet, request_id text
);
create index api_requests_key_ts_idx     on public.api_requests (key_id, ts desc);
create index api_requests_program_ts_idx on public.api_requests (program_id, ts desc);
```

`route` **must** be the normalised template. A raw path carries `session_id`s
into a table you will later group by, and cardinality explodes. Decide retention
now, not at 400M rows: 90 days of rows, then a daily rollup.

**4e. Ship `/v1/whoami` and nothing else.** It proves auth + metering +
rate limiting end to end with zero data endpoints built, and it is where every
partner's first debugging session starts.

```json
{ "program": {"id":"…","name":"…"}, "tier": "III",
  "scopes": ["sessions:read","…"], "modes": ["power","…"], "history_days": null,
  "rate_limit": {"limit":60,"remaining":59,"reset_at":"2026-08-21T14:31:00Z"} }
```

**Error envelope, fixed now and never changed:**

```json
{ "error": { "type": "tier_required", "message": "raw:read requires Tier III",
             "request_id": "req_a4f…" } }
```

`401` bad/revoked · `403` scope not on key · `402` tier lacks it · `404` not
found *or not yours*, **never distinguished** (distinguishing is an enumeration
oracle) · `422` bad params · `429` + `Retry-After` · `500` with a `request_id`
that appears in the logs.

---

## Step 5 — The internal access dashboard ("who has access to what")

This is the surface you called out, and it should exist the day the first key
does. `src/pages/admin.tsx` already has the pattern: gate on
`is_internal_admin()` (`admin.tsx:306`), then `Promise.all` a set of
pre-aggregated RPCs (`admin.tsx:275-278`). Add two more.

**5a. `admin_access_matrix()`** — one row per program, the answer to "who has
access to what". New file `supabase/api_admin.sql`, guard ladder copied from
`admin_platform_pulse` (`telemetry_admin.sql:57-105`):

```sql
create or replace function public.admin_access_matrix()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_internal_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_agg(jsonb_build_object(
    'program_id',   p.id,
    'program_name', p.name,
    'plan',         p.plan,
    'status',       p.status,
    'tier',         public.program_tier(p.id),
    'api_access',   (public.tier_features(public.program_tier(p.id))->>'apiAccess')::boolean,
    'keys_active',  (select count(*) from public.api_keys k
                      where k.program_id = p.id and k.revoked_at is null
                        and (k.expires_at is null or k.expires_at > now())),
    'keys_revoked', (select count(*) from public.api_keys k
                      where k.program_id = p.id and k.revoked_at is not null),
    'scopes_union', (select coalesce(array_agg(distinct s), '{}') from public.api_keys k,
                      lateral unnest(k.scopes) s
                      where k.program_id = p.id and k.revoked_at is null),
    'last_api_call',(select max(ts) from public.api_requests r where r.program_id = p.id),
    'calls_7d',     (select count(*) from public.api_requests r
                      where r.program_id = p.id and r.ts >= now() - interval '7 days'),
    'errors_7d',    (select count(*) from public.api_requests r
                      where r.program_id = p.id and r.ts >= now() - interval '7 days'
                        and r.status >= 400),
    'ams_status',   (select c.status from public.ams_connections c where c.program_id = p.id),
    'ams_mapped',   (select count(*) from public.athletes a
                      where a.program_id = p.id and a.ams_user_id is not null),
    'ams_unmapped', (select count(*) from public.athletes a
                      where a.program_id = p.id and a.ams_user_id is null),
    'ams_failed',   (select count(*) from public.ams_push_log l
                      where l.program_id = p.id and l.status = 'failed')
  ) order by p.name)
  into result from public.programs p;

  return coalesce(result, '[]'::jsonb);
end;
$$;
grant execute on function public.admin_access_matrix() to authenticated;
```

**The two columns that earn the panel:** `api_access` vs `keys_active`. A program
with `api_access = false` **and** `keys_active > 0` is a program whose integration
is 402-ing on every call right now — a churn event you would otherwise learn
about from a support ticket. Render that combination red and sort it to the top.
Same for `ams_status = 'disabled'` with `ams_failed > 0`.

**5b. `admin_api_pulse()`** — the platform-wide strip, alongside
`admin_platform_pulse`: calls 24h / 7d, p50 and p95 `duration_ms`, top routes by
volume, 4xx and 5xx counts, top keys by volume, and the 429 count. Usage data is
also how you find out which endpoints to deprecate, so build it before you have
endpoints to regret.

**5c. The panel.** Follow the existing shape — `PanelTitle`
(`admin.tsx:223`), a `useState` per RPC (`admin.tsx:238-241`), the sortable table
already built for `ProgramRow` (`admin.tsx:326`). Add both RPCs to the
`Promise.all` at 275-278. Columns: program · tier · API on/off · active keys ·
scopes · last call · 7d calls · 7d errors · AMS status · mapped/unmapped · failed
pushes. Row expands to per-key detail: `key_prefix`, label, scopes,
`last_used_at`, `request_count`.

**Never render `key_hash` or a plaintext key on this page.** Internal admin is
still a browser.

---

## Step 6 — The rest of the pull API (plan phases 3–4)

Mechanical once steps 2–4 land. `/v1/teams`, `/v1/athletes`, `/v1/sessions`,
`/v1/sessions/{id}`, then `/v1/sessions/{id}/events` and the CSV + NDJSON
exports.

Four things to hold to:

- **Cursor pagination only.** Opaque base64 of `(ingested_at, session_id)`. No
  offset — the outbox inserts rows out of order and offsets skip records.
- **Pass masked jsonb through unchanged.** Whatever `mask_quality` /
  `mask_stats` return for the tier is the response. Document `quality` and
  `*_stats` as "tier-dependent, additive" so adding a pipeline metric is not a
  breaking change.
- **`peak_force_stats.note` stays.** "N conversion requires sensor calibration"
  is a scalar, so it survives `mask_stats` at every tier. Partners seeing the
  calibration caveat in the payload is the correct outcome. Do not strip it.
- **Three things no endpoint may ever return:** `programs.onboarding_code`
  (already over-exposed by `rls_policies.sql:88` — do not compound it),
  `program_id IS NULL` rows, and `sessions.raw` / `events.raw` outside the
  explicit NDJSON export.

And the per-event accessor trap, verified against the write path: the summary's
`quality.strength_index` is `{mean,min,max,std}` (`session.tsx:905-911,1496`) but
the per-event `events.strength_index` is `{value}` (`session.tsx:1169`).
`/v1/sessions/{id}/events` cannot reuse the summary accessor.

**Write this test first**, before any endpoint: *a session backdated via
`date_of_record` but inserted now is returned by `?since=`.* That is the §6.1
regression, and it is the failure that would cost a customer a season of data.

Do not launch phase 3 publicly without step 6's docs, an OpenAPI spec, and a
sandbox `ts_sk_test_` key.

---

## Step 7 — AMS connection setup (plan phase 5)

Ship the setup flow before the push. It can start the day step 1 lands — it does
not depend on steps 2–6.

**7a. Understand what AMS is, because it shapes everything.** AMS (formerly
Smartabase) is a **no-code platform**. There is no canonical "training session"
object; every organisation's admins built their own forms with their own names,
and the API addresses forms and fields **by those exact case-sensitive names**.
So: schema discovery is a *runtime* step, not a build-time constant; and all data
hangs off an integer `userId`, so nothing can be pushed until every athlete is
mapped.

**7b. Auth is the hard part and it needs your sign-off, not an implementation
decision.** AMS has **no OAuth and no API keys.** v1 is HTTP Basic with an AMS
*username and password*. To push into a program's AMS you must hold that
program's AMS credentials. There is no delegated-access path.

```sql
create table public.ams_connections (
  program_id uuid primary key references public.programs(id) on delete cascade,
  created_at timestamptz not null default now(),
  ams_server text not null, ams_app_name text not null, ams_username text not null,
  ams_password_ref text not null,          -- Vault secret id (see Decisions)
  event_form_id integer, event_form_name text,
  field_map jsonb not null default '{}'::jsonb,
  date_format text not null default 'DD/MM/YYYY',
  status text not null default 'pending'
    check (status in ('pending','active','error','disabled')),
  last_error text, last_user_sync_at timestamptz,
  last_user_sync_token bigint, last_push_at timestamptz
);
alter table public.ams_connections enable row level security;
-- NO policies. Not one. Same technique as internal_admins
-- (telemetry_admin.sql:25-34): invisible to the browser entirely.
```

Non-negotiables: credentials collected **per program**, entered by that program's
own AMS admin — Trench never uses one shared AMS account across customers.
Write-only from the UI, never logged, never returned by any endpoint, never
echoed back into a form field.

**7c. Put the onboarding blocker on the setup screen, in copy-pasteable form.**
If a site enforces MFA, SSO, or Terms Documents, the API account **must be
exempted by an AMS administrator first**, and needs Coach access to every athlete
plus Read+Write on the target form. That is a task for the program's IT, it takes
days, and it will be the number-one reason a connector sits in `pending`. A setup
screen that doesn't say so generates a support ticket per customer.

Also send `X-APP-ID: trenchsports.ams.integration` on every request. Optional per
the docs, but it is how Teamworks support identifies your traffic when something
breaks.

**7d. Form discovery.** `GET /api/v3/forms/summaries`, then
`GET /api/v3/forms/event/{form_id}` for exact field names and types. Persist to
`field_map`. **Re-run on a schedule and on every push failure** — a builder
renaming one field breaks the integration silently, because `eventimport` will
accept the payload and drop the unrecognised keys.

**7e. Roster mapping.** `POST /api/v1/usersynchronise` with
`lastSynchronisationTimeOnServer: 0` and empty `userIds` on the first run, the
stored token after. Cache the users — the docs are explicit about never fetching
the full list per call. Match on: email exact/case-insensitive (the only
trustworthy key — check its coverage in 0.4 first), then name + DOB, then name
alone → **propose in the UI, never auto-commit.** Silently mapping two athletes
named J. Williams is a data-integrity incident discovered months later.

Handle all three response branches or the cache rots: `users[]` upsert,
`mergedUsers[]` repoint `oldId → newId`, `idsOfDeletedUsers[]` null out
`ams_user_id` and mark the athlete unmapped.

**7f. Publish the reference form** (plan §7.5) rather than mapping each customer
bespoke, so `field_map` is a default and not a project. `Trench Sports Session`,
one record per session. **Strength Index is the exported intensity metric; no
force or pressure fields — settled, not deferred.** The `(0-1000)` in each field
name is load-bearing: a coach reading `Strength Index Avg: 612` next to a GPS
field in m/s² needs the range inline, and it pre-empts the "is this newtons?"
support ticket.

Tell AMS builders in the spec that **four of the fields are mode-conditional** —
`accuracy_pct` (accuracy only), `avg_reaction_ms` (reaction only), `si_trend` and
`si_fatigue_slope` (volume only). A power session pushes a record with four empty
fields, and coaches read mostly-blank records as a broken integration.

---

## Step 8 — The push (plan phase 6)

```sql
create table public.ams_push_log (
  session_id text primary key references public.sessions(id) on delete cascade,
  program_id uuid not null,
  ams_event_id integer,                 -- from ids[0]; presence = pushed
  attempts integer not null default 0,
  last_attempt_at timestamptz, next_attempt_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','pushed','failed','skipped')),
  last_error text
);
```

**Vercel Cron every 15 minutes polling this outbox** — not a `pg_net` trigger on
insert. Retries, backoff and dead-lettering are trivial in a cron loop and
awkward in a trigger; it survives AMS being down for an afternoon;
`select * from ams_push_log where status='failed'` is the entire debugging story;
and it matches the outbox pattern already used client-side in
`src/storage/sessionOutbox.ts`, including its "parked" concept. Backoff 1m, 5m,
30m, 2h, 12h, then park as `failed` and alert internally. `skipped` for athletes
with no `ams_user_id` — a mapping problem to surface in the UI, not a failure to
retry forever.

**Store `ams_event_id`.** Without it every retry creates a duplicate record in
the customer's AMS, and you will not be the one cleaning that up.

Use **v1 `POST /api/v1/eventimport?informat=json&format=json`** with Basic Auth.
v3 is cleaner but needs a session maintained across a two-step login — stateless
auth matters for a function that may cold-start per invocation.

**Four traps in the payload, all from the docs:**

1. **Every `value` must be a string**, including numeric fields. Coerce
   explicitly; don't trust it to happen.
2. **Field names are case-sensitive and exact.** Drive them from `field_map`,
   never a hard-coded literal.
3. **Date format.** The docs' example is `08/05/2026` for 8 May — DD/MM/YYYY,
   consistent with AMS's Australian origin. This is almost certainly
   instance-configurable and a US college site may well be MM/DD/YYYY. Hence
   `ams_connections.date_format`, and hence: **push one test record during setup
   and read it back.** Silently swapping day and month for eleven months of the
   year is the kind of bug nobody notices until the season is over.
4. **Update replaces, it does not patch.** `existingEventId` replaces the whole
   event — any omitted field is *cleared*. Always send the complete payload.

Success is `{"state":"SUCCESSFULLY_IMPORTED","ids":[137342]}`. **Check `state`,
not `resp.ok`** — anything else is a failure regardless of HTTP status.

**And the accessor trap that will bite here specifically:**
`quality.strength_index` is `{mean,min,max,std}`. There is **no `.avg` and no
`.peak`.** Reading those returns `undefined`, coerces to empty string, and pushes
blank Strength Index fields into a customer's AMS — with a
`SUCCESSFULLY_IMPORTED` response. Assert non-empty on the outbound payload before
you send it, not on the form spec.

**The tier-downgrade path is a build item, not an edge case.** A program dropping
Tier III → II must stop pushing: `ams_connections.status` → `disabled`, outbox
**parks** rather than fails, and reinstating the tier resumes the connector with
no manual re-setup and no duplicates. A silently dead connector a coach discovers
three weeks later is a churn event.

---

## Step 9 — Webhooks (plan phase 7)

`session.completed`, `session.summary.updated`, `ams.push.failed`. Signed
`X-Trench-Signature: t=<unix>,v1=<hmac_sha256(t + "." + body, secret)>`,
per-endpoint secret shown once, receivers told to reject timestamps older than 5
minutes. Reuses the step-8 outbox and backoff machinery wholesale — which is the
reason to build that machinery generically in step 8.

---

## Decisions

### Settled

1. **AMS push sits at Tier III under the existing `apiAccess` flag.** No separate
   SKU, no `amsIntegration` flag. `tier_features` (`entitlements.sql:256`) needs
   no change. Consequence to build: the downgrade parking behaviour in step 8.
2. **Strength Index is the exported intensity metric.** No force or pressure
   fields reach AMS. Calibration is no longer a dependency for any step. Newtons
   and kPa arrive later as *additive* v2 form fields, never as a redefinition of
   the SI fields; SI stays permanently as the cross-program comparable.
3. **AMS credential storage → Supabase Vault, with a one-day spike first.**
   Recommended over app-level AES-GCM. Vault keeps the key material out of the
   application repo entirely, so a leaked Vercel env var is not a leaked
   credential set, and it gives you rotation without a re-encrypt migration.
   `ams_connections.ams_password_ref` stores the secret id, and only the
   definer push function reads it. The spike must answer two things before you
   commit: whether the Vault secret is readable from a `SECURITY DEFINER`
   function called via `service_role`, and how you rotate one secret without
   touching the row. If either answer is ugly, fall back to app-level AES-256-GCM
   with the key in a Vercel env var — the table shape barely changes
   (`ams_password_enc bytea` + `ams_password_nonce bytea`).
4. **Athlete email is required for Tier III programs.** Scoped to
   `plan = 'III'`, not `program_tier()`, so active trials are warned rather than
   blocked mid-onboarding. Enforced by an insert trigger in step 1b because the
   browser writes `athletes` directly and React validation is advisory. Paired
   with an optional `AMS User ID` column in `importRoster` as the deterministic
   mapping path. Live coverage at decision time: 7/40 athletes (17.5%).

5. **API key expiry defaults to NULL — no forced rotation.** API keys are
   integration infrastructure; a surprise expiry breaks a partner's pipeline at
   3am, and the failure lands on their on-call, not ours. `expires_at` stays
   available for programs with a rotation policy, and a reminder email fires at
   12 months. If a security review pushes back, the compromise is a *warning* on
   the dashboard at 12 months, not an automatic revoke.

### Still open — both need you, neither blocks step 1

6. **Does a program-level key span every core team?** Step 3 passes
   `p_role => 'admin'`, which means yes. For a program running several sports on
   one Trench account, that hands the whole roster to one integration. If that's
   wrong, the fix is a nullable `api_keys.core_team_id` and passing
   `'coach' + core_team_id` instead — one argument at one call site, which is
   what the step-2 refactor buys you. **Decide before step 6 ships publicly**,
   because narrowing it afterwards is a breaking change for any partner already
   pulling.
7. **`programs_select_public`** (`rls_policies.sql:88`) makes program names,
   locations, plans and `onboarding_code` readable by `anon`. Unrelated to this
   work, but publishing API docs draws attention to the schema. Tighten it before
   step 6's public launch.

---

## Order of work, condensed

```
Step 0  preflight queries                     ½ day   — do this first, it changes things
Step 1  supabase/api_prereqs.sql              1 day   — ships alone, low risk
Step 1b athlete email trigger + importRoster  ½ day   — unblocks step 7's mapping
Step 2  scoping core refactor + iei_ms fix    1–2 day — two commits, byte-identical proof
Step 3  api_keys + RPCs + api_resolve_key     1 day
Step 4  api/ + withKey + /v1/whoami + limits  2 day   — proves the whole auth path
Step 5  admin_access_matrix + admin panel     1 day   ← the dashboard you asked for
Step 6  the data endpoints + exports          3–5 day
──────── steps 7–8 can run in parallel from step 1 onward ────────
Step 7  ams_connections + discovery + mapping 3–4 day
Step 8  ams_push_log + cron + idempotency     2–3 day ← the enterprise close
Step 9  webhooks                              1–2 day
```

The single most valuable thing to build first is **step 4's `/v1/whoami`**. It has
no data in it, and it validates authentication, tier gating, scope checking, rate
limiting and usage metering in one 40-line function. Everything after it is
plumbing against a path you've already proven.
