// scripts/prerender.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Post-build prerender for the public marketing pages.
//
//   npm run build        → vite build && node scripts/prerender.mjs
//
// WHY
// Everything on the site renders client-side, and src/hooks/useSeo.ts sets
// each page's <title>/description/canonical/OG/Twitter tags at runtime. Google
// runs JS, but GPTBot, ClaudeBot, PerplexityBot and the LinkedIn/Slack/Twitter
// unfurlers do not — they saw only index.html's generic tags and an empty
// <div id="root">. This script loads each route of the built app in headless
// Chromium, waits for it to render, and writes the result back into dist/ as
// static HTML that already contains the page text and per-route tags.
//
// HOW THE SPA STILL BOOTS
// The output is the normal Vite shell (same module script, same CSS) with the
// rendered markup inside #root. main.tsx uses createRoot(), not hydrateRoot(),
// so React discards that markup on first commit and renders fresh. Nothing has
// to match, and a page that renders differently per visitor (theme, auth)
// can't produce hydration errors.
//
// THE iOS APP
// Capacitor bundles dist/ and loads dist/index.html, which is now the
// prerendered landing page. On native, "/" redirects to /m/home, so painting
// the marketing page for a frame before JS runs would be a visible flash. The
// prerendered nodes carry data-prerendered, and a tiny inline head script hides
// them when it detects the Capacitor shell (or a path the page wasn't rendered
// for) — before first paint, without waiting for the bundle. React replaces
// them on boot either way.
//
// FAILURE POLICY
//   • No browser available (e.g. a build image without Chromium's system libs)
//     → warn loudly and leave dist/ as the plain SPA shell. The site and the
//     iOS bundle still work exactly as they did before prerendering existed.
//     Set PRERENDER_STRICT=1 to make this an error instead.
//   • A route renders but the output looks wrong (missing canonical, almost no
//     text, an error boundary) → the build FAILS. Shipping a broken static page
//     to crawlers is worse than shipping none.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from "playwright";
import { preview } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SITE_ORIGIN = "https://www.trenchsports.ai";
const STRICT = process.env.PRERENDER_STRICT === "1";

// Keep in sync with public/sitemap.xml and the explicit rewrites in vercel.json
// (checked below, so drift fails the build instead of silently 404-ing).
const ROUTES = ["/", "/college", "/pro", "/sports-science", "/facilities", "/contact", "/privacy", "/terms", "/signup"];

/**
 * "/" → dist/index.html, "/college" → dist/college.html.
 * A flat .html file rather than college/index.html because that's what
 * `vite preview` resolves for an extensionless path. Vercel reaches it through
 * the explicit rewrites in vercel.json.
 */
function outFile(route) {
  return join(DIST, route === "/" ? "index.html" : `${route.slice(1)}.html`);
}

// Runs in the page before any app code, and hides the prerendered markup when
// it isn't what the app is about to render:
//   • inside the Capacitor shell — bundled builds load from capacitor://localhost,
//     and the native bridge defines window.Capacitor at document start for
//     remote-URL builds (cap:dev / cap:preview). Native "/" goes to /m/home.
//   • on any other path. index.html doubles as the SPA fallback for /dashboard,
//     /invite/:token, /m/* and the rest, and those must not flash the landing
//     page while the bundle loads.
function bootGuard(route) {
  return (
    `<script>(function(){try{var C=window.Capacitor,p=location.pathname.replace(/\\/+$/,"")||"/";` +
    `if(location.protocol==="capacitor:"||(C&&C.isNativePlatform&&C.isNativePlatform())||p!==${JSON.stringify(route)})` +
    `document.documentElement.classList.add("prerender-hide")}catch(e){}})()</script>` +
    `<style>html.prerender-hide [data-prerendered]{display:none!important}</style>`
  );
}

