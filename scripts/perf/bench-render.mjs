#!/usr/bin/env node
/**
 * End-to-end render benchmark.
 *
 * Boots the app in a real (GPU-backed) Chromium, loads a stress module, and
 * reports the per-pass frame cost from window.__rmtPerf. This is the ground
 * truth for the display performance work: static analysis says where the loops
 * are, this says where the milliseconds are.
 *
 * Usage:
 *   npm run dev                                   # in another terminal
 *   node scripts/perf/bench-render.mjs                        # default ladder
 *   node scripts/perf/bench-render.mjs voices-20000           # one module
 *   node scripts/perf/bench-render.mjs --url http://localhost:5173
 *   node scripts/perf/bench-render.mjs --json out.json        # machine-readable
 *   node scripts/perf/bench-render.mjs --headed               # watch it run
 *
 * Requires: npx playwright (chromium already installed).
 */

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : def;
};
const URL_BASE = flag('--url', 'http://localhost:5173');
const HEADED = argv.includes('--headed');
const JSON_OUT = flag('--json', null);
const positional = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--url' && argv[argv.indexOf(a) - 1] !== '--json');
const MODULES = positional.length ? positional : ['voices-5000', 'voices-20000', 'voices-100000'];

const SNAPSHOT_KEY = 'rmt:moduleSnapshot:v1';

async function benchModule(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const modUrl = `${URL_BASE}/modules/perf/${name}.json`;
  const res = await page.request.get(modUrl);
  if (!res.ok()) throw new Error(`cannot fetch ${modUrl}: ${res.status()}`);
  const moduleJson = await res.text();

  // Serve the stress module in place of the default module at boot. Going through
  // the app's own boot fetch (module.js loadFromJSON -> fetch('modules/defaultModule.json'))
  // avoids the ~5MB localStorage quota and the 3MB file-load cap, both of which a
  // 100k-note module blows past. Ensure no stale snapshot pre-empts the fetch.
  await page.addInitScript((key) => { try { localStorage.removeItem(key); } catch {} }, SNAPSHOT_KEY);
  await page.route('**/modules/defaultModule.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: moduleJson })
  );

  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });

  // Wait for the module + renderer to be live. Large modules take a while to
  // evaluate on boot, so this gets a generous budget.
  await page.waitForFunction(
    () => !!(window.__rmtPerf && window.__rmtRenderer && window.__rmtRenderer.instanceCount > 0),
    null,
    { timeout: 180_000 }
  );

  // Let the first frames settle (glyph atlas warm-up, initial sync).
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const P = window.__rmtPerf;
    const r = window.__rmtRenderer;
    const notes = P.info().notes;

    // Silence console.table spam from the harness during the run.
    const table = console.table; const log = console.log;
    console.table = () => {}; console.log = () => {};
    let out;
    try {
      const idle = P.measureIdleFrame(60);
      const passes = P.profileFrame(30, null);
      const hub = P.pickHubNoteId();
      const passesSel = P.profileFrame(30, hub.id);
      const sync = P.measureSync(10, null);

      // Real-world rAF frame time while panning the camera, which is the
      // interaction the user actually feels. Nudges the view each frame and
      // samples the true frame delta.
      out = { notes, idle, passes, passesSel, sync, hub, instanceCount: r.instanceCount };
    } finally {
      console.table = table; console.log = log;
    }
    return out;
  });

  // TRUE frame timing, measured against the app's own rAF loop with nothing forced.
  // Deliberately does NOT touch needsRedraw: the whole point is to see what the real
  // application does per frame, including whatever player.js's loop marks dirty.
  const sampleFrames = (mode) => page.evaluate(async (m) => {
    const ws = window.__rmtWorkspace;
    const cam = ws && ws.camera;
    const frames = [];
    let renders = 0;

    // Count frames on which the renderer actually did work.
    const r = window.__rmtRenderer;
    const origRender = r._render;
    r._render = function () {
      if (this.needsRedraw) renders++;
      return origRender.call(this);
    };

    await new Promise((resolve) => {
      let i = 0;
      let last = performance.now();
      const step = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (m === 'pan' && cam) {
          // A real pan: move the camera and push the new basis, exactly as dragging
          // the canvas does. This invalidates every view-dependent cache, which is the
          // honest worst case — unlike merely setting needsRedraw.
          cam.tx -= 7;
          if (typeof cam.onChange === 'function') cam.onChange();
        }
        if (++i < 100) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    r._render = origRender;
    const s = frames.slice(15).sort((a, b) => a - b); // drop warm-up frames
    const p = (q) => +s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))].toFixed(2);
    return {
      'p50 (ms)': p(50), 'p95 (ms)': p(95), 'max (ms)': +s[s.length - 1].toFixed(2),
      fps: +(1000 / p(50)).toFixed(1), rendersOf100: renders
    };
  }, mode);

  const live = await sampleFrames('idle');
  const pan = await sampleFrames('pan');

  await ctx.close();
  return { name, ...result, live, pan, errors };
}

function fmt(rows) {
  return Object.entries(rows)
    .map(([k, v]) => `      ${k.padEnd(38)} ${String(v['ms/frame'] ?? v).padStart(8)}`)
    .join('\n');
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    '--use-angle=default',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu'
  ]
});

const all = [];
for (const name of MODULES) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    const r = await benchModule(browser, name);
    all.push(r);
    console.log(`  notes: ${r.notes}  (instances: ${r.instanceCount})`);
    console.log(`  LIVE idle (real app loop):       p50 ${r.live['p50 (ms)']} ms   p95 ${r.live['p95 (ms)']} ms   -> ${r.live.fps} fps   [redrew ${r.live.rendersOf100}/100 frames]`);
    console.log(`  LIVE pan  (camera moving):       p50 ${r.pan['p50 (ms)']} ms   p95 ${r.pan['p95 (ms)']} ms   -> ${r.pan.fps} fps   [redrew ${r.pan.rendersOf100}/100 frames]`);
    console.log(`  sync():                          p50 ${r.sync['p50 (ms)']} ms   p95 ${r.sync['p95 (ms)']} ms`);
    console.log('  full-redraw pass breakdown (no selection):');
    console.log(fmt(r.passes));
    console.log(`  full-redraw pass breakdown (hub note ${r.hub.id} selected, ${r.hub.related} related):`);
    console.log(fmt(r.passesSel));
    if (r.errors.length) console.log(`  !! page errors: ${r.errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    all.push({ name, error: e.message });
  }
}

await browser.close();

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(all, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}
