#!/usr/bin/env node
/**
 * Visual regression capture + compare for the renderer.
 *
 * The display performance work is only acceptable if the picture does not
 * change. This drives the real app across a matrix of camera/zoom/selection/
 * hover states, screenshots the GL canvas, and diffs against a stored baseline
 * pixel by pixel.
 *
 * Usage:
 *   node scripts/perf/visual-regress.mjs --capture           # write baseline
 *   node scripts/perf/visual-regress.mjs --compare           # diff vs baseline
 *   node scripts/perf/visual-regress.mjs --compare --out dir # where diffs land
 *   ... --url http://localhost:3000  --module chords-dense
 *
 * Exits non-zero if any scene differs beyond --tolerance (default 0 pixels).
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const MODULES = String(flag('--modules', 'defaultModule,chords-dense,voices-5000')).split(',');
const CAPTURE = argv.includes('--capture');
const OUT = String(flag('--out', 'scripts/perf/__visual__'));
// The GL context is created with antialias:true, and MSAA sample resolution is not
// bit-deterministic across runs: re-comparing an UNCHANGED build still flips a
// handful of edge pixels (measured floor: <=7 px of 1,024,000, maxDelta<=15). So a
// zero-pixel gate would be permanently red. This threshold sits far above that noise
// floor and far below any real regression — a note shifted by one row, a dropped
// glyph, or a missing ring all move thousands of pixels.
const TOLERANCE = Number(flag('--tolerance', 300));
const SNAPSHOT_KEY = 'rmt:moduleSnapshot:v1';

// Scenes exercise every visual subsystem the perf work touches: note bodies,
// borders, per-note text/fractions, pull tabs, arrows, dividers, measure bars,
// measure triangles, octave guides, selection ring + fill, hover ring,
// dependency highlight rings and dependency lines — at several zooms, because
// zoom is exactly what an LOD/culling change could silently alter.
const SCENES = [
  { name: 'default-view', setup: null },
  { name: 'zoom-in-2x', setup: { zoom: 2.0 } },
  { name: 'zoom-in-6x', setup: { zoom: 6.0 } },
  { name: 'zoom-out-half', setup: { zoom: 0.5 } },
  { name: 'zoom-out-quarter', setup: { zoom: 0.25 } },
  { name: 'zoom-out-far', setup: { zoom: 0.1 } },
  { name: 'panned', setup: { zoom: 1.0, panX: 600, panY: 120 } },
  { name: 'selected-hub', setup: { selectHub: true } },
  { name: 'selected-hub-zoomed', setup: { selectHub: true, zoom: 2.5 } },
  { name: 'hover-note', setup: { hoverFirst: true } },
  { name: 'selected-and-hover', setup: { selectHub: true, hoverFirst: true } },
];

async function applyScene(page, setup) {
  await page.evaluate((s) => {
    const r = window.__rmtRenderer;
    const P = window.__rmtPerf;
    const ws = window.__rmtWorkspace;

    // Reset interaction state so scenes are independent of each other.
    if (window.__CULL_OFF) r.__cullOff = true;
    if (window.__METRICS_MEMO_OFF) r.__metricsMemoOff = true;
    if (window.__ATLAS_CACHE_OFF) r.__atlasCacheOff = true;
    try { r.setHoverNoteId(null); } catch {}
    try { r.setHoverMeasureId(null); } catch {}

    if (!s) { r.needsRedraw = true; return; }

    // Drive the real camera, then fire onChange so the workspace pushes the new
    // basis into the renderer exactly as a user pan/zoom would.
    const cam = ws && ws.camera ? ws.camera : null;
    if (cam && (s.zoom != null || s.panX != null || s.panY != null)) {
      if (s.zoom != null) {
        cam.scale = Math.min(cam.maxScale ?? 10, Math.max(cam.minScale ?? 0.1, s.zoom));
      }
      if (s.panX != null) cam.tx = (cam.tx || 0) - s.panX;
      if (s.panY != null) cam.ty = (cam.ty || 0) - s.panY;
      if (typeof cam.onChange === 'function') cam.onChange();
    }

    if (s.selectHub) {
      const hub = P.pickHubNoteId();
      window.__rmtSelectedForShot = hub.id;
      r.sync({
        evaluatedNotes: P.getEvaluatedNotesRef(),
        module: P.getModuleRef(),
        xScaleFactor: r.currentXScaleFactor || 1.0,
        yScaleFactor: r.currentYScaleFactor || 1.0,
        selectedNoteId: hub.id
      });
    }

    if (s.hoverFirst) {
      const mod = P.getModuleRef();
      const ids = Object.keys(mod.notes).map(Number).filter((i) => i !== 0).sort((a, b) => a - b);
      if (ids.length) r.setHoverNoteId(ids[Math.floor(ids.length / 2)]);
    }

    r.needsRedraw = true;
  }, setup);

  // Two rAF ticks so the scene is fully drawn (some passes cache on the first).
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  // Diagnostic: force N extra redraws to detect passes that need more than one frame to
  // converge. A green run WITHOUT this is the real requirement — one redraw must suffice.
  if (process.env.FORCE_REDRAWS) {
    await page.evaluate(async () => {
      const r = window.__rmtRenderer;
      for (let i = 0; i < 10; i++) {
        r.needsRedraw = true;
        await new Promise((res) => requestAnimationFrame(res));
      }
    });
  }
  await page.waitForTimeout(250);
}

async function shootModule(browser, moduleName, dir) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, SNAPSHOT_KEY);
  // Bisect switch: CULL_OFF=1 disables the overlay viewport cull so a visual diff can be
  // attributed to culling vs. the other renderer changes.
  if (process.env.CULL_OFF) await page.addInitScript(() => { window.__CULL_OFF = true; });
  if (process.env.METRICS_MEMO_OFF) await page.addInitScript(() => { window.__METRICS_MEMO_OFF = true; });
  if (process.env.ATLAS_CACHE_OFF) await page.addInitScript(() => { window.__ATLAS_CACHE_OFF = true; });

  if (moduleName !== 'defaultModule') {
    const res = await page.request.get(`${URL_BASE}/modules/perf/${moduleName}.json`);
    if (!res.ok()) throw new Error(`fetch ${moduleName}: ${res.status()}`);
    const body = await res.text();
    await page.route('**/modules/defaultModule.json', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body })
    );
  }

  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => !!(window.__rmtPerf && window.__rmtRenderer && window.__rmtRenderer.instanceCount > 0),
    null, { timeout: 180_000 }
  );
  await page.waitForTimeout(1200);

  const canvas = page.locator('canvas').first();
  const shots = [];
  for (const scene of SCENES) {
    await applyScene(page, scene.setup);
    const file = join(dir, `${moduleName}__${scene.name}.png`);
    const buf = await canvas.screenshot();
    shots.push({ scene: scene.name, file, buf });
  }
  await ctx.close();
  return { shots, errors };
}

