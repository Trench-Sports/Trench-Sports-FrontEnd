#!/usr/bin/env node
// scripts/audit.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Local audit-agent harness — Part 2 of docs/observability-and-code-audit-plan.md.
//
// Runs a set of LLM review agents over the *diff only* (never the whole repo —
// scope is cost). Each agent is a markdown prompt in .claude/agents/. This
// harness selects which agents to run based on what the diff touches, invokes
// `claude -p` per agent with a shared repo preamble + the diff, parses the
// structured JSON findings, and reports them.
//
// Design rules (from §2.2, kept deliberately safe):
//   • WARN-ONLY by default — nothing blocks a push. Set AUDIT_BLOCKING=1 to let
//     CRITICAL findings block (exit 1). Promote to blocking only once an agent
//     has proven itself.
//   • Fail OPEN — a missing `claude` CLI, a timeout, or a parse error never
//     blocks; it prints a note and moves on. A flaky network must not wedge a push.
//   • Diff-scoped against origin/main (falls back to HEAD~1).
//   • Agents run concurrently with a hard per-agent timeout.
//   • SKIP_AUDIT=1 bypasses everything (documented escape hatch — better than
//     teaching people `--no-verify`, which also skips deterministic checks).
//
// Standalone by design: a hook calls `node scripts/audit.mjs`, and moving this
// into CI later is a few lines of YAML with no rework.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = join(ROOT, ".claude", "agents");
const OUT_DIR = join(ROOT, ".audit");
const OUT_FILE = join(OUT_DIR, "findings.md");

const PER_AGENT_TIMEOUT_MS = 60_000;
const BLOCKING = process.env.AUDIT_BLOCKING === "1";

