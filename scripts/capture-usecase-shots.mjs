// scripts/capture-usecase-shots.mjs
// Captures real Trench app UI for the use-case device mockups (Teamworks-style).
// Re-runnable: this is the anti-staleness answer — when the dashboard UI changes,
// re-run this and the marketing shots refresh. No manual image pipeline.
//
//   1. start the dev server:   npm run dev
//   2. capture:                node scripts/capture-usecase-shots.mjs
//      (override host)          BASE_URL=http://localhost:5173 node scripts/capture-usecase-shots.mjs
//
// COMPLIANCE: the /dummy demo contains "Fatigue Tracker" and an "Injury" report —
// banned marketing language. We only clip the measurement-only dashboard band
// (stat tiles → Recent Sessions → Session Summary), which sits between the tier
// overview (above) and the Coaching Insights "FATIGUE" card (below). Every shot
// is scanned for banned words after capture and the run FAILS if any survive.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "useCases");
const BANNED = /injury|injuries|return.to.play|fatigue|rehab/i;

async function assertClean(page, clip, name) {
  // Scan only RENDERED text nodes inside the clip box (skip <style>/<script>, whose
  // CSS/JS text mentions the ".dm-fatigueRow" class etc. — not visible to visitors).
  const hits = await page.evaluate(({ clip, src }) => {
    const bad = new RegExp(src, "i");
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName;
      if (tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT") continue;
      const t = (node.textContent || "").trim();
      if (!t || !bad.test(t)) continue;
      const r = parent.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const inside = r.left < clip.x + clip.width && r.right > clip.x && r.top < clip.y + clip.height && r.bottom > clip.y;
      if (inside) out.push(t.slice(0, 50));
    }
    return out;
  }, { clip, src: BANNED.source });
  if (hits.length) {
    throw new Error(`COMPLIANCE: banned language inside "${name}" shot:\n  - ${hits.join("\n  - ")}`);
  }
}

// Click one of the /dummy section tabs (Recent Sessions / Insights & Analysis / …).
async function selectTab(page, label) {
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll("button.ts-tabBtn")].find((b) => b.textContent.trim() === label);
    if (btn) btn.click();
  }, label);
  await page.waitForFunction(
    (label) => document.querySelector("button.ts-tabBtn.isActive")?.textContent.trim() === label,
    label,
    { timeout: 5000 }
  );
  await page.waitForTimeout(350);
}

