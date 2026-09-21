// scripts/appstore-screenshots.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Renders the App Store screenshot sets straight from the running app.
//
//   1. start the dev server:   npm run dev
//   2. render:                 node scripts/appstore-screenshots.mjs
//
// Authenticated screens (dashboard, coach session) need a demo login:
//   DEMO_EMAIL=… DEMO_PASSWORD=… node scripts/appstore-screenshots.mjs
// Without them those shots are SKIPPED with a warning rather than failing the
// run, so you can always get the unauthenticated set out.
//
// Output → app-store/screenshots/{iphone-6.9,ipad-13}/NN-name.jpg
//
// WHY THIS EXISTS RATHER THAN A FOLDER OF HAND-MADE PNGs
// Screenshots go stale silently. A listing showing a UI you shipped over a year
// ago is the single most common reason a good app looks abandoned in search. As
// with capture-usecase-shots.mjs, the answer is to make refreshing them one
// command instead of an afternoon in a design tool.
//
// THREE HARD CONSTRAINTS THIS SCRIPT ENFORCES, BECAUSE APPLE REJECTS ON ALL THREE
//
//   1. Exact pixel dimensions. iPhone 6.9" is 1320×2868 and iPad 13" is
//      2048×2732. One pixel off and App Store Connect refuses the upload. We hit
//      them exactly by choosing CSS viewports that multiply cleanly by the
//      device scale factor (440×956 @3x, 1024×1366 @2x) rather than by scaling
//      an image afterwards, which would soften every line of text.
//
//   2. No alpha channel. Apple rejects PNGs carrying transparency, and a PNG
//      that is fully opaque still carries the channel. So every file is written
//      as JPEG, which has no alpha by construction. Do not "helpfully" switch
//      this back to PNG.
//
//   3. Banned marketing language. Same rule and same regex as
//      capture-usecase-shots.mjs — a screenshot is more public than a marketing
//      page, not less, and describing performance data in injury terms invites
//      Apple to assess the app as a medical device. The run FAILS rather than
//      warns if any of it survives into a shot.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from "playwright";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "app-store", "screenshots");
const TMP_DIR = join(OUT_DIR, ".raw");

const DEMO_EMAIL = process.env.DEMO_EMAIL || "";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "";

const BANNED = /injury|injuries|return.to.play|fatigue|rehab/i;

// ── Device targets ───────────────────────────────────────────────────────────
// `css × scale` must equal Apple's required pixel size exactly. Check the
// arithmetic before adding a device — this is the whole correctness argument.
const DEVICES = {
  "iphone-6.9": {
    label: 'iPhone 6.9"',
    css: { width: 440, height: 956 },
    scale: 3,
    out: { width: 1320, height: 2868 },
    isMobile: true,
    // Covers every larger iPhone; Apple scales 6.9" down for 6.5" and below.
    required: true,
  },
  "ipad-13": {
    label: 'iPad 13"',
    css: { width: 1024, height: 1366 },
    scale: 2,
    out: { width: 2048, height: 2732 },
    isMobile: false,
    // Required only while TARGETED_DEVICE_FAMILY includes iPad (it does: "1,2").
    // Drop iPad from the target and you can delete this entry.
    required: true,
  },
};

// ── Shot list ────────────────────────────────────────────────────────────────
// Order is the order they appear in the listing. The first two are the only
// ones most people ever see — they show in search results without a tap — so
// they carry the product's whole argument: live capture, then the coach's
// read-out. Everything after is for the person already interested.
//
// NOT sourced from /dummy, deliberately. That route is the public marketing
// demo: it renders a fixed "Interactive demo … fictional program … read-only"
// banner, a View-only pill and a tier toggle. Shipping it as a listing
// screenshot is a Guideline 2.3.3 problem — screenshots must show the app in
// use — and it reads as a web page rather than the iOS app. It also trips the
// compliance scan below, because /dummy renders the word "fatigue" three times
// at default tier. Every shot here comes from a real app route.
const SHOTS = [
  {
    name: "live-session",
    route: "/m/home",
    auth: false,
    waitFor: null,
    caption: "See every impact\nas it lands",
    sub: "96 cells, live, on the bag itself",
  },
  {
    name: "modes",
    route: "/m/home",
    auth: false,
    waitFor: null,
    caption: "Five ways to\nrun a session",
    sub: "Power · Accuracy · Reaction · Volume · Target",
  },
  {
    name: "coach-session",
    route: "/m/session",
    auth: true,
    waitFor: null,
    caption: "Queue the line\nand work down it",
    sub: "Pick an athlete, connect, record, save",
  },
  {
    name: "dashboard",
    route: "/m/dashboard",
    auth: true,
    waitFor: null,
    caption: "The whole roster,\nnot one athlete",
    sub: "Sessions, leaderboards and trends in one place",
  },
  {
    name: "leaderboard",
    route: "/m/dashboard",
    auth: true,
    waitFor: null,
    caption: "Rank by change,\nnot just by level",
    sub: "So the athlete improving fastest gets noticed",
  },
];

