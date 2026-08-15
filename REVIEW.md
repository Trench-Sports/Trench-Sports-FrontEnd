# Review instructions

This repo is a Vite/React + Capacitor app that talks to Supabase **directly from
the browser**. There is no API layer. Three facts drive everything below:

1. **RLS is the entire authorization model.** No server sits between the client
   and the database, so a query that isn't program-scoped is an auth hole.
2. **Session uploads are four non-transactional inserts** (`sessions` → `events`
   → `event_cells` → `session_summaries`). A failure mid-sequence leaves a
   partial session with no DB-side reconciliation. The on-device outbox
   (`src/storage/sessionOutbox.ts`) is the only durability mechanism.
3. **The session/BLE logic is triplicated** across `src/pages/session.tsx`,
   `src/pages/mobile/session.tsx`, and `src/pages/mobile/home.tsx`. A change to
   one copy that misses the other two is a recurring bug class here.

Some athletes are minors. Treat athlete data accordingly.

## What Important means here

Reserve 🔴 Important for findings in these classes. Everything else is 🟡 Nit at
most, including style, naming, refactor suggestions, and missing tests.

- **Cross-program leakage.** A new `.from(...)` select/update/delete/insert that
  is neither explicitly `.eq("program_id", ...)`-scoped nor provably covered by
  an existing program-scoped RLS policy. Also: a new table with RLS off holding
  tenant data, a policy using `using (true)` or dropping a `program_id`
  predicate, or cross-program data returned as raw rows instead of through a
  `SECURITY DEFINER` RPC that checks `internal_admins`.
- **`service_role` key anywhere under `src/`.** It bypasses RLS and must never
  ship to the browser.
- **Silent data loss on the write path.** A new multi-insert sequence with no
  partial-failure handling; a `saveSession`-style failure path that keeps the
  recording in a React ref instead of calling `sessionOutbox.enqueue(...)`; a
  chunked insert loop that only checks the last chunk's `error`.
- **Unbounded payloads.** A new jsonb/array column or field that accumulates
  without an explicit cap. `sessions.raw` is only safe because a 30–60s session
  timer bounds it at ~1500 frames — that is a fragile guarantee, don't add
  another. Bulk inserts must stay chunked at 500.
- **Unfiltered reads of `event_cells`.** It runs 10–100× the `events` row count
  and dominates table size. A query with no `program_id` / `session_id` / time
  predicate and no `.limit()` can pull the table into the browser.
- **PII or raw sensor data in telemetry.** `app_events` accepts `anon` inserts
  because `/m/home` is anonymous, so treat it as world-adjacent. No athlete or
  coach names, emails, DOB, city/state, free-form user text, or raw
  `frame`/`hits`/`raw` values in `track()` props. IDs are fine; labels and
  readings are not.
- **Unacknowledged destructive SQL.** `drop table`, `drop column`, `truncate`,
  or an unscoped `delete from` without a `-- destructive: <reason>` comment.
  `supabase/*.sql` is applied by hand in the Supabase SQL editor with no
  migration runner, so every statement must be safely re-runnable.
- **BLE disconnect that discards unsaved frames.** `onDisconnect` fires on both
  a user-initiated disconnect and an unexpected dropout, so it must be
  idempotent and must not wipe `framesRef` or slot buffers that haven't been
  enqueued. There is no auto-reconnect.

## Triplication

When a PR changes any of `uploadSession`, `connectBle`, `disconnectBle`,
`connectAdditionalBag`, `disconnectSlot`, `startSession`, `stopSession`, or
`saveSession` in one of the three files, check whether the same semantic change
landed in the other two, and name the files that were missed. Default this to
🟡 Nit; escalate to 🔴 only when the un-updated copy carries a tenancy or
data-integrity risk.

These divergences are intentional — do not flag them:

- `mobile/home.tsx` is anonymous: null `programId`/`athleteId` are allowed, and
  it adds `deviceUid` + `location` to the session insert.
- `mobile/session.tsx` supports per-bag athlete assignment
  (`slot.athlete ?? selectedAthlete`); `session.tsx` shares one athlete across
  slots.
- Cosmetic differences: indentation, native-vs-web picker, LED color on
  `mobile/home.tsx`.

## Cap the nits

Report at most five 🟡 Nits per review. If there are more, add "plus N similar
items" to the summary rather than posting them inline. After the first review on
a PR, suppress new nits entirely and post Important findings only.

## Do not report

- Anything `npm run typecheck` already catches (type errors), or anything the
  pre-push / CI `npm run audit` agents already cover in the same PR.
- `dist/`, `ios/`, `node_modules/`, `package-lock.json`, `public/` binary assets.
- `firmware-src/` unless the diff changes the BLE frame format or the Nordic
  UART protocol — in that case check it against the parser in `src/bluetooth/`.
- The pre-existing `eslint-disable react-hooks/exhaustive-deps` on the session
  effect. Do flag *new* suppressions on BLE effects.
- Missing test coverage. There is no test suite yet; saying so on every PR is noise.

## Verification bar

Behavior claims need a `file:line` citation in the source, not an inference from
a name. A false 🔴 costs a round trip and trains us to ignore you — when you
can't confirm program-scoping or outbox routing from the diff plus the files you
read, report it as 🟡 with what you'd need to confirm it.

## Summary shape

Open the review body with a one-line tally, e.g. `1 important, 3 nits`. Lead
with "No blocking issues" when nothing Important was found.
