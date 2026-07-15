#!/usr/bin/env node
/**
 * Diagnostic: does ONE redraw produce the final image?
 *
 * Redraw gating is only safe if a single _render() after a state change is
 * self-converging. This screenshots the canvas after each of N successive forced
 * redraws (with no state change between them) and reports when the image stops
 * changing. Anything beyond frame 1 is a latent bug that continuous redrawing was
 * hiding: with gating, the user would be left looking at the unconverged frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const MODULE = flag('--module', 'voices-5000');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });

if (MODULE !== 'defaultModule') {
  const res = await page.request.get(`${URL_BASE}/modules/perf/${MODULE}.json`);
  const body = await res.text();
  await page.route('**/modules/defaultModule.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body }));
}

await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 180_000 });
await page.waitForTimeout(2000);

const canvas = page.locator('canvas').first();

async function redrawOnce() {
  await page.evaluate(() => new Promise((res) => {
    window.__rmtRenderer.needsRedraw = true;
    requestAnimationFrame(() => requestAnimationFrame(res));
  }));
}

function countDiff(a, b) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] ||
        A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) n++;
  }
  return n;
}

// Perturb the scene the way a user would (pan), then watch it settle.
await page.evaluate(() => {
  const cam = window.__rmtWorkspace.camera;
  cam.tx -= 250;
  cam.onChange();
});

const shots = [];
for (let i = 0; i < 6; i++) {
  await redrawOnce();
  shots.push(await canvas.screenshot());
}

mkdirSync('scripts/perf/__visual__/converge', { recursive: true });
for (let i = 0; i < 3; i++) writeFileSync(`scripts/perf/__visual__/converge/redraw-${i + 1}.png`, shots[i]);
{
  const A = PNG.sync.read(shots[0]);
  const B = PNG.sync.read(shots[1]);
  const out = new PNG({ width: A.width, height: A.height });
  for (let i = 0; i < A.data.length; i += 4) {
    const same = A.data[i] === B.data[i] && A.data[i + 1] === B.data[i + 1] && A.data[i + 2] === B.data[i + 2];
    if (same) {
      out.data[i] = A.data[i] >> 2; out.data[i + 1] = A.data[i + 1] >> 2;
      out.data[i + 2] = A.data[i + 2] >> 2; out.data[i + 3] = 255;
    } else {
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
    }
  }
  writeFileSync('scripts/perf/__visual__/converge/diff-1-vs-2.png', PNG.sync.write(out));
}

console.log(`module=${MODULE} — pixels changed between successive forced redraws (no state change between them):\n`);
for (let i = 1; i < shots.length; i++) {
  const d = countDiff(shots[i - 1], shots[i]);
  console.log(`  redraw ${i} -> ${i + 1}:  ${d} px ${d === 0 ? '(converged)' : '<-- STILL CHANGING'}`);
}

await browser.close();