// ── Composition template ─────────────────────────────────────────────────────
// A caption band over a device-inset screenshot. Rendered as a real page at the
// exact output size so text is laid out by the browser at final resolution —
// never scaled, so never soft.
function composeHtml({ shotDataUri, caption, sub, width, height, accent }) {
  const isPhone = width < 1600;
  // Everything scales off the output width, so one template serves both devices.
  const u = width / 1320;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width:${width}px; height:${height}px;
    background:#07060b;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif;
    overflow:hidden;
  }
  /* Brand wash. Kept low-contrast so it frames the screenshot instead of
     competing with it — the UI is the thing being sold, not the gradient. */
  .bg {
    position:absolute; inset:0;
    background:
      radial-gradient(120% 70% at 50% -10%, ${accent}38 0%, transparent 60%),
      radial-gradient(90% 50% at 50% 108%, ${accent}1f 0%, transparent 65%),
      #07060b;
  }
  .wrap {
    position:relative; width:100%; height:100%;
    display:flex; flex-direction:column; align-items:center;
    padding:${Math.round(96 * u)}px ${Math.round(72 * u)}px ${Math.round(80 * u)}px;
  }
  h1 {
    color:#fff; text-align:center;
    font-size:${Math.round((isPhone ? 92 : 104) * u)}px;
    line-height:1.08;
    letter-spacing:${Math.round(-2.5 * u)}px;
    font-weight:800;
    white-space:pre-line;
  }
  p.sub {
    color:#9d95b5; text-align:center;
    font-size:${Math.round((isPhone ? 38 : 44) * u)}px;
    line-height:1.35;
    margin-top:${Math.round(28 * u)}px;
    font-weight:500;
    max-width:${Math.round(1000 * u)}px;
  }
  .shot {
    flex:1; width:100%;
    margin-top:${Math.round(72 * u)}px;
    display:flex; align-items:flex-start; justify-content:center;
    min-height:0;
  }
  /* The screenshot sits in a rounded, hairline-bordered plate. It reads as a
     device without drawing a literal bezel — Apple's own guidance discourages
     device frames, and a real bezel dates the shot to one hardware generation. */
  .plate {
    max-width:100%; max-height:100%;
    border-radius:${Math.round(56 * u)}px;
    overflow:hidden;
    border:${Math.max(1, Math.round(3 * u))}px solid ${accent}55;
    box-shadow:0 ${Math.round(40 * u)}px ${Math.round(90 * u)}px rgba(0,0,0,.6);
    background:#0d0b14;
  }
  .plate img { display:block; width:100%; height:auto; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="wrap">
    <h1>${caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h1>
    <p class="sub">${sub.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>
    <div class="shot"><div class="plate"><img src="${shotDataUri}"></div></div>
  </div>
</body></html>`;
}

// ── Compliance scan ──────────────────────────────────────────────────────────
// Rendered text nodes only. <style>/<script> contents mention class names like
// ".dm-fatigueRow" that no visitor ever sees, and failing on those would make
// the check impossible to satisfy.
async function assertClean(page, name) {
  const hits = await page.evaluate((src) => {
    const bad = new RegExp(src, "i");
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (!p || ["STYLE", "SCRIPT", "NOSCRIPT"].includes(p.tagName)) continue;
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const t = (node.textContent || "").trim();
      if (t && bad.test(t)) out.push(t.slice(0, 60));
    }
    return out;
  }, BANNED.source);
  if (hits.length) {
    throw new Error(
      `COMPLIANCE: banned language in "${name}":\n  - ${hits.join("\n  - ")}\n` +
      `Fix the UI or drop this shot. Do not ship it.`
    );
  }
}

async function signIn(context) {
  if (!DEMO_EMAIL || !DEMO_PASSWORD) return false;
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/m/login`, { waitUntil: "networkidle", timeout: 20000 });
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
    await page.close();
    return true;
  } catch (e) {
    console.warn(`[appstore] sign-in failed (${e.message.split("\n")[0]}) — authenticated shots will be skipped`);
    await page.close().catch(() => {});
    return false;
  }
}

