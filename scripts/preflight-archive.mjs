// scripts/preflight-archive.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Proves the repo is ready to archive for the App Store. Run it AFTER
// `npm run cap:prod` and BEFORE opening Xcode:
//
//   npm run cap:prod && npm run preflight
//
// Exit 0 = archive. Non-zero = do not.
//
// WHY A SCRIPT AND NOT A CHECKLIST
// Every check below exists because it is invisible at the moment it goes wrong.
// A build pointed at localhost launches fine on the machine that built it. A
// missing privacy manifest looks like nothing at all until the upload bounces.
// Stale web assets in the native project produce an app that works and is three
// weeks old. None of these announce themselves, which is exactly why a human
// reading a checklist ticks them off without really looking.
//
// Checks are ERROR (blocks the archive) or WARN (look at it, then decide).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => join(ROOT, ...p);

const errors = [];
const warns = [];
const passes = [];

const ok = (m) => passes.push(m);
const err = (m, fix) => errors.push({ m, fix });
const warn = (m, fix) => warns.push({ m, fix });

const read = (p) => readFileSync(p, "utf8");
const exists = (p) => existsSync(p);

// Read once, guarded. Two separate checks below need the pbxproj, and an
// unguarded readFileSync there would kill the run with a bare ENOENT stack —
// printing no report at all, so the operator sees a crash instead of being
// told which file to restore.
const PBXPROJ = (() => {
  const p = P("ios/App/App.xcodeproj/project.pbxproj");
  try { return exists(p) ? read(p) : null; } catch { return null; }
})();

// ── 1. Synced Capacitor config ───────────────────────────────────────────────
// The single most dangerous failure mode. `cap:dev` bakes localhost:5173 into
// the native project; archive on top of that and you ship an app that shows a
// white screen on every device except the one running your dev server.
{
  const p = P("ios/App/App/capacitor.config.json");
  if (!exists(p)) {
    err("ios/App/App/capacitor.config.json is missing — the native project has never been synced.",
        "npm run cap:prod");
  } else {
    let cfg;
    try {
      cfg = JSON.parse(read(p));
    } catch {
      err("ios/App/App/capacitor.config.json is not valid JSON.", "npm run cap:prod");
      cfg = null;
    }
    if (cfg) {
      const url = cfg.server?.url;
      if (url) {
        err(`Synced config still has server.url = ${url}. A production archive must bundle dist/, not load a remote origin.`,
            "npm run cap:prod   (NOT cap:dev / cap:preview)");
      } else {
        ok("Synced config has no server.url — the build will bundle dist/.");
      }
      if (cfg.server?.allowNavigation?.length) {
        err("Synced config still has server.allowNavigation. In a bundled build that lets in-app links navigate the webview off the bundle and onto the live site, losing the native BLE bridge.",
            "npm run cap:prod");
      }
      if (cfg.appId !== "com.trenchsports.demo") {
        err(`Synced appId is "${cfg.appId}" — expected com.trenchsports.demo, which is what the App Store Connect record is bound to.`,
            "check capacitor.config.ts");
      }
    }
  }
}

