#!/usr/bin/env node
/**
 * Drives a REAL pointer drag and a REAL resize on a note and screenshots mid-gesture,
 * so drag/resize preview regressions (dependency lines not following, note body not
 * extending) are visible instead of inferred.
 *
 * Usage: node scripts/perf/drag-shot.mjs [--url ...] [--tag before|after]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3001');
const TAG = flag('--tag', 'after');
const OUT = 'scripts/perf/__visual__/drag';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(1500);

// Zoom in a bit so the note and its links are clearly visible.
await page.evaluate(() => { const c = window.__rmtWorkspace.camera; c.scale = 2.2; c.onChange(); });
await page.waitForTimeout(400);

// Locate a note that HAS dependents, so the dependency lines are on screen, and return
// its on-screen rect (CSS px) computed from the renderer's own posSize + matrix.
const target = await page.evaluate(() => {
  const r = window.__rmtRenderer;
  const P = window.__rmtPerf;
  const mod = P.getModuleRef();
  const m = r.matrix;
  const off = r.canvasOffset || { x: 0, y: 0 };

  let best = null;
  for (const [id, idx] of r._noteIdToIndex.entries()) {
    if (id === 0) continue;
    const deps = (typeof mod.getDependentNotes === 'function') ? (mod.getDependentNotes(id) || []) : [];
    const o = idx * 4;
    const xw = r.posSize[o], yw = r.posSize[o + 1];
    const w = r.posSize[o + 2] * (r.xScalePxPerWU || 1);
    const h = r.posSize[o + 3] * (r.yScalePxPerWU || 1);
    const left = (m[0] * xw + m[3] * yw + m[6]) - off.x;
    const top = (m[1] * xw + m[4] * yw + m[7]) - off.y;
    if (left < 60 || top < 130 || left + w > 1200 || top + h > 740 || w < 40) continue;
    const score = deps.length;
    if (!best || score > best.score) best = { id, idx, left, top, w, h, score };
  }
  if (best) r.setHoverNoteId(best.id);
  return best;
});

if (!target) { console.log('no suitable note on screen'); await browser.close(); process.exit(1); }
console.log(`target note [${target.id}] rect=(${target.left.toFixed(0)},${target.top.toFixed(0)}) ${target.w.toFixed(0)}x${target.h.toFixed(0)} dependents=${target.score}`);

const shot = async (name) => {
  writeFileSync(`${OUT}/${TAG}-${name}.png`, await page.locator('canvas').first().screenshot());
  console.log(`  wrote ${TAG}-${name}.png`);
};

// --- select it first (click), so dependency lines/rings are drawn ---
const cx = target.left + target.w * 0.5;
const cy = target.top + target.h * 0.5;
await page.mouse.click(cx, cy);
await page.waitForTimeout(500);
await shot('1-selected');

// --- MOVE drag: press in the middle, move right+up, hold, screenshot mid-drag ---
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy - 20, { steps: 6 });
await page.mouse.move(cx + 150, cy - 40, { steps: 8 });
await page.waitForTimeout(350);
await shot('2-mid-move-drag');
await page.mouse.up();
await page.waitForTimeout(400);
await shot('3-after-move-drop');

// --- RESIZE drag: grab the right pull tab (inside the right edge) and extend ---
const t2 = await page.evaluate((id) => {
  const r = window.__rmtRenderer;
  const idx = r._noteIdToIndex.get(id);
  const m = r.matrix, off = r.canvasOffset || { x: 0, y: 0 };
  const o = idx * 4;
  const xw = r.posSize[o], yw = r.posSize[o + 1];
  const w = r.posSize[o + 2] * (r.xScalePxPerWU || 1);
  const h = r.posSize[o + 3] * (r.yScalePxPerWU || 1);
  const left = (m[0] * xw + m[3] * yw + m[6]) - off.x;
  const top = (m[1] * xw + m[4] * yw + m[7]) - off.y;
  return { left, top, w, h };
}, target.id);

// Ask the renderer's OWN sub-region hit test where the pull tab is, instead of guessing at
// an offset from the right edge — guessing landed inside the body and produced a move, which
// silently made this a move test rather than a resize test.
const tabHit = await page.evaluate(({ left, top, w, h }) => {
  const r = window.__rmtRenderer;
  const y = top + h * 0.5;
  for (let dx = 2; dx < Math.min(60, w); dx++) {
    const x = left + w - dx;
    const hs = r.hitTestSubRegion(x, y);
    if (hs && hs.region === 'tab') return { x, y, region: hs.region, noteId: hs.noteId };
  }
  return null;
}, t2);
if (!tabHit) { console.log('  !! could not locate pull tab via hitTestSubRegion'); }
else console.log(`  pull tab at (${tabHit.x.toFixed(0)},${tabHit.y.toFixed(0)}) on note ${tabHit.noteId}`);
const tabX = tabHit ? tabHit.x : (t2.left + t2.w - 6);
const tabY = tabHit ? tabHit.y : (t2.top + t2.h * 0.5);
await page.mouse.move(tabX, tabY);
await page.waitForTimeout(200);
await page.mouse.down();
await page.mouse.move(tabX + 80, tabY, { steps: 6 });
await page.mouse.move(tabX + 200, tabY, { steps: 8 });
await page.waitForTimeout(350);
await shot('4-mid-resize-drag');
await page.mouse.up();
await page.waitForTimeout(400);
await shot('5-after-resize-drop');

if (errors.length) console.log('page errors:', errors.slice(0, 3));
await browser.close();
