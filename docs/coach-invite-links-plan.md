# Coach Invite Links — Implementation Plan

**Status:** built
**Date:** 2026-08-11
**SQL:** `supabase/coach_invite_links.sql` (applied), then
`supabase/coach_invite_single_active_link.sql` (see the amendment below)

> ## Amendment — 2026-08-12: one active link, permanently re-copyable
>
> Shipped in `supabase/coach_invite_single_active_link.sql`. It reverses one of
> the decisions below, so read it before trusting §1, §3, or §7.
>
> **What changed.** A program now holds **at most one live link**, and that link
> stays copyable for its whole 72h life. `create_coach_invite` refuses while a
> live link exists (checked under the same `programs` row lock the seat cap
> uses, so two admins clicking Generate can't both slip through);
> `list_coach_invites()` returns the plaintext so any admin can re-share it, not
> just whoever generated it; `revoke_coach_invite` NULLs the plaintext and frees
> the slot.
>
> **The cost, stated plainly.** §7's "stored as SHA-256 only — a database leak
> yields no usable links" **no longer holds.** Re-displaying a link requires the
> server to hold it, so `coach_invites.token` is plaintext. What still bounds
> it: one live token per program, ≤72h, NULLed on revoke, and readable only
> through the admin-and-own-program gate on `list_coach_invites()` /
> `coach_invites_select_admin`. `token_hash` is unchanged and is still the only
> way a token resolves — neither `preview` nor `redeem` reads `token` — so an
> expired row's plaintext is inert rather than exposed.
>
> **Knock-on effects.** The cap is per *program*, not per core team, so
> retargeting a different core team means revoking first. The one-time-reveal
> UI in §4.5 (the "copy it now, it won't be shown again" panel and the
> confirm-on-close guard) is gone — nothing is one-time any more. §7's
> `max_redemptions` follow-up matters *more* now, not less: a single link is the
> only link, so it's the one an admin is most likely to paste somewhere broad.

The SQL was executed against a real Postgres 15 instance during review — fixture
reproducing `programs` / `profiles` / `teams` / `team_members`, the `user_role`
and `team_type` enums, a settable `auth.uid()`, and Supabase-style default grants,
with `rls_policies.sql` and `security_h1_program_profile_scope.sql` applied first.
It applies clean and idempotent, and every guard below was confirmed to fire:
suspended-program creation, sub-team ids, admin redemption, wrong-core redemption,
expiry, idempotent re-redemption, multi-use counting, and the seat cap under two
concurrent redemptions of two different links (blocked at 2s `lock_timeout`, cap
held at 1). Three real defects were found and fixed this way — see the gotchas.

---

## 1. What we're shipping

A program admin generates a link from the Manage Program modal. Any coach who
opens it within **72 hours** signs up and lands in onboarding with their
**program and core team already resolved and locked** — no 6-digit code to type,
no core-team dropdown to get wrong.

Today the only path is: admin shares the permanent 6-digit `programs.onboarding_code`
→ coach types it → coach picks their own core from a dropdown
(`onboarding.tsx:224-274`). Two problems that fix themselves here: the code never
expires and can't be rotated, and coaches self-select their core.

### Decisions locked

| Decision | Choice |
|---|---|
| Link reuse | **Multi-use** within the 72h window — one link per program+core, drop it in the staff group chat |
| Delivery | **Copy link only** — no email provider, no new backend surface |
| Prefill | **Program + core, both locked** — coach fills only name/position/city/state/DOB |
| Entry point | `/invite/:token` → shows what they're joining → signup (or straight to onboarding if already signed in) |

### Explicitly out of scope

- Email sending (needs a Supabase Edge Function or Vercel `/api` route + Resend — the repo has neither today)
- Per-coach single-use links / email-locked invites
- Capacitor deep links (`trenchsports://invite/...`) — the iOS shell points `server.url` at the Vercel URL, so links open in Safari and work; native deep-linking is a separate task
- Rotating `programs.onboarding_code` — the 6-digit path stays as-is, as the fallback

---

## 2. Architectural constraint you must respect

**There is no server.** No `api/` directory, no `supabase/functions/`, no server
actions. `server.js` is a static Express host. Every privileged operation in this
codebase is a Postgres `SECURITY DEFINER` function called via
`supabase.rpc(...)` from the browser.

This feature follows that pattern exactly. Nothing new is introduced
infrastructurally — one SQL file, one new route, four touched files.

The redemption **must** be a definer RPC, not client-side writes, because the
invitee is not a program member yet: `get_my_program_id()` and
`get_my_core_team_id()` both return NULL for them, and
`team_members_insert_coach` requires `team_id = get_my_core_team_id()`, which is
circular during a first join. Same problem `find_program_by_code()` and
`create_program()` were built to solve
(`supabase/security_h1_program_profile_scope.sql:42-45, 64-67`).

---

## 3. Database

Full SQL is in **`supabase/coach_invite_links.sql`** — idempotent, wrapped in a
transaction, run by hand in the Supabase SQL editor per
`.claude/agents/migration-hygiene-auditor.md`. The `schema.sql` mirror is
**already committed** in the same change (both new tables inserted after
`team_members`).

### Tables

- **`coach_invites`** — `program_id`, `core_team_id`, `token_hash`,
  `expires_at`, `revoked_at`, `redemption_count`, `last_redeemed_at`, `label`,
  `created_by`
- **`coach_invite_redemptions`** — audit trail, unique on `(invite_id, user_id)`,
  so `redemption_count` counts distinct humans rather than clicks

### RLS

Both tables: RLS **on**, one admin-same-program `SELECT` policy each, and
**no insert/update/delete policy at all** — every mutation goes through a definer
RPC, so nothing can forge, extend, or un-revoke an invite.

### RPCs

| Function | Grant | Purpose |
|---|---|---|
| `create_coach_invite(p_core_team_id, p_label)` | `authenticated` | Admin-gated. Validates the core belongs to the caller's program and is `team_type='core'`. Generates a 256-bit token, stores only its SHA-256, returns the plaintext **once**. |
| `preview_coach_invite(p_token)` | `anon`, `authenticated` | Returns program name + core name + expiry, or zero rows. Anon because the invitee clicks before they have an account. |
| `redeem_coach_invite(p_token)` | `authenticated` | Locks the **program** row, then writes `profiles` (program_id + forced `role='coach'`) and, when the coach has no core yet, `team_members`. Enforces `programs.max_coaches`. Refuses admins, cross-program joins, and coaches who already hold a different core. Idempotent. |
| `list_coach_invites()` | `authenticated` | Admin's live links. Returns **no token material** — a link is unrecoverable after generation. |
| `revoke_coach_invite(p_invite_id)` | `authenticated` | Admin kill switch. |

### Four gotchas worth knowing before you run it

1. **pgcrypto lives in the `extensions` schema** on Supabase, so
   `gen_random_bytes` / `digest` are called fully qualified as
   `extensions.digest(...)` and `search_path` stays pinned to `public` like every
   other definer function in the repo. Run the preflight at the top of the SQL
   file first: `SELECT extname, extnamespace::regnamespace FROM pg_extension
   WHERE extname='pgcrypto';` — must read `pgcrypto | extensions`.
2. **`get_my_core_team_id()` does `LIMIT 1`** (`rls_policies.sql:63-74`) — the RLS
   model assumes one core team per coach. `redeem_coach_invite` handles three
   distinct cases (no core → insert; same core → no-op; **different** core →
   raise). Do not collapse them back into a single "insert if none exists": that
   silently skips the write while still returning the invite's core, so the UI
   would show one core and the dashboard would scope to another.
3. **Admins cannot redeem.** The `profiles` upsert force-sets `role='coach'`, so
   without a guard an admin clicking their own program's link demotes themselves.
   Today that's recoverable only *through* the self-asserted-role hole in §8.1 —
   meaning if you fix §8.1 without this guard, a single-admin program that clicks
   its own link is permanently locked out. The guard is in; keep it.
4. **The seat-cap lock is on `programs`, not `coach_invites`.** A program can have
   several live links (one per core team), and locking the invite row lets two
   redemptions of two *different* links commit past the cap — measured at 5
   coaches against a cap of 4 during review. `PERFORM 1 FROM programs ... FOR
   UPDATE` is what actually serializes it.

There's one more tripwire that is currently harmless but silent. In
`redeem_coach_invite` the `RETURNS TABLE` output names (`program_id`,
`core_team_id`, `program_name`, `core_team_name`) are plpgsql variables that
collide with real column names on `profiles`/`programs`/`teams`. Every column
reference in the body is alias-qualified, so there's no ambiguity today — but
drop one alias and Postgres raises `42702` **at call time, not create time**. It
will apply green in the SQL editor and fail for the first coach who clicks a
link. The rule is written into the function's header comment.

### Two hardening wins that come along for free

- **`role='coach'` is stamped server-side.** Today `profiles.role` is entirely
  self-asserted — `signup.tsx` has a `<select>` and `profiles_update_own` permits
  any role change, so anyone can make themselves `admin`. Invited coaches can no
  longer do that. (The global hole is a separate fix — worth filing.)
- **`programs.max_coaches` is enforced for the first time.** It's a column the app
  has never checked, and redemption is the natural chokepoint. Correctness here
  depends on the program-row lock described in gotcha 4.
- **Suspended programs can't mint invites.** `programs.status` has never gated
  anything in the app; `create_coach_invite` refuses when it reads `'suspended'`.

---

## 4. Frontend

### 4.1 New — `src/lib/inviteToken.ts`

Token custody helper. The token has to survive signup → (optional email
confirmation) → login → onboarding, and `supabase.auth.signUp` can return a null
user when confirmations are on (`signup.tsx:82-84`), so the URL alone isn't
enough.

```ts
const KEY = "ts_coach_invite";
type StashedInvite = {
  token: string;
  programId: string;
  programName: string;
  coreTeamId: string;
  coreTeamName: string;
  expiresAt: string;   // ISO
};

stashInvite(v: StashedInvite): void
readInvite(): StashedInvite | null   // returns null and self-clears once past expiresAt
clearInvite(): void
```

Use `localStorage` guarded in try/catch (Safari private mode throws). Cache the
preview result alongside the token so onboarding can render the locked
program/core names without a second round-trip — but **always** re-validate
server-side at redemption, never trust the cached copy.

### 4.2 New — `src/pages/invite.tsx`, route `/invite/:token`

On mount, `supabase.rpc("preview_coach_invite", { p_token: token })`. Three states:

- **Loading** — spinner
- **Invalid / expired** (zero rows) — "This invite link has expired or been
  revoked. Ask your program admin for a new one." Plus a link to `/signup` so
  they aren't dead-ended.
- **Valid** — card reading *"You've been invited to join **{program}** — **{core
  team}**"*, expiry line ("Expires Aug 14, 3:20 PM"), then `stashInvite(...)` and
  two buttons:
  - primary → `/signup?invite=1` (or `/onboarding` if a session already exists — check `supabase.auth.getUser()`)
  - secondary "I already have an account" → `/login?redirect=/onboarding` (`login.tsx:37-40` already honors `?redirect=`)

