#!/usr/bin/env node
/**
 * Diagnostic: who sets renderer.needsRedraw on an idle canvas?
 * Traps writes to the flag and reports the call sites, so redraw-gating work is
 * aimed at the actual culprits instead of guesses.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3001';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(1500);

const hits = await page.evaluate(async () => {
  const r = window.__rmtRenderer;
  let v = r.needsRedraw;
  const counts = new Map();
  Object.defineProperty(r, 'needsRedraw', {
    configurable: true,
    get() { return v; },
    set(nv) {
      if (nv === true && v === false) {
        const st = (new Error().stack || '').split('\n').slice(2, 5).join(' <- ').replace(/https?:\/\/[^/]+/g, '');
        counts.set(st, (counts.get(st) || 0) + 1);
      }
      v = nv;
    }
  });
  // Sit completely idle for ~100 frames.
  await new Promise((res) => { let i = 0; const s = () => (++i < 100 ? requestAnimationFrame(s) : res()); requestAnimationFrame(s); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
});

console.log('needsRedraw set to true during ~100 IDLE frames:\n');
for (const [stack, n] of hits) console.log(`  ${String(n).padStart(4)}x  ${stack.trim()}`);
if (!hits.length) console.log('  (never — the canvas is properly idle)');
await browser.close();
