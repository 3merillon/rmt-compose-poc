#!/usr/bin/env node
/**
 * Measures the CPU picking path (pickAt / pickStackAt / hitTestSubRegion), which runs on
 * every pointermove. Reports ms per call so we know whether a spatial index is warranted.
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3001');
const MODULES = String(flag('--modules', 'voices-5000,voices-20000,voices-100000')).split(',');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });

for (const MODULE of MODULES) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
  const res = await page.request.get(`${URL_BASE}/modules/perf/${MODULE}.json`);
  const body = await res.text();
  await page.route('**/modules/defaultModule.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 300_000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const R = window.__rmtRenderer;
    const N = R.instanceCount;
    const ITER = 300;
    // Sample points spread across the canvas, so both hits and misses are exercised.
    const pts = [];
    for (let i = 0; i < ITER; i++) pts.push([100 + (i * 37) % 1400, 150 + (i * 53) % 700]);

    const time = (fn) => {
      for (let i = 0; i < 30; i++) fn(pts[i % pts.length]);   // warm
      const t0 = performance.now();
      for (let i = 0; i < ITER; i++) fn(pts[i]);
      return (performance.now() - t0) / ITER;
    };

    return {
      N,
      pickAt: time(([x, y]) => R.pickAt(x, y)),
      pickStackAt: time(([x, y]) => R.pickStackAt(x, y)),
      hitTestSubRegion: time(([x, y]) => R.hitTestSubRegion(x, y)),
    };
  });

  console.log(`${MODULE.padEnd(16)} N=${String(r.N).padStart(6)}   ` +
    `pickAt ${r.pickAt.toFixed(3)} ms   pickStackAt ${r.pickStackAt.toFixed(3)} ms   hitTestSubRegion ${r.hitTestSubRegion.toFixed(3)} ms`);
  await ctx.close();
}

await browser.close();