async function launch() {
  // Playwright's own Chromium first (what CI/Vercel installs), then a locally
  // installed Google Chrome so a dev machine doesn't need the extra download.
  const attempts = [{}, { channel: "chrome" }];
  let lastErr;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function checkVercelRewrites() {
  const cfg = JSON.parse(await readFile(join(ROOT, "vercel.json"), "utf8"));
  const rewrites = cfg.rewrites ?? [];
  const catchAll = rewrites.findIndex((r) => r.source === "/(.*)");
  const missing = ROUTES.filter((route) => {
    if (route === "/") return false; // dist/index.html is the filesystem match
    const i = rewrites.findIndex((r) => r.source === route && r.destination === `${route}.html`);
    return i === -1 || (catchAll !== -1 && i > catchAll);
  });
  if (missing.length) {
    throw new Error(
      `vercel.json needs a rewrite to <route>.html, listed before the catch-all, for: ${missing.join(", ")}`,
    );
  }
}

async function main() {
  await checkVercelRewrites();

  // The untouched Vite shell. Every route is rendered from this, and outputs
  // are written only after all routes finish — otherwise later routes would
  // boot from an already-prerendered index.html.
  const shell = await readFile(join(DIST, "index.html"), "utf8");
  if (shell.includes("data-prerendered")) {
    throw new Error("dist/index.html is already prerendered — run `vite build` first.");
  }

  let browser;
  try {
    browser = await launch();
  } catch (e) {
    const msg = `[prerender] no headless browser available, leaving dist/ as the plain SPA shell.\n  ${(e?.message ?? e).split("\n")[0]}`;
    if (STRICT) throw new Error(msg);
    console.warn(`\n⚠️  ${msg}\n   Crawlers that don't run JS will see only index.html's generic tags.\n`);
    return;
  }

  // Port 0 → any free port. The dev server's fixed 5173 collides with other
  // local projects; a preview server pinned to 4173 could too.
  const server = await preview({ root: ROOT, preview: { port: 0, host: "127.0.0.1", strictPort: false }, logLevel: "warn" });
  const base = server.resolvedUrls.local[0].replace(/\/$/, "");
  const outputs = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    // Keep the build hermetic: no Supabase auth calls, no telemetry events from
    // a build machine. Only the preview server itself is reachable.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(base) || url.startsWith("data:") ? route.continue() : route.abort();
    });

    for (const route of ROUTES) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.goto(base + route, { waitUntil: "networkidle" });
      const expectedCanonical = SITE_ORIGIN + (route === "/" ? "/" : route);
      await page
        .waitForFunction(
          (href) => document.querySelector('link[rel="canonical"]')?.getAttribute("href") === href,
          expectedCanonical,
          { timeout: 15000 },
        )
        .catch(() => {});

      const result = await page.evaluate(
        ({ shell, guard }) => {
          const live = document;
          const doc = new DOMParser().parseFromString(shell, "text/html");

          // ── Head: copy over exactly what useSeo manages ────────────────────
          doc.title = live.title;
          const metaKeys = [
            ["name", "description"], ["name", "robots"],
            ["property", "og:title"], ["property", "og:description"], ["property", "og:type"],
            ["property", "og:site_name"], ["property", "og:url"], ["property", "og:image"],
            ["name", "twitter:card"], ["name", "twitter:title"], ["name", "twitter:description"],
            ["name", "twitter:image"],
          ];
          for (const [attr, key] of metaKeys) {
            const src = live.head.querySelector(`meta[${attr}="${key}"]`);
            if (!src) continue;
            let dst = doc.head.querySelector(`meta[${attr}="${key}"]`);
            if (!dst) {
              dst = doc.createElement("meta");
              dst.setAttribute(attr, key);
              doc.head.appendChild(dst);
            }
            dst.setAttribute("content", src.getAttribute("content") ?? "");
          }
          const canonical = live.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
          if (canonical) {
            let link = doc.head.querySelector('link[rel="canonical"]');
            if (!link) {
              link = doc.createElement("link");
              link.setAttribute("rel", "canonical");
              doc.head.appendChild(link);
            }
            link.setAttribute("href", canonical);
          }
          // After <meta charset>, which has to stay within the first 1024 bytes.
          const charset = doc.head.querySelector("meta[charset]");
          if (charset) charset.insertAdjacentHTML("afterend", guard);
          else doc.head.insertAdjacentHTML("afterbegin", guard);

          // ── Body: the rendered tree, tagged so the native guard can hide it ─
          const root = doc.getElementById("root");
          root.innerHTML = live.getElementById("root").innerHTML;
          for (const el of root.children) el.setAttribute("data-prerendered", "");

          return {
            html: "<!doctype html>\n" + doc.documentElement.outerHTML,
            title: live.title,
            canonical,
            textLength: (live.getElementById("root").innerText || "").trim().length,
            // src/lib/errorReporting.tsx's fallback screen.
            errorBoundary: /The app hit an unexpected error/.test(live.getElementById("root").innerText || ""),
          };
        },
        { shell, guard: bootGuard(route) },
      );
      await page.close();

      const problems = [];
      if (result.canonical !== expectedCanonical) problems.push(`canonical is ${result.canonical ?? "missing"}, expected ${expectedCanonical}`);
      if (result.textLength < 200) problems.push(`only ${result.textLength} chars of text rendered`);
      if (result.errorBoundary) problems.push("error boundary rendered");
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(" | ")}`);
      if (problems.length) throw new Error(`[prerender] ${route}: ${problems.join("; ")}`);

      outputs.push({ route, file: outFile(route), html: result.html });
      console.log(`[prerender] ${route.padEnd(16)} ${String(result.textLength).padStart(6)} chars  "${result.title}"`);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }

  for (const { file, html } of outputs) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  console.log(`[prerender] wrote ${outputs.length} page(s) to dist/`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
