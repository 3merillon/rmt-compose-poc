#!/usr/bin/env node
/**
 * Renders the same scene at several note heights so the vertical centring can be
 * checked by eye: every note's centre must stay on its frequency line (the dashed
 * octave guides / BaseNote line) regardless of how thin or thick notes are.
 *
 * Usage: node scripts/perf/shot-heights.mjs [--url http://localhost:3001]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3001');
const HEIGHTS = String(flag('--heights', '8,22,44')).split(',').map(Number);
const OUT = 'scripts/perf/__visual__/heights';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtPerf && window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(1200);

for (const h of HEIGHTS) {
  await page.evaluate((height) => {
    const r = window.__rmtRenderer;
    const P = window.__rmtPerf;
    r.setConfig({ note: { heightWU: height } });
    r.sync({
      evaluatedNotes: P.getEvaluatedNotesRef(),
      module: P.getModuleRef(),
      xScaleFactor: r.currentXScaleFactor || 1.0,
      yScaleFactor: r.currentYScaleFactor || 1.0,
      selectedNoteId: null
    });
    r.needsRedraw = true;
  }, h);
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  await page.waitForTimeout(300);
  const buf = await page.locator('canvas').first().screenshot();
  const f = join(OUT, `height-${h}.png`);
  writeFileSync(f, buf);
  console.log(`wrote ${f}`);
}

await browser.close();