Use an explicit button rather than an auto-redirect — the coach should see what
they're joining before an account gets created.

Register in `src/router.tsx` inside the `AppLayout` children, alongside
`/signup`, **not** wrapped in `RequireOnboarding`:

```tsx
{ path: "/invite/:token", element: <Invite /> },
```

Not lazy-loaded — it's a cold-start entry point and should be instant.

### 4.3 Modify — `src/pages/signup.tsx`

- Call `readInvite()` on mount. When an invite is present:
  - hide the role `<select>` and hard-code `role = "coach"`
  - render a locked banner above the form: *"Joining {program} · {core team}"*
  - leave the existing `profiles` upsert alone (it writes name/email/role; program attachment happens at redemption)
- While you're in here: honor `?email=` in the query string. `login.tsx:88`
  already sends users to `/signup?email=...` and signup currently drops it. Read
  it with the same `new URLSearchParams(loc.search)` pattern as `login.tsx:37-40`.
- Navigation target is unchanged (`/onboarding`) — the token rides in localStorage.

### 4.4 Modify — `src/pages/onboarding.tsx`

This is the substantive change. The existing coach path is `searchProgramByCode()`
(:224) → `completeCoachOnboarding()` (:276).

**Load effect (:125-183)** — after the profile fetch, `readInvite()`. If present:
- `setRole("coach")` (overriding whatever `profile.role` says)
- set `programHit` / `coreTeamId` from the stashed preview so the existing
  `coachTrainingOk` memo (:114) is satisfied without any user input
