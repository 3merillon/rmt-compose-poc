#!/usr/bin/env node
/**
 * Drags a note that has thousands of direct dependents and samples EVERY frame, so periodic
 * hitches show up instead of being averaged away. Optionally captures a V8 CPU profile of the
 * drag so the spike source is identified rather than guessed.
 *
 * Usage:
 *   node scripts/perf/bench-drag.mjs --module hub-5000 [--profile] [--url ...]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3001');
const MODULE = flag('--module', 'hub-5000');
const PROFILE = argv.includes('--profile');
const STEPS = Number(flag('--steps', 140));

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
const res = await page.request.get(`${URL_BASE}/modules/perf/${MODULE}.json`);
if (!res.ok()) throw new Error(`fetch ${MODULE}: ${res.status()}`);
const body = await res.text();
await page.route('**/modules/defaultModule.json', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body }));

await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 300_000 });
await page.waitForTimeout(2000);

// The hub is note 1. Find its on-screen rect and how many notes depend on it.
const t = await page.evaluate(() => {
  const r = window.__rmtRenderer, P = window.__rmtPerf;
  const mod = P.getModuleRef();
  const deps = (typeof mod.getDependentNotes === 'function') ? (mod.getDependentNotes(1) || []) : [];
  const idx = r._noteIdToIndex.get(1);
  const m = r.matrix, off = r.canvasOffset || { x: 0, y: 0 };
  const o = idx * 4;
  const left = (m[0] * r.posSize[o] + m[3] * r.posSize[o + 1] + m[6]) - off.x;
  const top = (m[1] * r.posSize[o] + m[4] * r.posSize[o + 1] + m[7]) - off.y;
  return {
    n: r.instanceCount, deps: deps.length,
    left, top,
    w: r.posSize[o + 2] * r.xScalePxPerWU, h: r.posSize[o + 3] * r.yScalePxPerWU
  };
});
console.log(`${MODULE}: ${t.n} notes, hub note [1] has ${t.deps} direct dependents`);

const cx = t.left + t.w * 0.5;
const cy = t.top + t.h * 0.5;

await page.mouse.click(cx, cy);
await page.waitForTimeout(600);

// Sample every rAF frame for the duration of the drag.
await page.evaluate(() => {
  window.__f = [];
  let last = performance.now();
  window.__stop = false;
  const step = () => {
    const now = performance.now();
    window.__f.push(now - last);
    last = now;
    if (!window.__stop) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

let cdp = null;
if (PROFILE) {
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
}

await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < STEPS; i++) {
  // Small continuous movements, like a real hand.
  await page.mouse.move(cx + 2 + i * 3, cy + Math.sin(i / 9) * 6);
}
await page.mouse.up();
await page.waitForTimeout(300);
await page.evaluate(() => { window.__stop = true; });

let profile = null;
if (PROFILE) profile = (await cdp.send('Profiler.stop')).profile;

const r = await page.evaluate(() => {
  const f = window.__f.slice(5);
  const s = [...f].sort((a, b) => a - b);
  const p = (q) => +s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))].toFixed(1);
  return {
    frames: f.length,
    p50: p(50), p90: p(90), p99: p(99),
    max: +s[s.length - 1].toFixed(1),
    over33: f.filter((x) => x > 33).length,
    over50: f.filter((x) => x > 50).length,
    worst: [...f].sort((a, b) => b - a).slice(0, 6).map((x) => +x.toFixed(1)),
    // WHERE the slow frames land: a spike only at the start is drag-setup cost (once per
    // gesture); spikes scattered through the drag are steady-state churn or GC.
    slowAt: f.map((x, i) => [i, +x.toFixed(1)]).filter(([, x]) => x > 25)
  };
});

console.log(`  frames ${r.frames}   p50 ${r.p50} ms   p90 ${r.p90} ms   p99 ${r.p99} ms   max ${r.max} ms`);
console.log(`  HITCHES: ${r.over33} frames > 33ms, ${r.over50} frames > 50ms   worst: ${r.worst.join(', ')} ms`);
console.log(`  slow frames (>25ms) at frame#: ${r.slowAt.map(([i, x]) => `${i}(${x}ms)`).join('  ') || 'none'}   [total frames ${r.frames}]`);

if (profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = (profile.samples || []).length;
  for (const id of profile.samples || []) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + 1);
  }
  console.log('\n  drag CPU self-time:');
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, c]) => {
    const pct = c / total * 100;
    if (pct < 0.8) return;
    console.log(`    ${pct.toFixed(1).padStart(5)}%   ${k}`);
  });
}

await browser.close();