// ── 2. Bundled web assets are present and fresh ──────────────────────────────
// `cap sync` copies dist/ here. If dist/ is older than the newest source file,
// someone edited code and archived without rebuilding.
{
  const pub = P("ios/App/App/public");
  if (!exists(join(pub, "index.html"))) {
    err("ios/App/App/public/index.html is missing — no web assets are bundled.", "npm run cap:prod");
  } else {
    ok("Web assets are present in the native project.");

    // ANCHORED, not a substring match. Unanchored, any file whose name merely
    // contained "dist" or "ios" — studios.ts, distance.ts, scenarios/ — would
    // be skipped from the staleness scan and could hide a stale build.
    const SKIP = /^(node_modules|\.git|dist|ios|android)$/;

    // Returns [newestMtime, aborted]. The `aborted` flag matters more than the
    // timestamp: a walk that dies half way through returns a too-small maximum,
    // which would report a STALE bundle as current. A gate that fails open is
    // worse than no gate, so a partial walk is reported as a failed check
    // rather than quietly folded into the answer.
    const newest = (paths) => {
      let t = 0;
      let aborted = false;
      const visit = (f) => {
        let s;
        try {
          // lstatSync, not statSync: statSync follows symlinks, and a directory
          // symlink pointing at an ancestor would recurse until the call stack
          // blew — a RangeError thrown outside every try/catch here, killing
          // the process before the report is printed. A gate that dies without
          // saying why is worse than one that fails.
          s = lstatSync(f);
        } catch {
          aborted = true;   // permissions, race
          return;
        }
        if (s.isSymbolicLink()) return;   // never follow, never loop
        // Directory mtimes count too. A DELETED or renamed file bumps only its
        // parent directory — no surviving file's mtime moves — so ignoring
        // directories would report a bundle as current after someone removed
        // an asset that is still sitting in it.
        t = Math.max(t, s.mtimeMs);
        if (!s.isDirectory()) return;
        let entries;
        try {
          entries = readdirSync(f);
        } catch {
          aborted = true;
          return;
        }
        for (const e of entries) {
          if (SKIP.test(e)) continue;
          visit(join(f, e));
        }
      };
      for (const p of paths) {
        if (!exists(p)) { aborted = true; continue; }
        visit(p);
      }
      return [t, aborted];
    };

    let bundleTime = null;
    try { bundleTime = statSync(join(pub, "index.html")).mtimeMs; } catch { /* handled below */ }

    // Everything that ends up inside the binary, not just src/. public/ is the
    // one people forget, and it is now the important one: public/firmware/**
    // ships in the IPA, so a firmware swap with no rebuild is exactly the kind
    // of stale bundle this check exists to catch.
    //
    // .env is in here because every VITE_* value is INLINED into the bundle at
    // build time — editing it changes the shipped JavaScript just as surely as
    // editing a component does. It is listed as optional so a missing .env
    // reports once, as its own error below, rather than twice.
    const inputs = [
      P("src"), P("public"), P("index.html"),
      P("package.json"), P("vite.config.ts"), P("capacitor.config.ts"),
    ];
    if (exists(P(".env"))) inputs.push(P(".env"));
    const [inputTime, aborted] = newest(inputs);

    // Order matters: every "cannot tell" case must be handled BEFORE the
    // comparison, so an unknown age can never fall through to the ok().
    if (bundleTime === null) {
      err("Could not stat the bundled index.html, so the bundle's age is unknown and staleness cannot be checked.",
          "check permissions on ios/App/App/public, then re-run");
    } else if (aborted) {
      err("Could not read every build input, so the staleness check is unreliable. Refusing to report the bundle as current.",
          "check for broken symlinks or permissions under src/ and public/, then re-run");
    } else if (inputTime > bundleTime) {
      const mins = Math.round((inputTime - bundleTime) / 60000);
      // Directory mtimes count, so this also fires when Finder drops a
      // .DS_Store into src/ or public/ after a sync. That is a false alarm,
      // but the fix is the same cheap command either way — and erring toward
      // one extra rebuild beats erring toward shipping a stale binary.
      err(`Bundled assets are STALE — a build input changed ${mins} minute(s) after the last sync. You would archive code you have not built.`,
          "npm run cap:prod");
    } else {
      ok("Bundled assets are newer than every build input — the sync is current.");
    }

    // Junk inside the IPA. vite.config.ts strips these from dist/, so anything
    // here means the bundle predates that plugin.
    // Kept deliberately in step with stripBuildJunk() in vite.config.ts. If
    // this check flags something the plugin does not remove, the suggested fix
    // ("npm run cap:prod") cannot clear it and the warning becomes permanent
    // noise that people learn to ignore.
    const junk = [];
    let junkScanFailed = false;
    const scan = (d, rel = "") => {
      let entries;
      try { entries = readdirSync(d); } catch { junkScanFailed = true; return; }
      for (const e of entries) {
        const f = join(d, e);
        let s;
        try { s = lstatSync(f); } catch { junkScanFailed = true; continue; }
        if (s.isSymbolicLink()) continue;   // never follow, never loop
        if (s.isDirectory()) {
          if (e === "__pycache__" || e === ".git") junk.push(rel + e + "/");
          else scan(f, rel + e + "/");
        } else if (/^(\.DS_Store|Thumbs\.db|\.gitkeep)$/.test(e)) {
          junk.push(rel + e);
        }
      }
    };
    scan(pub);
    if (junk.length) {
      warn(`${junk.length} junk file(s) would ship inside the IPA: ${junk.slice(0, 5).join(", ")}${junk.length > 5 ? " …" : ""}${junkScanFailed ? " (and the scan was incomplete, so there may be more)" : ""}`,
           "npm run cap:prod   (vite.config.ts strips these on build)");
    } else if (junkScanFailed) {
      // Not "clean" — unknown. Saying "no junk" off the back of a read failure
      // is the same class of mistake as every other check here guards against.
      warn("Could not read the whole bundle, so the junk check is incomplete.",
           "check permissions under ios/App/App/public, then re-run");
    } else {
      ok("No .DS_Store / __pycache__ junk in the bundle.");
    }
  }
}

