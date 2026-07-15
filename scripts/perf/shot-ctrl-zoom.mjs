#!/usr/bin/env node
/**
 * ctrl/⌘ + wheel must never page-zoom the app.
 *   - over the CANVAS  -> drives the app's camera zoom (same as a plain wheel)
 *   - over the UI      -> does nothing at all
 *   - anywhere         -> the browser's page zoom is prevented
 *
 * Page zoom is not directly observable, so we assert the thing that causes it:
 * whether the wheel event's default was prevented (defaultPrevented === true).
 * We also assert plain scrolling still works, which is what a too-broad guard breaks.
 *
 *   npm run dev
 *   node scripts/perf/shot-ctrl-zoom.mjs --url http://localhost:3000
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(800);

// Record whether each wheel event's default got prevented — that IS page zoom, or not.
await page.evaluate(() => {
  window.__wheels = [];
  window.addEventListener('wheel', (e) => {
    window.__wheels.push({
      ctrl: e.ctrlKey,
      prevented: e.defaultPrevented,
      target: (e.target.id || e.target.className || e.target.tagName || '').toString().slice(0, 30),
    });
  }, false);   // bubble phase: runs after the capture guard and after the camera
});

const scale = () => page.evaluate(() => window.__rmtWorkspace.camera.scale);
const wheels = () => page.evaluate(() => { const w = window.__wheels; window.__wheels = []; return w; });

// Open the module library so we have a real scrollable UI surface to test over.
await page.evaluate(() => {
  document.querySelector('.icons-wrapper')?.classList.remove('collapsed');
  document.querySelector('.second-top-bar').style.height = '160px';
});
await page.waitForTimeout(300);

const CANVAS = { x: 800, y: 500 };
const BAR = await page.evaluate(() => {
  const r = document.querySelector('.icons-wrapper').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});

// ── 1. plain wheel over the canvas: app zoom, as always ──────────────────────
{
  const s0 = await scale();
  await page.mouse.move(CANVAS.x, CANVAS.y);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(200);
  const s1 = await scale();
  check('REGRESSION: plain wheel over the canvas still zooms the camera',
    s1 > s0, `scale ${s0.toFixed(3)} -> ${s1.toFixed(3)}`);
  await wheels();
}

// ── 2. CTRL + wheel over the canvas: app zoom, and NO page zoom ──────────────
{
  const s0 = await scale();
  await page.mouse.move(CANVAS.x, CANVAS.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const s1 = await scale();
  const w = await wheels();
  const ctrlWheels = w.filter((e) => e.ctrl);

  check('ctrl + wheel over the canvas ZOOMS THE APP (not the page)',
    s1 > s0, `scale ${s0.toFixed(3)} -> ${s1.toFixed(3)}`);
  check('...and the browser page zoom is prevented',
    ctrlWheels.length > 0 && ctrlWheels.every((e) => e.prevented),
    `${ctrlWheels.length} ctrl-wheel events, all prevented = ${ctrlWheels.every((e) => e.prevented)}`);
}

// ── 3. CTRL + wheel over the UI: nothing happens, and NO page zoom ───────────
{
  const s0 = await scale();
  const scrollBefore = await page.evaluate(() => document.querySelector('.icons-wrapper').scrollTop);
  await page.mouse.move(BAR.x, BAR.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const s1 = await scale();
  const scrollAfter = await page.evaluate(() => document.querySelector('.icons-wrapper').scrollTop);
  const w = await wheels();
  const ctrlWheels = w.filter((e) => e.ctrl);

  check('ctrl + wheel over the UI does NOT zoom the app camera',
    Math.abs(s1 - s0) < 1e-6, `scale ${s0.toFixed(3)} -> ${s1.toFixed(3)}`);
  check('...and the browser page zoom is prevented there too',
    ctrlWheels.length > 0 && ctrlWheels.every((e) => e.prevented),
    `${ctrlWheels.length} ctrl-wheel events over "${ctrlWheels[0]?.target}", all prevented = ${ctrlWheels.every((e) => e.prevented)}`);
  check('...and it does not scroll the module library either (it does NOTHING)',
    scrollAfter === scrollBefore, `scrollTop ${scrollBefore} -> ${scrollAfter}`);
}

// ── 4. plain wheel over the UI still SCROLLS (a too-broad guard kills this) ──
{
  const before = await page.evaluate(() => document.querySelector('.icons-wrapper').scrollTop);
  await page.mouse.move(BAR.x, BAR.y);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.querySelector('.icons-wrapper').scrollTop);
  const w = await wheels();
  check('REGRESSION: a plain wheel over the module library still scrolls it',
    after > before, `scrollTop ${before} -> ${after}`);
  check('...and a plain wheel is never prevented over the UI',
    w.length > 0 && w.every((e) => !e.ctrl && !e.prevented),
    `${w.length} events, none prevented`);
}

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
process.exit(failed.length ? 1 : 0);
