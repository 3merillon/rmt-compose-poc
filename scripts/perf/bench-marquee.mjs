#!/usr/bin/env node
/**
 * Marquee hit-testing runs on EVERY pointermove. pickRect is a linear scan over the
 * instance buffers, so measure it where it hurts: 5k and 20k notes.
 *
 *   node scripts/perf/bench-marquee.mjs --url http://localhost:3000
 */
import { chromium } from 'playwright';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');

const browser = await chromium.launch({ headless: true });
const rows = [];

for (const mod of ['voices-5000', 'voices-20000']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  // player.js boots from `Module.loadFromJSON(savedSnapshot || 'modules/defaultModule.json')`,
  // and savedSnapshot is this localStorage key — that is the only hook for loading a
  // specific module at boot. (There is no ?module= query param; assuming one silently
  // benchmarks the 161-note default instead, which is how you get suspiciously good numbers.)
  const json = await (await fetch(`${URL_BASE}/modules/perf/${mod}.json`)).text();
  await page.addInitScript((snap) => {
    try { localStorage.clear(); localStorage.setItem('rmt:moduleSnapshot:v1', snap); } catch {}
  }, json);
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 240_000 });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const R = window.__rmtRenderer;
    const N = R.instanceCount;
    // A rect covering the whole viewport = the worst case (every instance must be tested
    // AND every hit collected).
    const big = [0, 0, innerWidth, innerHeight];
    const t = (fn, iters) => {
      for (let i = 0; i < 20; i++) fn();              // warm
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) fn();
      return (performance.now() - t0) / iters;
    };
    const full = t(() => R.pickRect(big[0], big[1], big[2], big[3]), 200);
    const hits = R.pickRect(big[0], big[1], big[2], big[3]).length;
    const small = t(() => R.pickRect(300, 300, 500, 450), 200);
    const setSel = t(() => R.setMultiSelection(R.pickRect(big[0], big[1], big[2], big[3]).map(h => h.id)), 50);
    return { N, instanceCount: R.instanceCount, fullMs: full, hits, smallMs: small, setSelMs: setSel };
  });
  rows.push({ mod, ...r });
  console.log(`${mod.padEnd(14)} N=${String(r.N).padStart(6)}  pickRect(full viewport)=${r.fullMs.toFixed(3)}ms (${r.hits} hits)  pickRect(small)=${r.smallMs.toFixed(3)}ms  pickRect+setMultiSelection=${r.setSelMs.toFixed(3)}ms`);
  await ctx.close();
}
await browser.close();

// A pointermove budget at 60fps is 16.7ms for EVERYTHING. Marquee picking should be a
// rounding error against that.
const worst = Math.max(...rows.map((r) => r.setSelMs));
console.log(`\nworst pickRect+setMultiSelection = ${worst.toFixed(3)}ms  (60fps frame budget = 16.67ms)`);
process.exit(worst < 8 ? 0 : 1);