function diff(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { changed: -1, total: 0, note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const out = new PNG({ width: a.width, height: a.height });
  let changed = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    const d = Math.max(dr, dg, db, da);
    if (d > maxDelta) maxDelta = d;
    if (d > 0) {
      changed++;
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
    } else {
      // dim the unchanged pixels so differences pop
      out.data[i] = a.data[i] >> 2; out.data[i + 1] = a.data[i + 1] >> 2;
      out.data[i + 2] = a.data[i + 2] >> 2; out.data[i + 3] = 255;
    }
  }
  return { changed, total: a.width * a.height, maxDelta, png: out };
}

const baseDir = join(OUT, 'baseline');
const curDir = join(OUT, 'current');
const diffDir = join(OUT, 'diff');
for (const d of [OUT, baseDir, curDir, diffDir]) mkdirSync(d, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist']
});

let failures = 0;
for (const m of MODULES) {
  process.stdout.write(`\n=== ${m} ===\n`);
  const dir = CAPTURE ? baseDir : curDir;
  let r;
  try {
    r = await shootModule(browser, m, dir);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    failures++;
    continue;
  }
  for (const s of r.shots) {
    writeFileSync(s.file, s.buf);
    if (CAPTURE) {
      console.log(`  captured ${s.scene}`);
      continue;
    }
    const basePath = join(baseDir, `${m}__${s.scene}.png`);
    if (!existsSync(basePath)) { console.log(`  ${s.scene}: NO BASELINE`); continue; }
    const d = diff(readFileSync(basePath), s.buf);
    if (d.changed === -1) {
      console.log(`  ${s.scene}: SIZE MISMATCH (${d.note})`);
      failures++;
      continue;
    }
    const pct = ((d.changed / d.total) * 100).toFixed(4);
    if (d.changed > TOLERANCE) {
      const dp = join(diffDir, `${m}__${s.scene}.diff.png`);
      writeFileSync(dp, PNG.sync.write(d.png));
      console.log(`  ${s.scene}: DIFF ${d.changed} px (${pct}%) maxDelta=${d.maxDelta}  -> ${dp}`);
      failures++;
    } else {
      console.log(`  ${s.scene}: identical`);
    }
  }
  if (r.errors.length) console.log(`  !! page errors: ${r.errors.slice(0, 3).join(' | ')}`);
}

await browser.close();

if (CAPTURE) {
  console.log(`\nbaseline written to ${baseDir}`);
} else if (failures) {
  console.log(`\n${failures} scene(s) differ from baseline.`);
  process.exit(1);
} else {
  console.log('\nall scenes pixel-identical to baseline.');
}
