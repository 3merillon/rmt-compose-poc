#!/usr/bin/env node
/**
 * V8 CPU profile of renderer.sync(), aggregated by function self-time.
 * Tells us where the per-edit cost actually is instead of guessing from the source.
 *
 * Usage: node scripts/perf/profile-sync.mjs [--module voices-100000] [--url ...]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const MODULE = flag('--module', 'voices-100000');
const ITER = Number(flag('--iter', 10));

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });

if (MODULE !== 'defaultModule') {
  const res = await page.request.get(`${URL_BASE}/modules/perf/${MODULE}.json`);
  const body = await res.text();
  await page.route('**/modules/defaultModule.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body }));
}

await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 300_000 });
await page.waitForTimeout(2000);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100us

await page.evaluate((n) => {
  const P = window.__rmtPerf, r = window.__rmtRenderer;
  const args = () => ({
    evaluatedNotes: P.getEvaluatedNotesRef(),
    module: P.getModuleRef(),
    xScaleFactor: r.currentXScaleFactor || 1,
    yScaleFactor: r.currentYScaleFactor || 1,
    selectedNoteId: null
  });
  r.sync(args()); // warm
  window.__syncArgs = args;
  window.__syncIter = n;
}, ITER);

await cdp.send('Profiler.start');
const ms = await page.evaluate(() => {
  const r = window.__rmtRenderer;
  const t0 = performance.now();
  for (let i = 0; i < window.__syncIter; i++) r.sync(window.__syncArgs());
  return (performance.now() - t0) / window.__syncIter;
});
const { profile } = await cdp.send('Profiler.stop');

// Aggregate self time per function.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = (profile.samples || []).length;
for (const id of profile.samples || []) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const name = `${f.functionName || '(anonymous)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) || 0) + 1);
}

console.log(`\n${MODULE} — sync() = ${ms.toFixed(1)} ms/call  (${ITER} calls, ${total} samples)\n`);
console.log('self time (share of sync-dominated profile):');
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([name, c]) => {
  const pct = (c / total * 100);
  const est = (pct / 100) * ms;
  if (pct < 0.6) return;
  console.log(`  ${pct.toFixed(1).padStart(5)}%  ~${est.toFixed(1).padStart(6)} ms   ${name}`);
});

await browser.close();
