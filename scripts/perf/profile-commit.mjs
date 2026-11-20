#!/usr/bin/env node
/**
 * The cost of one edit (commit) in the running app, and where it goes.
 *
 * Loads a stress module into the app (headless Edge), times
 * window.__rmtPerf.measureCommit() (an octave up, then down, on a mid note:
 * expression rewrite, dirty marking, evaluation, renderer sync, history
 * snapshot and autosave), then takes a V8 CPU profile (CDP Profiler) of more
 * commits and lists functions by self time and by total time.
 *
 * The module is read from public/modules/perf/<name>.json on disk and served
 * in place of the default module, so a server whose checkout lacks the
 * (gitignored) voices-* files can be measured too.
 *
 * Usage:
 *   node scripts/perf/profile-commit.mjs [--url http://localhost:3220] [--module voices-20000]
 *        [--iter 10] [--no-profile] [--json]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3220');
const MODULE = flag('--module', 'voices-20000');
const ITER = Number(flag('--iter', 10));
const PROFILE = !argv.includes('--no-profile');
const JSON_OUT = argv.includes('--json');
const log = JSON_OUT ? () => {} : (...a) => console.log(...a);

const body = readFileSync(join(here, '..', '..', 'public', 'modules', 'perf', `${MODULE}.json`), 'utf8');

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.route('**/modules/defaultModule.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }));

await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtPerf && window.__rmtRenderer?.instanceCount > 0), null, { timeout: 300_000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => window.__rmtPerf.info());

// Warm up (JIT, caches), then time
await page.evaluate(() => window.__rmtPerf.measureCommit(3));
const timed = await page.evaluate((n) => window.__rmtPerf.measureCommit(n), ITER);

let selfRows = [], totalRows = [];
if (PROFILE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100 us
  await cdp.send('Profiler.start');
  const wall = await page.evaluate((n) => {
    const t0 = performance.now();
    window.__rmtPerf.measureCommit(n);
    return performance.now() - t0;
  }, ITER);
  const { profile } = await cdp.send('Profiler.stop');

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const key = (n) => {
    const f = n.callFrame;
    return `${f.functionName || '(anonymous)'}  ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
  };
  const self = new Map(), total = new Map();
  const samples = profile.samples || [];
  // Samples outside the commits (idle, program, GC between) are counted too; the
  // share is of every sample, the ms estimate scales it to the profiled wall time.
  for (const id of samples) {
    const n = byId.get(id);
    if (!n) continue;
    const k = key(n);
    self.set(k, (self.get(k) || 0) + 1);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const kk = key(byId.get(cur));
      if (seen.has(kk)) continue;
      seen.add(kk);
      total.set(kk, (total.get(kk) || 0) + 1);
    }
  }
  const commits = ITER * 2;
  const rows = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c / samples.length >= 0.008)
    .slice(0, 30)
    .map(([name, c]) => ({ pct: +(c / samples.length * 100).toFixed(1), 'ms/commit': +((c / samples.length) * wall / commits).toFixed(2), name }));
  selfRows = rows(self);
  totalRows = rows(total).filter((r) => !/^\((root|program|idle)\)/.test(r.name));
  log(`\nprofiled ${commits} commits, ${samples.length} samples, ${(wall / commits).toFixed(1)} ms/commit under the profiler`);
}

await browser.close();

if (JSON_OUT) {
  console.log(JSON.stringify({ module: MODULE, ...info, commit: timed, self: selfRows, total: totalRows, errors }));
} else {
  console.log(`\n${MODULE} (${info.notes} notes, ${info.evaluator}) — commit p50 ${timed['p50 (ms)']} ms, min ${timed['min (ms)']}, p95 ${timed['p95 (ms)']} (${timed.runs} commits)`);
  if (PROFILE) {
    console.log('\nself time:');
    for (const r of selfRows) console.log(`  ${String(r.pct).padStart(5)}%  ~${r['ms/commit'].toFixed(2).padStart(6)} ms   ${r.name}`);
    console.log('\ntotal time (function and what it calls):');
    for (const r of totalRows) console.log(`  ${String(r.pct).padStart(5)}%  ~${r['ms/commit'].toFixed(2).padStart(6)} ms   ${r.name}`);
  }
  if (errors.length) console.log('\npage errors:', errors.slice(0, 5));
}