// ── 3. Info.plist ────────────────────────────────────────────────────────────
{
  const p = P("ios/App/App/Info.plist");
  let plist = null;
  if (exists(p)) { try { plist = read(p); } catch { plist = null; } }
  if (plist === null) {
    err("ios/App/App/Info.plist is missing or unreadable.", "restore it from git, or check its permissions");
  } else if (!plist.trim()) {
    // Distinct from missing: "restore it from git" is confusing advice for a
    // file that is sitting right there.
    err("ios/App/App/Info.plist is empty.", "restore its contents from git");
  } else {
    const needKey = (key, why, fix) => {
      if (plist.includes(`<key>${key}</key>`)) ok(`Info.plist has ${key}.`);
      else err(`Info.plist is missing ${key} — ${why}`, fix);
    };
    // Not cosmetic: a WKWebView geolocation call with no purpose string
    // terminates the app, and src/pages/mobile/home.tsx calls one at session
    // start.
    needKey("NSLocationWhenInUseUsageDescription",
            "the app calls navigator.geolocation at session start and will be killed by iOS without it.",
            "add the key to Info.plist");
    needKey("NSBluetoothAlwaysUsageDescription",
            "the first BLE scan will terminate the app without it.",
            "add the key to Info.plist");
    needKey("ITSAppUsesNonExemptEncryption",
            "App Store Connect will ask the export-compliance question on every upload.",
            "add <key>ITSAppUsesNonExemptEncryption</key><false/>");

    if (/CFBundleDisplayName<\/key>\s*<string>[^<]*Demo/i.test(plist)) {
      err("CFBundleDisplayName still says \"Demo\".", "edit Info.plist");
    } else {
      ok("CFBundleDisplayName is not a demo name.");
    }

    // Orientation must match what the layout actually supports. Advertising an
    // orientation the app does not handle is a 2.4.x rejection, and App Review
    // rotates the device.
    //
    // Pull each <array> by its key rather than splitting the file, so an absent
    // key reads as "cannot tell" rather than silently passing.
    // The exact closing tag is what keeps the iPhone key from also matching
    // the ~ipad one. No characters in either key are regex-special.
    const orientationArray = (key) => {
      const m = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
      return m ? m[1] : null;
    };

    for (const [key, label] of [
      ["UISupportedInterfaceOrientations", "iPhone"],
      ["UISupportedInterfaceOrientations~ipad", "iPad"],
    ]) {
      const body = orientationArray(key);
      if (body === null) {
        err(`Info.plist has no ${key} array — iOS then permits every orientation, including ones the layout does not handle.`,
            `add <key>${key}</key> with the orientations you actually support`);
      } else if (/UIInterfaceOrientationLandscape/.test(body)) {
        warn(`${label} advertises landscape. login / onboarding / dashboard have no landscape handling.`,
             "drop the Landscape strings, or verify those screens rotated on a device");
      } else {
        ok(`${label} is portrait-only, matching what the layout supports.`);
      }
    }
  }
}

