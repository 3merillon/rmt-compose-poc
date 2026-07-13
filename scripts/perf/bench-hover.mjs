#!/usr/bin/env node
/**
 * Drives real mouse movement across the canvas and samples true rAF frame times, so the
 * hover/pick path is measured end-to-end (event handling + picking + redraw), not in isolation.
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3001');
const MODULES = String(flag('--modules', 'voices-5000,voices-100000')).split(',');

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

  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Sweep the cursor across the note rows.
  await page.mouse.move(200, 400);
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(200 + i * 10, 380 + (i % 7) * 12);
  }
  await page.waitForTimeout(200);

  const r = await page.evaluate(() => {
    const f = window.__frames.slice(10).sort((a, b) => a - b);
    const p = (q) => +f[Math.min(f.length - 1, Math.floor((q / 100) * f.length))].toFixed(2);
    return { n: window.__rmtRenderer.instanceCount, p50: p(50), p95: p(95), max: +f[f.length - 1].toFixed(2) };
  });
  console.log(`${MODULE.padEnd(16)} N=${String(r.n).padStart(6)}   hover frames: p50 ${r.p50} ms   p95 ${r.p95} ms   max ${r.max} ms   -> ${(1000 / r.p50).toFixed(0)} fps`);
  await ctx.close();
}

await browser.close();