async function run() {
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const accent = "#b400ff"; // Power mode purple, from src/lib/sessionModes.ts
  const browser = await chromium.launch();
  const manifest = [];
  let failures = 0;

  // Everything below runs inside try/finally. A COMPLIANCE throw has to unwind
  // both loops — that is the point of it — but it must not also leak a headless
  // Chromium and lose the manifest for the shots that DID render. Cleanup lives
  // in the finally, not after the loops.
  try {
  for (const [key, dev] of Object.entries(DEVICES)) {
    const devOut = join(OUT_DIR, key);
    await mkdir(devOut, { recursive: true });

    const context = await browser.newContext({
      viewport: dev.css,
      deviceScaleFactor: dev.scale,
      isMobile: dev.isMobile,
      hasTouch: dev.isMobile,
      // A desktop UA on iPad: the app's own isMobile.ts decides layout from
      // width, and an iPhone UA would push the iPad into the phone layout.
      ...(dev.isMobile
        ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }
        : {}),
    });

    const authed = await signIn(context);
    let index = 0;

    for (const shot of SHOTS) {
      if (shot.auth && !authed) {
        console.warn(`[appstore] ${key}/${shot.name}: SKIPPED (needs DEMO_EMAIL + DEMO_PASSWORD)`);
        continue;
      }
      const page = await context.newPage();
      let comp = null;
      try {
        await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: "networkidle", timeout: 25000 });
        if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 15000 });
        await page.waitForTimeout(900); // let entrance animations settle

        await assertClean(page, `${key}/${shot.name}`);

        const rawPath = join(TMP_DIR, `${key}-${shot.name}.png`);
        await page.screenshot({ path: rawPath });
        await page.close();

        // ── Compose ──────────────────────────────────────────────────────────
        const dataUri = `data:image/png;base64,${(await readFile(rawPath)).toString("base64")}`;
        comp = await browser.newContext({
          // Already in device pixels, so render 1:1 — the caption text is laid
          // out by the browser at final resolution and never resampled. The
          // embedded screenshot itself IS downscaled to fit inside the padded
          // plate; that part is an image resize and is fine.
          viewport: dev.out,
          deviceScaleFactor: 1,
        });
        const cpage = await comp.newPage();
        await cpage.setContent(
          composeHtml({
            shotDataUri: dataUri,
            caption: shot.caption,
            sub: shot.sub,
            width: dev.out.width,
            height: dev.out.height,
            accent,
          }),
          { waitUntil: "load" }
        );
        await cpage.waitForTimeout(250);

        // Numbered only on success, so a failed shot leaves no gap in the
        // sequence. App Store Connect orders screenshots by upload order, and
        // a listing that jumps 01, 03, 04 is a listing someone will mis-order.
        index += 1;
        const outFile = join(devOut, `${String(index).padStart(2, "0")}-${shot.name}.jpg`);
        // JPEG, not PNG — see constraint 2 at the top of this file.
        await cpage.screenshot({ path: outFile, type: "jpeg", quality: 96 });

        manifest.push({
          device: dev.label,
          file: outFile.replace(ROOT + "/", ""),
          size: `${dev.out.width}x${dev.out.height}`,
          route: shot.route,
          caption: shot.caption.replace(/\n/g, " "),
        });
        console.log(`[appstore] ✓ ${key}/${shot.name}  ${dev.out.width}×${dev.out.height}`);
      } catch (e) {
        failures += 1;
        console.error(`[appstore] ✗ ${key}/${shot.name}: ${e.message.split("\n")[0]}`);
        if (/^COMPLIANCE/.test(e.message)) throw e; // never swallow these
      } finally {
        await page.close().catch(() => {});
        await comp?.close().catch(() => {});
      }
    }
    await context.close();
  }
  } finally {
    await browser.close().catch(() => {});
    await rm(TMP_DIR, { recursive: true, force: true });
    // Written even on a COMPLIANCE abort, so the shots that did render are
    // still accounted for and you can see how far the run got.
    await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`\n[appstore] ${manifest.length} screenshot(s) → ${OUT_DIR}`);
  }

  if (!manifest.length) {
    console.error("[appstore] nothing rendered. Is `npm run dev` running on " + BASE_URL + "?");
    process.exit(1);
  }
  if (failures) {
    console.warn(`[appstore] ${failures} shot(s) failed — see above before uploading.`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