// ── 4. Privacy manifest, present AND wired into the target ───────────────────
// Present-but-not-in-the-target is the trap here: the file sits in the folder,
// looks correct in every diff, and never reaches the bundle.
{
  const p = P("ios/App/App/PrivacyInfo.xcprivacy");
  if (!exists(p)) {
    err("PrivacyInfo.xcprivacy is missing — the upload will be rejected with ITMS-91053 before a human sees it.",
        "create ios/App/App/PrivacyInfo.xcprivacy");
  } else {
    const pbx = PBXPROJ ?? "";

    // Follow the UUID rather than grepping for the filename. A PBXBuildFile
    // declaration left behind after the file was dragged out of the target
    // still contains the string "PrivacyInfo.xcprivacy in Resources", so a
    // filename grep would report it wired when it is not. Membership means the
    // build-file UUID actually appears inside the PBXResourcesBuildPhase.
    const hasRef = /PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference/.test(pbx);
    const buildFileId = pbx.match(
      /([0-9A-F]{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile/
    )?.[1];
    const resourcesPhase = pbx.match(
      /isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/
    )?.[1];
    const inResources = Boolean(buildFileId && resourcesPhase?.includes(buildFileId));

    if (!PBXPROJ) {
      err("Could not read ios/App/App.xcodeproj/project.pbxproj, so it is impossible to confirm the privacy manifest is in the target.",
          "restore project.pbxproj from git");
    } else if (inResources && hasRef) {
      ok("PrivacyInfo.xcprivacy exists and is wired into the App target's Resources.");
    } else if (!hasRef) {
      err("PrivacyInfo.xcprivacy exists on disk but has no PBXFileReference in project.pbxproj — Xcode does not know the file exists, so it will not ship.",
          "drag it into the App group in Xcode with the App target ticked");
    } else {
      err("PrivacyInfo.xcprivacy exists but is NOT in the target's Resources build phase — it will not ship, and the upload will still be rejected.",
          "drag it into the App group in Xcode with the App target ticked");
    }
  }
}

// ── 5. Version and build number ──────────────────────────────────────────────
{
  const pbx = PBXPROJ;
  if (!pbx) {
    err("Could not read project.pbxproj, so the version and build number are unverified.", "restore project.pbxproj from git");
  } else {
    const mv = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
    const bv = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
    let versionConsistent = true;
    if (new Set(mv).size > 1) {
      err(`MARKETING_VERSION differs between configurations: ${[...new Set(mv)].join(" / ")}`, "make Debug and Release agree");
      versionConsistent = false;
    }
    if (new Set(bv).size > 1) {
      err(`CURRENT_PROJECT_VERSION differs between configurations: ${[...new Set(bv)].join(" / ")}`, "make Debug and Release agree");
      versionConsistent = false;
    }
    if (!mv.length || !bv.length) {
      // Absent keys are not "fine by default" — Xcode would fall back to
      // whatever is in Info.plist, which here is a $(VAR) that expands to
      // nothing, producing a build App Store Connect refuses.
      err("MARKETING_VERSION or CURRENT_PROJECT_VERSION is missing from project.pbxproj.",
          "set both in Xcode ▸ target App ▸ General");
    } else if (versionConsistent) {
      ok(`Version ${mv[0]} (build ${bv[0]}).`);
      // Not an error — it is correct for a first submission — but it is the
      // one number people forget, and the reminder costs nothing.
      const next = Number(bv[0]);
      warn(`Build number is ${bv[0]}. Every upload to App Store Connect needs a HIGHER build number than the last, including uploads you discard.`,
           Number.isFinite(next)
             ? `cd ios/App && xcrun agvtool new-version -all ${next + 1}`
             : "bump CURRENT_PROJECT_VERSION in Xcode ▸ target App ▸ General");
    }
  }
}

// ── 6. Public-origin URLs ────────────────────────────────────────────────────
// Bundled, window.location.origin is capacitor://localhost. Any URL that leaves
// the app — a shared invite, an email redirect — has to be absolute.
{
  const offenders = [];
  let scanFailed = false;

  // `.origin` specifically, and every way of reaching it — template literal,
  // string concatenation, `new URL(path, location.origin)`. Matching only the
  // `${...}` form would report clean while the bug shipped.
  //
  // Deliberately NOT `.hostname` / `.host` / `.href`: those have legitimate
  // uses here that are unaffected by the origin change — adapter_web.ts tests
  // `location.hostname === "localhost"` for the Web Bluetooth secure-context
  // rule, and editProfile.jsx assigns `location.href = "/"`, which is
  // root-relative and correct. A gate that cries wolf gets switched off.
  // Covers `location.origin`, `window.location.origin`, the optional-chained
  // `location?.origin`, and the bracket form `location["origin"]`.
  const RE = /\b(?:window\s*\??\.\s*)?location\s*\??\s*(?:\.\s*origin\b|\[\s*["']origin["']\s*\])/g;

  // Comments discuss this rule by name in several files — including the fix
  // itself — so a match inside a comment has to be ignored or the check is
  // permanently red.
  //
  // This is done per LINE, not by stripping comments from the whole file with
  // a regex. Regex comment-stripping is not safe on this codebase: several
  // files mention the route glob `/m/*` inside a `//` comment, which a naive
  // block-comment pass reads as an opening `/*` and then blanks everything up
  // to the next `*/` — in appLayout.tsx that silently deleted 31 lines of real
  // code before the scan ever saw them. A gate that can be blinded by a
  // comment is not a gate.
  //
  // Erring toward flagging is the right direction here: a false positive costs
  // someone ten seconds, a false negative ships a dead link.
  const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*|\{\s*\/\*)/.test(line);

  const scan = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { scanFailed = true; return; }
    for (const e of entries) {
      const f = join(dir, e);
      let s;
      // lstatSync + skip symlinks: a directory symlink to an ancestor would
      // otherwise recurse until the stack blew, killing the run before the
      // report prints.
      try { s = lstatSync(f); } catch { scanFailed = true; continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { scan(f); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e)) continue;
      let src;
      try { src = read(f); } catch { scanFailed = true; continue; }
      // Line numbers come from the raw source, so what the report points at is
      // what you see when you open the file.
      src.split("\n").forEach((line, i) => {
        if (isCommentLine(line)) return;
        RE.lastIndex = 0;
        if (RE.test(line)) offenders.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
      });
    }
  };
  scan(P("src"));

  if (scanFailed) {
    err("Could not read every file under src/, so the origin scan is incomplete. Refusing to report it clean.",
        "check permissions under src/, then re-run");
  }
  if (offenders.length) {
    err(`location.origin is used at: ${offenders.join(", ")}. Bundled, that evaluates to capacitor://localhost — a dead link the moment it leaves the app, with no error shown to the user.`,
        "use publicUrl() from src/lib/publicOrigin.ts");
  } else if (!scanFailed) {
    ok("No origin-derived URLs — shared and emailed links use the public origin.");
  }
}

// ── 7. Secrets that ship in the bundle ───────────────────────────────────────
// Every VITE_* var is inlined into the JavaScript at build time. "Secret" in
// the name does not make it secret; it makes it a plaintext string inside an
// IPA that anyone can unzip.
{
  const envPath = P(".env");
  if (exists(envPath)) {
    let envText = null;
    try { envText = read(envPath); } catch { /* handled below */ }
    const couldRead = envText !== null;
    if (!couldRead) {
      err(".env exists but could not be read, so the build's Supabase config is unverified.",
          "check permissions on .env, then re-run");
      envText = "";
    }
    // Parse VALUES, not just key names. `VITE_SUPABASE_URL=` with nothing after
    // the `=` is the failure this check exists to catch — the build succeeds,
    // ships, and nobody can sign in — and a name-only check calls it present.
    const env = new Map();
    for (const raw of envText.split("\n")) {
      const l = raw.trim();
      if (!l || l.startsWith("#")) continue;
      const eq = l.indexOf("=");
      if (eq < 0) continue;
      // Tolerate `export FOO=bar`. For the value: honour quotes if present,
      // otherwise strip a trailing ` # comment`. Without that last step
      // `VITE_SUPABASE_URL= # fill me in` parses as a 12-character value and
      // the check below calls it present — a false pass on exactly the thing
      // this block exists to catch.
      const k = l.slice(0, eq).trim().replace(/^export\s+/, "");
      const rawV = l.slice(eq + 1).trim();
      const quoted = rawV.match(/^(['"])([\s\S]*)\1\s*(?:#.*)?$/);
      const v = quoted ? quoted[2] : rawV.replace(/\s+#.*$/, "").trim();
      env.set(k, v);
    }
    const keys = [...env.keys()];
    const sensitive = keys.filter((k) => /SECRET|PRIVATE|SERVICE_ROLE|TOKEN|PASSWORD/i.test(k));
    const serviceRole = keys.some((k) => /SERVICE_ROLE/i.test(k));
    if (serviceRole) {
      err("A service-role key is present in .env. It bypasses every RLS policy, and if it is VITE_-prefixed it is compiled into the shipped bundle and is fully compromised.",
          "remove it; the client must only ever hold the anon key (server-side scripts read theirs from tools/.env)");
    }
    if (sensitive.length) {
      warn(`.env defines ${sensitive.join(", ")} — any VITE_-prefixed value is inlined in plaintext into the IPA and is readable by anyone who unzips it.`,
           "treat these as public, or move the capability behind an authenticated RPC");
    }
    // Only report on the Supabase keys if the file was actually read —
    // otherwise this would assert "no value for VITE_SUPABASE_URL" off the
    // back of a permissions error, which is a fact it cannot know.
    //
    // The service-role check does NOT gate this one. Two independent blockers
    // should both be reported; hiding the second behind the first means fixing
    // the first only to be stopped again by something that was already known.
    if (couldRead) {
      const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]
        .filter((k) => !(env.get(k) ?? "").length);
      if (missing.length) {
        err(`.env has no value for ${missing.join(" and ")} — the build would ship unable to sign anyone in.`,
            "set the missing value(s) before building");
      } else if (!serviceRole) {
        // A ✓ sitting next to a ✗ about the same file is how people learn to
        // skim the report, so stay quiet when the service-role error fired.
        ok(".env defines the Supabase URL and anon key.");
      }
    }
  } else {
    err(".env is missing — the build would ship with no Supabase URL or anon key and could not sign anyone in.",
        "restore .env before building");
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const line = "─".repeat(72);
console.log(`\n${line}\nArchive preflight — Trench Sports iOS\n${line}\n`);
for (const m of passes) console.log(`  ✓  ${m}`);
if (warns.length) {
  console.log("");
  for (const { m, fix } of warns) console.log(`  !  ${m}\n     → ${fix}`);
}
if (errors.length) {
  console.log("");
  for (const { m, fix } of errors) console.log(`  ✗  ${m}\n     → ${fix}`);
}
console.log(`\n${line}`);

if (errors.length) {
  console.log(`${errors.length} blocker(s), ${warns.length} warning(s). DO NOT ARCHIVE.\n`);
  // exitCode, not process.exit(). console.log to a pipe is asynchronous, and
  // `npm run preflight | less` or a CI log capture would truncate the list of
  // blockers you actually need to read. Setting the code lets the process end
  // naturally once stdout has flushed.
  process.exitCode = 1;
} else {
  console.log(`All checks passed${warns.length ? `, ${warns.length} warning(s) to read` : ""}. Ready to archive.\n`);
}
