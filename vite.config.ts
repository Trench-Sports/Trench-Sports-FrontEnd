import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, rmSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Stamped into the bundle so telemetry can tell releases apart. Vercel supplies
// its own value via env; a local `npm run build` before `cap sync` does not, and
// without this every session recorded by the shipped iOS app reported
// app_version "dev" (src/lib/telemetry.ts falls back to that). Falling back to
// the package version means the number is always *something* traceable.
const APP_VERSION = process.env.VITE_APP_VERSION || pkg.version || "unknown";

/**
 * Strips build junk out of the output directory.
 *
 * `public/` is copied into `dist/` wholesale, and `public/firmware/` has
 * accumulated `.DS_Store` files and Python `__pycache__/*.pyc` from flashing
 * boards by hand. That was harmless while the iOS app loaded the website. Now
 * that production builds bundle `dist/` into the binary, every one of those
 * files is shipped to users inside the IPA and reviewed by Apple.
 *
 * Deleting them from `dist/` rather than from `public/` is deliberate: the
 * source files can stay where they are for whoever is working on firmware, and
 * no one has to remember to clean up before a release.
 */
function stripBuildJunk() {
  const JUNK = /^(\.DS_Store|Thumbs\.db|\.gitkeep)$/;
  const JUNK_DIR = /^(__pycache__|\.git)$/;

  // Each entry is guarded individually. A single broken symlink or unreadable
  // file must not abort the whole recursion — that would leave junk in every
  // directory not yet visited, and the outer catch turns the throw into a
  // warning, so the build would succeed and ship it.
  //
  // lstatSync, not statSync: statSync follows symlinks, so a symlinked
  // directory inside dist/ could recurse forever.
  function sweep(dir: string): number {
    let removed = 0;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return removed;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        if (lstatSync(full).isDirectory()) {
          if (JUNK_DIR.test(entry)) {
            rmSync(full, { recursive: true, force: true });
            removed += 1;
            continue;
          }
          removed += sweep(full);
        } else if (JUNK.test(entry)) {
          rmSync(full, { force: true });
          removed += 1;
        }
      } catch {
        /* skip this entry, keep sweeping the rest */
      }
    }
    return removed;
  }

  // Resolved from the config's own location rather than cwd. A bare relative
  // "dist" is correct under `npm run build` (npm sets cwd to the package dir)
  // but wrong for any wrapper that runs Vite from elsewhere — and the failure
  // is soft: the sweep finds nothing, the build succeeds, and the junk ships.
  //
  // fileURLToPath, not URL.pathname: pathname is percent-encoded, so a checkout
  // under a directory with a space in its name would yield ".../My%20Repo/dist"
  // and silently find nothing.
  let outDir = fileURLToPath(new URL("./dist/", import.meta.url));

  return {
    name: "strip-build-junk",
    apply: "build" as const,
    configResolved(cfg: { root: string; build: { outDir: string } }) {
      // `build.outDir` is documented as relative to `root` and is NOT
      // absolutized by Vite — it is the literal string "dist" here. Vite
      // resolves it against root everywhere it needs a real path, so we do
      // the same. Assigning it raw would re-introduce the cwd dependency the
      // fallback above exists to avoid.
      // resolve() ignores the base when outDir is already absolute, so this is
      // still correct if a future Vite starts absolutizing it.
      if (cfg.build?.outDir) outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      try {
        const removed = sweep(outDir);
        if (removed) console.log(`[strip-build-junk] removed ${removed} item(s) from ${outDir}`);
      } catch (e) {
        // Never fail a build over housekeeping — the preflight check catches it.
        console.warn(`[strip-build-junk] skipped: ${(e as Error).message}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stripBuildJunk()],
  define: {
    // Must be the full `import.meta.env.X` expression — Vite substitutes it
    // textually, and a bare `VITE_APP_VERSION` key would not match the call
    // sites in src/lib/telemetry.ts.
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    host: true
  },
  preview: {
    port: 4173,
    host: true
  },
  build: {
    outDir: "dist"
  }
});
