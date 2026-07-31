# Local audit agents

Diff-scoped LLM code-review agents that guard the properties this codebase can't
check with a linter — multi-tenant RLS isolation, non-transactional write
integrity, three-way session-logic drift, BLE lifecycle, storage load, migration
hygiene, and telemetry PII. Part 2 of `docs/observability-and-code-audit-plan.md`.

Each agent is a markdown prompt in this directory. The runner is
`scripts/audit.mjs`. Agents run **only over the diff** (scope is cost), and each
is selected only when the diff touches something it cares about.

## The agents

| Agent | Guards | Triggers on |
|---|---|---|
| `tenancy-rls-auditor` | cross-program isolation, RLS coverage (RLS *is* the auth model) | `.from(`, `.rpc(`, `supabase/*.sql` |
| `write-path-integrity-auditor` | partial-write handling, outbox durability, chunk checks, backoff | `uploadSession`/`saveSession`, `.insert(` |
| `triplication-drift-auditor` | one session-file copy changing without the other two | `session.tsx`, `mobile/session.tsx`, `mobile/home.tsx` |
| `ble-state-machine-auditor` | notification teardown, idempotent disconnects, buffered-data safety | `src/bluetooth/**`, connect/disconnect fns |
| `payload-load-auditor` | unbounded jsonb/array writes, duplicate storage, unchunked inserts, unfiltered high-volume reads | `.insert(`, `jsonb`, `event_cells`, `select('*')` |
| `migration-hygiene-auditor` | `schema.sql` drift, idempotency, unacknowledged destructive SQL | `supabase/*.sql` |
| `telemetry-pii-auditor` | no athlete PII / raw sensor data in events, taxonomy conformance, no hot-loop `track()` | `track(`, `telemetry*.ts` |

## Running them

```bash
# Review what a push would add (origin/main...HEAD) — same as the pre-push hook
npm run audit

# Review your uncommitted changes before you commit
npm run audit:working
```

The **pre-push git hook** runs `npm run audit` automatically (installed via
`simple-git-hooks`; re-install with `npx simple-git-hooks` after a fresh clone).

Findings print to the terminal and are written to `.audit/findings.md`
(gitignored), grouped by severity.

## Using them regularly (recommended cadence)

- **Before every commit on a change of any size:** `npm run audit:working`.
- **On every push:** automatic via the pre-push hook — no action needed.
- **When onboarding a new area / big refactor:** run `npm run audit` on the
  feature branch before opening a PR.
- **Promote to CI** once a second engineer touches the repo: the agents are
  standalone scripts, so a CI job is a few lines of YAML calling `npm run audit`
  against the PR diff — no rework.

## Severity & blocking

- `CRITICAL` — a real correctness/tenancy/data-loss risk.
- `WARN` — likely issue, worth a look.
- `INFO` — style / consistency.

By default the runner is **warn-only**: it prints findings but never blocks a
push (`exit 0`). Promote to enforcing once an agent has proven itself:

```bash
AUDIT_BLOCKING=1 npm run audit   # CRITICAL findings now fail (exit 1)
```

Make it permanent by setting `AUDIT_BLOCKING=1` in the hook environment.

## Escape hatches & safety

- `SKIP_AUDIT=1 git push` — skip the agents for one push (better than
  `--no-verify`, which also skips the deterministic checks).
- **Fail-open by design:** a missing `claude` CLI, a per-agent timeout (60s), or
  a parse error never blocks — it prints a note and moves on. A flaky network
  must never wedge a push.
- **Requires the `claude` CLI on `PATH`** in the shell that runs the hook. If it
  isn't found, the runner skips the agents (fail-open) and says so.

## Adding or editing an agent

1. Add a `.md` prompt here (frontmatter `name`/`description`/`tools`, then the
   role instructions + a strict JSON-array output contract).
2. Register it in the `AGENTS` array in `scripts/audit.mjs` with a `triggers`
   function that returns true only when the diff is relevant.
3. Start every new agent **warn-only**; promote to blocking after it's been
   right for a couple of weeks (an agent that false-positives on day one gets
   disabled on day two).

## The deterministic gate (wired)

The pre-push hook runs `npm run typecheck && node scripts/audit.mjs` — the fast,
deterministic typecheck **blocks** the push if it fails, then the agents review
the diff (warn-only). The former ~60-error backlog is cleared (missing
`@types/react`/`@types/web-bluetooth`, dead `src/App_old.tsx` excluded, `.d.ts`
shims for the legacy `.jsx` components — see `src/components/*.d.ts`).

`tsc` remains clean; keep it that way. If a legitimate change needs to land past
a transient failure, `SKIP_AUDIT=1` skips only the agents (typecheck still runs);
`SKIP_SIMPLE_GIT_HOOKS=1 git push` skips the whole hook.

## Recommended next foundation

ESLint (flat config, `typescript-eslint`, `react-hooks`), Prettier, and Vitest
(plan §2.1). Add ESLint/Prettier to a fast **pre-commit** via `lint-staged`, and
`vitest run` to pre-push after typecheck. The `.jsx` components still sit outside
the typecheck — migrating them to `.tsx` closes that hole (plan decision 6).