// Screenshot a single dashboard card by its title, scanning only that card for banned text.
async function captureCard(page, cardLabel, fileBase, outDir, shots) {
  const ok = await page.evaluate((label) => {
    const cards = [...document.querySelectorAll(".ts-card, .ts-span2")];
    const el = cards.find((c) => {
      const h = c.querySelector(".ts-cardTitle, h2, h3, h4");
      const r = c.getBoundingClientRect();
      return h && h.textContent.trim() === label && r.width > 0 && r.height > 0 && c.offsetParent !== null;
    });
    if (!el) return false;
    el.setAttribute("data-shot", "1");
    el.scrollIntoView({ block: "center" });
    return true;
  }, cardLabel);
  if (!ok) throw new Error(`card not found: "${cardLabel}"`);
  await page.waitForTimeout(250);

  // Element-scoped compliance scan (rendered text only, skip style/script).
  const hits = await page.evaluate(({ src }) => {
    const bad = new RegExp(src, "i");
    const root = document.querySelector('[data-shot="1"]');
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement;
      if (!p || ["STYLE", "SCRIPT"].includes(p.tagName)) continue;
      const t = (n.textContent || "").trim();
      if (t && bad.test(t)) out.push(t.slice(0, 50));
    }
    return out;
  }, { src: BANNED.source });
  if (hits.length) throw new Error(`COMPLIANCE: banned language inside "${fileBase}":\n  - ${hits.join("\n  - ")}`);

  const path = join(outDir, `${fileBase}.png`);
  await page.locator('[data-shot="1"]').screenshot({ path });
  await page.evaluate(() => document.querySelector('[data-shot="1"]')?.removeAttribute("data-shot"));
  shots.push([fileBase, "card"]);
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const shots = [];

  // ── Desktop dashboard (deviceScaleFactor 2 → retina-crisp) ─────────────────
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 2100 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await page.goto(`${BASE_URL}/dummy`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ts-dashTop", { timeout: 15000 });
  await page.waitForTimeout(500);

  // Compliant band: top of the stat tiles → bottom of the Session Summary card.
  const band = await page.evaluate(() => {
    const top = document.querySelector(".ts-dashTop");
    const summary = document.querySelector(".ts-heatmapCard");
    const t = top.getBoundingClientRect();
    const s = summary.getBoundingClientRect();
    const pad = 10;
    return {
      x: Math.max(0, Math.round(Math.min(t.left, s.left) - pad)),
      y: Math.round(t.top - pad),
      width: Math.round(Math.max(t.right, s.right) - Math.min(t.left, s.left) + pad * 2),
      height: Math.round(s.bottom - t.top + pad * 2),
    };
  });
  await assertClean(page, band, "coach-dashboard");
  const dashPath = join(OUT_DIR, "coach-dashboard.png");
  await page.screenshot({ path: dashPath, clip: band });
  shots.push(["coach-dashboard", band]);

  // Session Summary card on its own — force / SI / cadence / 3D angle (compliant).
  const summaryClip = await page.evaluate(() => {
    const el = document.querySelector(".ts-heatmapCard");
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await assertClean(page, summaryClip, "session-summary");
  const summaryPath = join(OUT_DIR, "session-summary.png");
  await page.screenshot({ path: summaryPath, clip: summaryClip });
  shots.push(["session-summary", summaryClip]);

  // ── Pro / Sports-Science cards from the Insights tab ───────────────────────
  await selectTab(page, "Insights & Analysis");
  await captureCard(page, "Athlete Leaderboard", "leaderboard", OUT_DIR, shots);
  await captureCard(page, "Team Comparison", "team-comparison", OUT_DIR, shots);
  await captureCard(page, "Most Improved", "most-improved", OUT_DIR, shots); // sports-science longitudinal analytics

  // ── Pro card: CSV export / API (Export & API tab, AMS-integration angle) ───
  await selectTab(page, "Export & API");
  await captureCard(page, "Session-Summary CSV Export", "export-api", OUT_DIR, shots);

  // ── Sports-Science: AI Coaching Insights, with the "Fatigue" card removed ──
  // COMPLIANCE: that one card uses banned language; we drop the node entirely
  // (read-only throwaway page) so it's gone from both the pixels and the scan.
  await selectTab(page, "Recent Sessions");
  const ci = await page.evaluate(() => {
    // The inner .ts-card (title + cards wrapper), not the outer .ts-span2 grid cell.
    const container = [...document.querySelectorAll(".ts-card")]
      .filter((el) => (el.textContent || "").trim().startsWith("Coaching Insights"))
      .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; });
    if (!container) return false;
    const wrap = container.children[1] || container; // children[0] = title row, [1] = cards
    [...wrap.children].forEach((card) => { if (/fatigue|injur/i.test(card.textContent || "")) card.remove(); });
    container.setAttribute("data-shot", "1");
    container.scrollIntoView({ block: "center" });
    return true;
  });
  if (!ci) throw new Error("Coaching Insights not found");
  await page.waitForTimeout(300);
  const ciHits = await page.evaluate(({ src }) => {
    const bad = new RegExp(src, "i");
    const root = document.querySelector('[data-shot="1"]');
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement;
      if (!p || ["STYLE", "SCRIPT"].includes(p.tagName)) continue;
      const t = (n.textContent || "").trim();
      if (t && bad.test(t)) out.push(t.slice(0, 50));
    }
    return out;
  }, { src: BANNED.source });
  if (ciHits.length) throw new Error(`COMPLIANCE: banned language in "coaching-insights":\n  - ${ciHits.join("\n  - ")}`);
  await page.locator('[data-shot="1"]').screenshot({ path: join(OUT_DIR, "coaching-insights.png") });
  await page.evaluate(() => document.querySelector('[data-shot="1"]')?.removeAttribute("data-shot"));
  shots.push(["coaching-insights", "card"]);

  await desktop.close();

  // ── Mobile app (phone frame source) ────────────────────────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  const mpage = await mobile.newPage();
  try {
    await mpage.goto(`${BASE_URL}/m/home`, { waitUntil: "networkidle", timeout: 15000 });
    await mpage.waitForTimeout(800);
    const full = { x: 0, y: 0, width: 390, height: 844 };
    await assertClean(mpage, full, "mobile-home");
    const mobilePath = join(OUT_DIR, "mobile-home.png");
    await mpage.screenshot({ path: mobilePath });
    shots.push(["mobile-home", full]);
  } catch (e) {
    console.warn(`[capture] mobile shot skipped: ${e.message}`);
  }
  await mobile.close();
  await browser.close();

  const manifest = shots.map(([name, box]) => ({ name, file: `${name}.png`, box }));
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[capture] wrote ${shots.length} shot(s) to ${OUT_DIR}`);
  shots.forEach(([n, b]) => console.log(`  ${n}.png  ${b.width}x${b.height} (css px, @2-3x)`));
}

run().catch((e) => { console.error(e); process.exit(1); });