- set a new `inviteLocked` boolean in state

**Step 1 render** — when `inviteLocked`, replace the code input + core-team
`<select>` with two read-only rows ("Program: Wildcats Football", "Core team:
Varsity") and a small note: *"Set by your program admin's invite link."* Keep an
"Enter a program code instead" escape hatch that calls `clearInvite()` and drops
back to the normal flow — cheap insurance if an admin sends the wrong link.

**`completeCoachOnboarding()`** — branch at the top:

```
if (inviteLocked) {
  // background fields (position/city/state/DOB) were already written by
  // saveBackground() at step 0, so redemption only needs the token
  const { data, error } = await supabase.rpc("redeem_coach_invite", { p_token: invite.token });
  if (error) → handle (below)
  clearInvite();
  onboardingStepCompleted("complete", "coach");
  navigate("/dashboard", { replace: true });
  return;
}
// ...existing two direct writes unchanged
```

Ordering matters twice over:

- `saveBackground()` (:185) upserts position/city/state/DOB first, then redemption
  sets only `program_id` + `role`. That's why `redeem_coach_invite` deliberately
  doesn't touch the other profile columns.
- `saveBackground()` also writes `role` straight from component state (:210), so
  `setRole("coach")` has to land in the **load effect**, before step 0 can save.
  Set it there, not in the step-1 render path, or a stale `admin` role gets
  written and only corrected a step later — and `redeem_coach_invite` will then
  reject the redemption outright with "admin accounts cannot redeem".

**Error handling** — surface the RPC's message verbatim; they're written to be
user-facing. Two need special treatment:
- *expired / revoked / invalid* → `clearInvite()`, clear `inviteLocked`, show the
  message plus the manual code entry
- *"already attached to another program"* → show the message and route to
  `/dashboard`; don't leave them stuck in onboarding

### 4.5 Modify — `src/components/program.jsx` — admin UI

Insert a new section directly below the existing "Program code" row (:466-491),
reusing `S.codeRow` / `S.copyBtn` / `S.copyBtnDone` and the `handleCopy` pattern
at :378-384. `bootstrap()` (:302) already loads the program and asserts
`role === "admin"`, so no new gate is needed.

**Invite coaches**
1. Core-team `<select>` — fetch alongside the existing bootstrap queries:
   `supabase.from("teams").select("id, name").eq("program_id", me.program_id).eq("team_type", "core").order("name")`.
   Auto-select when there's exactly one (mirrors `onboarding.tsx:268`).
2. **Generate invite link** button → `create_coach_invite({ p_core_team_id, p_label: null })`
3. On success, show `${window.location.origin}/invite/${token}` in a read-only
   input with a Copy button, and — per §7, don't soften this — *"Anyone with this
   link can join {core} as a coach and will be able to see that team's athlete
   roster. Expires in 72 hours — {formatted date}."*
4. Warn on navigating away: the token is shown once and cannot be retrieved.
5. **Active links** list from `list_coach_invites()` — core name, time remaining,
   redemption count, and a Revoke button (`revoke_coach_invite`).

Both `src/pages/dashboard.tsx` and `src/pages/mobile/dashboard.tsx` mount
`ProgramModal`, so this appears on desktop and mobile with no extra work.

### 4.6 Modify — `src/lib/telemetryEvents.ts`

Add `inviteCreated`, `inviteOpened`, `inviteRedeemed`, `inviteRejected(reason)`
following the existing `onboardingStepCompleted` / `authSignupSucceeded` shape.

> **Never put the plaintext token in a telemetry payload, a `console.log`, or an
> error string.** The link is a bearer credential and `app_events` is queried by
> internal admins. Log `invite_id` (from the create RPC) or a `token.slice(0, 8)`
> prefix if you need correlation.

---

## 5. Build order

1. Run the preflight at the top of `supabase/coach_invite_links.sql`, apply the
   file in the Supabase SQL editor, then work the VERIFY block at the bottom.
   **`schema.sql` mirror is already done** — note it records neither index and
   drops the `ON DELETE` clauses, matching house style (`schema.sql` has no
   `ON DELETE` anywhere), so don't treat the mirror as authoritative for the
   `CASCADE` / `SET NULL` behaviour the migration relies on.
2. Add `create_coach_invite` / `preview_coach_invite` / `redeem_coach_invite` /
   `list_coach_invites` / `revoke_coach_invite` to
   `supabase/live_functions_snapshot.sql`. That file is **already stale** — it's
   missing `find_program_by_code` and `create_program` from security_h1 — so this
   is real work, not a rubber stamp. Consider catching those two up while you're
   in there.
3. `src/lib/inviteToken.ts`
4. `src/lib/telemetryEvents.ts` — new events
5. `src/pages/invite.tsx` + `src/router.tsx` route — verify a valid and an
   expired token both render correctly before touching onboarding
6. `src/pages/signup.tsx` — locked banner, forced coach role, `?email=` prefill
7. `src/pages/onboarding.tsx` — locked step 1 + redemption branch
8. `src/components/program.jsx` — generate / copy / list / revoke
9. `npm run typecheck` && `node scripts/audit.mjs` (the pre-push hook runs both;
   `.claude/agents/tenancy-rls-auditor.md` auto-triggers on any diff containing
   `.rpc(` or `supabase/*.sql`, which this is)

---

## 6. Test cases

**Happy path**
- Admin generates → copies → opens in a clean profile → signup → onboarding shows
  locked program + core → complete → dashboard scoped to the right core team
- Second coach redeems the same link → also joins (multi-use works)
- Existing signed-in coach with no program opens the link → skips signup, goes
  straight to onboarding

**Expiry & revocation**
- `UPDATE coach_invites SET expires_at = now() - interval '1 min'` → `/invite/:token`
  shows the expired state; `redeem_coach_invite` raises
- Expire the link *between* signup and onboarding completion → onboarding surfaces
  the message and falls back to manual code entry, not a dead end
- Revoke while a coach sits on the signup page → redemption fails cleanly

**Authorization**
- Coach (non-admin) calls `create_coach_invite` → raises
- Admin passes a `core_team_id` from **another** program → raises
- Admin passes a `team_type='sub'` team id → raises
- Admin of a `status='suspended'` program generates → raises
- Logged-out `SELECT * FROM coach_invites` → 0 rows
- Malformed token (`'abc'`, SQL-ish input, 63 chars) → rejected. Note the regex is
  a real `IF ... RAISE` guard in `redeem` but only a `WHERE` filter in `preview`,
  where `digest()` may still run on junk input — harmless, but don't document it
  as validation in both.

**The three defects review caught — regression-test all of them**
- **Admin redeems their own program's link** → raises "admin accounts cannot
  redeem". Before the guard this silently flipped their role to `coach` and locked
  them out of `revoke_coach_invite`.
- **Coach already in core A redeems a core-B link, same program** → raises. Before
  the fix the RPC returned core B, wrote nothing, left `get_my_core_team_id()` on
  core A, and logged core B in the audit table.
- **Concurrent redemption of two different links for the same program** → exactly
  one succeeds when at the cap. Before the fix, two committed (5 coaches, cap 4).

**Idempotency & edges**
- Redeem twice as the same user → succeeds, `redemption_count` stays at 1
- Two different coaches, same link → `redemption_count` reaches 2
- Coach already in program A redeems a program-B link → raises "already attached"
- Set `max_coaches` to the current coach count → next redemption raises the cap error
- Coach whose `program_id` was nulled directly (bypassing `handleRemove`, which is
  possible under `profiles_update_admin`) but whose `team_members` row survives →
  raises on the core-team mismatch rather than producing a dead account
- Supabase env vars missing → `/invite/:token` degrades gracefully (`supabase` is nullable)

**Verify after**
- `get_my_core_team_id()` returns exactly one row for every invited coach
- `SELECT coach_user_id, count(*) FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE t.team_type='core' GROUP BY 1 HAVING count(*) > 1` → empty

---

## 7. Security notes

**A link in a URL is a credential in a URL.** It lands in browser history, gets
forwarded, and sits in group chats forever. Mitigations, in order of importance:

- 72h expiry (hard-coded in the DB, not client-controllable)
- Stored as SHA-256 only — a database leak yields no usable links
- Admin revoke, effective immediately
- `preview_coach_invite` returns display names only — no `onboarding_code`, no
  billing fields, no member list, no PII
- Never logged (see 4.6)

**Know the actual blast radius of a leaked link.** Redemption is the expensive
part, not preview. Measured against this repo's real RLS, a stranger who redeems
can immediately read:

- every `athletes` row in the invited core team (`athletes_select_coach`) — real
  columns include name, email, DOB, city, state, height, weight
- `teams` (the core plus its sub-teams) and `team_members`
- **the `programs` row, including `onboarding_code`** — via
  `programs_select_member` (`id = get_my_program_id()`). That's the permanent
  6-digit join secret that `security_h1_program_profile_scope.sql` was written
  specifically to stop leaking, plus `plan` / `status` / `max_*`.

Revoking the invite afterwards undoes none of that, and rotating
`onboarding_code` is out of scope (§1) — so one forwarded link permanently
compromises the fallback join path. Peer PII is *not* exposed; security_h1 holds
for `profiles`.

Two things follow. First, the admin-facing copy in §4.5 should say *"anyone with
this link can join as a coach and will be able to see this core team's athlete
roster"* — not just "can join". Second, **"multi-use, 72h, no email lock" deserves
a second look before launch.** A `max_redemptions` column (a seat count the admin
sets when generating) would bound this cheaply and is a small addition to the
table + the redeem guard. Recommend adding it if invites are going into group
chats.

**Enumeration** isn't a concern: 256 bits of `gen_random_bytes`. No rate limiting
needed on `preview_coach_invite` beyond Supabase's defaults.

**Also verified during review:** non-admin create raises; cross-program and
`team_type='sub'` core ids raise; coach `list_coach_invites()` returns 0 rows;
coach revoke raises; malformed tokens are rejected; grants are exactly as intended
with `preview` the only function reachable by `anon`; all five functions are
`prosecdef` with `proconfig` pinned; RLS is on with SELECT-only policies, so
`authenticated`'s default Supabase DML grants are inert.

**Known conflict to keep in mind:** `rls_coach_read_access.sql` (repo root)
defines a competing multi-core model via `get_my_coach_team_ids()` alongside the
single-core `get_my_core_team_id()`, and neither was dropped. This plan targets
the single-core model, which is what `athletes.core_team_id` and every coach-facing
read actually use. Worth resolving separately — it's a live ambiguity in the RLS
layer, not something this feature introduces.

---

## 8. Follow-ups this surfaces

1. **`profiles.role` is self-asserted.** `signup.tsx`'s role `<select>` plus
   `profiles_update_own` (no `WITH CHECK`) lets any user set `role='admin'` and
   gain admin RLS over their program. Invites close it for invited coaches only.
   Needs a real fix: drop role from client-writable columns and gate changes
   behind a definer RPC. **When you do this, keep the admin-cannot-redeem guard
   in `redeem_coach_invite`** — that hole is currently the only thing that would
   let a self-demoted admin recover.
2. **`/reset-password` is not a registered route** but `resetPasswordForEmail`
   points at it (`login.tsx:126`, `mobile/login.tsx:101`). Same class of bug as
   the dropped `?email=` param — token-bearing URLs with no landing page.
3. **Email delivery**, once there's a backend surface. Adding `email` / `sent_at`
   to `coach_invites` is a two-line non-breaking migration when that day comes.
4. **Deep links** for the Capacitor shell so invites open in-app on iOS.
5. **`max_redemptions` on `coach_invites`** — see §7. Recommended before wide
   rollout if links are going into group chats.
6. **Two competing RLS models.** `rls_coach_read_access.sql` (repo root) redefines
   `get_my_role` / `get_my_program_id` and adds a multi-core `get_my_coach_team_ids()`
   without dropping the single-core policies. Everything is `CREATE OR REPLACE`, so
   re-running it won't break this feature, but its multi-core assumption is exactly
   what makes the `LIMIT 1` invariant behind gotcha 2 brittle. Worth resolving.