// ── Agent manifest ───────────────────────────────────────────────────────────
// Trigger logic lives here (one place) so the .md files stay pure prompts.
// `triggers(files, diff)` decides whether an agent runs for this diff.
const AGENTS = [
  {
    file: "tenancy-rls-auditor.md",
    label: "tenancy-rls",
    triggers: (_files, diff) => /\.from\(|\.rpc\(/.test(diff) || _files.some((f) => f.startsWith("supabase/") && f.endsWith(".sql")),
  },
  {
    file: "write-path-integrity-auditor.md",
    label: "write-path-integrity",
    triggers: (files, diff) =>
      /uploadSession|saveSession|\.insert\(/.test(diff) ||
      files.some((f) => /pages\/(mobile\/)?(session|home)\.tsx$/.test(f)),
  },
  {
    file: "triplication-drift-auditor.md",
    label: "triplication-drift",
    triggers: (files) =>
      files.some((f) => /src\/pages\/session\.tsx$/.test(f) || /src\/pages\/mobile\/(session|home)\.tsx$/.test(f)),
  },
  {
    file: "ble-state-machine-auditor.md",
    label: "ble-state-machine",
    triggers: (files, diff) =>
      files.some((f) => f.startsWith("src/bluetooth/")) ||
      /connectBle|disconnectBle|connectAdditionalBag|disconnectSlot|startNotifications/.test(diff),
  },
  {
    file: "payload-load-auditor.md",
    label: "payload-load",
    triggers: (files, diff) =>
      /\.insert\(|\bjsonb\b|select\(\s*['"]\*['"]|\bevent_cells\b|raw:\s/.test(diff) ||
      files.some((f) => /pages\/(mobile\/)?(session|home)\.tsx$/.test(f) || (f.startsWith("supabase/") && f.endsWith(".sql"))),
  },
  {
    file: "migration-hygiene-auditor.md",
    label: "migration-hygiene",
    triggers: (files) => files.some((f) => f.startsWith("supabase/") && f.endsWith(".sql")),
  },
  {
    file: "telemetry-pii-auditor.md",
    label: "telemetry-pii",
    triggers: (files, diff) =>
      /\btrack\(|telemetryEvents/.test(diff) ||
      files.some((f) => /src\/lib\/telemetry(Events)?\.ts$/.test(f)),
  },
];

// ── Shared preamble given to every agent (§2.3) ──────────────────────────────
const PREAMBLE = `You are a code-review agent for the Trench Sports codebase. Key facts:
- No API layer: the browser talks to Supabase directly; RLS is the ONLY authorization boundary.
- The session logic is triplicated across src/pages/session.tsx, src/pages/mobile/session.tsx, and src/pages/mobile/home.tsx.
- /m/home is anonymous (no login); app_events is a deliberately public, guarded insert endpoint.
Review ONLY the unified diff below. Follow your role instructions exactly and output ONLY the JSON array they specify.`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function resolveClaude() {
  // The hook runs in the user's shell, where `claude` is normally on PATH even
  // if a sandboxed subshell can't see it. Probe a few options; fail open.
  for (const cand of ["claude"]) {
    const v = sh(cand, ["--version"]);
    if (v) return cand;
  }
  return null;
}

function getDiffBase() {
  // Prefer the merge-base with origin/main (what a push actually adds).
  const base = sh("git", ["merge-base", "origin/main", "HEAD"]);
  if (base) return base;
  const alt = sh("git", ["rev-parse", "HEAD~1"]);
  return alt || "HEAD";
}

function stripFrontmatter(md) {
  // Remove a leading YAML frontmatter block so the agent gets a clean prompt.
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) return md.slice(md.indexOf("\n", end + 1) + 1).trim();
  }
  return md.trim();
}

function extractJsonArray(text) {
  // Models sometimes wrap the array in prose or code fences. Grab the outermost
  // [...] and parse it. Returns [] on any failure (fail-open).
  if (!text) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function runAgent(claudeBin, agent, diff) {
  const promptBody = stripFrontmatter(readFileSync(join(AGENTS_DIR, agent.file), "utf8"));
  const prompt = `${PREAMBLE}\n\n${promptBody}\n\n===== UNIFIED DIFF (origin/main...HEAD) =====\n${diff}\n===== END DIFF =====`;

  return new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (findings, note) => {
      if (done) return;
      done = true;
      resolve({ label: agent.label, findings, note });
    };

    let child;
    try {
      child = spawn(claudeBin, ["-p", "--output-format", "json"], { cwd: ROOT });
    } catch {
      return finish([], "spawn failed (fail-open)");
    }

    const killer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      finish([], `timed out after ${PER_AGENT_TIMEOUT_MS / 1000}s (fail-open)`);
    }, PER_AGENT_TIMEOUT_MS);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("error", () => { clearTimeout(killer); finish([], "invocation error (fail-open)"); });
    child.on("close", () => {
      clearTimeout(killer);
      // `--output-format json` returns an envelope { result: "<text>" }; the
      // agent's JSON array lives inside .result. Fall back to raw stdout.
      let text = stdout;
      try {
        const env = JSON.parse(stdout);
        if (env && typeof env.result === "string") text = env.result;
      } catch { /* not an envelope — use raw */ }
      finish(extractJsonArray(text));
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {
      clearTimeout(killer);
      finish([], "stdin write failed (fail-open)");
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (process.env.SKIP_AUDIT === "1") {
    console.log("[audit] SKIP_AUDIT=1 — skipping audit agents.");
    return 0;
  }

  // Mode: default reviews what a push adds (origin/main...HEAD). `--working`
  // reviews uncommitted tracked changes, for an on-demand check before committing.
  const working = process.argv.includes("--working");
  let files, diff, scopeLabel;
  if (working) {
    files = sh("git", ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
    diff = sh("git", ["diff", "HEAD"]);
    scopeLabel = "uncommitted changes (working tree)";
  } else {
    const base = getDiffBase();
    files = sh("git", ["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
    diff = sh("git", ["diff", `${base}...HEAD`]);
    scopeLabel = `origin/main...HEAD (base ${base.slice(0, 8)})`;
  }

  if (!diff || files.length === 0) {
    console.log(`[audit] No diff in ${scopeLabel} — nothing to review.`);
    return 0;
  }

  const selected = AGENTS.filter((a) => {
    try { return a.triggers(files, diff); } catch { return false; }
  });

  if (selected.length === 0) {
    console.log(`[audit] ${files.length} file(s) changed; no audit agent triggered.`);
    return 0;
  }

  const claudeBin = resolveClaude();
  if (!claudeBin) {
    console.log(
      "[audit] `claude` CLI not found on PATH — skipping agents (fail-open).\n" +
      "        Install Claude Code and ensure `claude` is on PATH to enable local review.",
    );
    return 0;
  }

  console.log(`[audit] Scope: ${scopeLabel}`);
  console.log(`[audit] Reviewing ${files.length} changed file(s) with ${selected.length} agent(s): ${selected.map((a) => a.label).join(", ")}`);

  const results = await Promise.all(selected.map((a) => runAgent(claudeBin, a, diff)));

  // ── Aggregate + report ─────────────────────────────────────────────────────
  const all = [];
  for (const r of results) {
    if (r.note) console.log(`[audit] ${r.label}: ${r.note}`);
    for (const f of r.findings) all.push({ ...f, agent: r.label });
  }

  const rank = { CRITICAL: 0, WARN: 1, INFO: 2 };
  all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, renderMarkdown(base, files, all));

  const criticals = all.filter((f) => f.severity === "CRITICAL");
  const warns = all.filter((f) => f.severity === "WARN");

  if (all.length === 0) {
    console.log("[audit] ✓ No findings.");
    return 0;
  }

  console.log(`\n[audit] ${criticals.length} CRITICAL, ${warns.length} WARN, ${all.length - criticals.length - warns.length} INFO — see .audit/findings.md\n`);
  for (const f of all.slice(0, 12)) {
    console.log(`  [${f.severity}] ${f.agent} · ${f.file}:${f.line ?? "?"} — ${f.finding}`);
  }
  if (all.length > 12) console.log(`  …and ${all.length - 12} more in .audit/findings.md`);

  if (BLOCKING && criticals.length > 0) {
    console.log(`\n[audit] BLOCKING mode: ${criticals.length} CRITICAL finding(s) — push blocked. Fix, or bypass with SKIP_AUDIT=1.`);
    return 1;
  }
  if (criticals.length > 0) {
    console.log("\n[audit] warn-only mode: CRITICAL findings shown but NOT blocking. Set AUDIT_BLOCKING=1 to enforce.");
  }
  return 0;
}

function renderMarkdown(base, files, findings) {
  const now = new Date().toISOString();
  let md = `# Audit findings\n\n_Generated ${now} · base \`${base}\` · ${files.length} file(s) changed_\n\n`;
  if (findings.length === 0) { md += "✓ No findings.\n"; return md; }
  for (const sev of ["CRITICAL", "WARN", "INFO"]) {
    const group = findings.filter((f) => f.severity === sev);
    if (!group.length) continue;
    md += `## ${sev} (${group.length})\n\n`;
    for (const f of group) {
      md += `- **${f.file}:${f.line ?? "?"}** \`${f.agent}\`\n  - ${f.finding}\n`;
      if (f.fix) md += `  - _Fix:_ ${f.fix}\n`;
    }
    md += "\n";
  }
  return md;
}

process.exit(await main());
