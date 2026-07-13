#!/usr/bin/env node
/**
 * Mobile viewport: does the app lay itself out inside the screen it ACTUALLY has?
 *
 * The app is `overflow: hidden`, so the document never scrolls, so a mobile browser
 * never collapses its URL bar. Two different things went wrong because of that:
 *
 *   A. The screen is genuinely short. A landscape phone leaves ~200px between the
 *      top bar and the bottom edge, and the note-variables widget had a 300px "open
 *      at least this tall" floor that beat its own fit-to-viewport clamp.
 *
 *   B. `100vh` is not the screen. By spec `vh` is the LARGE viewport — the page as
 *      it would be *if* the URL bar collapsed — so the "+" menu's
 *      `max-height: calc(100vh - 100px)` was permanently taller than the phone, and
 *      its footer sat below the fold.
 *
 * Playwright has no URL bar, so (A) and (B) need different setups:
 *
 *   Scenario 1 reproduces (A) directly — a short viewport is a short viewport.
 *   Scenario 2 reproduces (B) by stubbing `innerHeight` / `visualViewport` to be
 *      CHROME_PX shorter than the real window, which is exactly the divergence a URL
 *      bar creates: `vh` still says 390, the usable screen is 294.
 *
 *   npm run dev            # in another terminal
 *   node scripts/perf/shot-mobile-viewport.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/mobile-viewport';
mkdirSync(OUT, { recursive: true });

// What a mobile browser's info bar typically steals.
const CHROME_PX = 96;

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });

async function newPage({ width, height, fakeChrome = 0, touch = true }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  !! console.error:', m.text()); });

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');
    } catch {}
  });

  // Simulate a browser info bar: the window is `height` tall, but only
  // `height - fakeChrome` of it is on screen. That is precisely what a phone's URL
  // bar does — and it leaves `vh` reporting the full, unreachable height.
  if (fakeChrome > 0) {
    await page.addInitScript((chrome) => {
      const realInner = Object.getOwnPropertyDescriptor(window, 'innerHeight')
        || Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        get: () => realInner.get.call(window) - chrome,
      });
      const vv = window.visualViewport;
      if (vv) {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          get: () => ({
            get width() { return vv.width; },
            get height() { return vv.height - chrome; },
            get scale() { return vv.scale; },
            get offsetTop() { return vv.offsetTop; },
            get offsetLeft() { return vv.offsetLeft; },
            addEventListener: vv.addEventListener.bind(vv),
            removeEventListener: vv.removeEventListener.bind(vv),
          }),
        });
      }
    }, fakeChrome);
  }

  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}

const shoot = async (page, name) => {
  await page.waitForTimeout(220);
  writeFileSync(join(OUT, name + '.png'), await page.screenshot());
};

// Every measurement is taken against the USABLE height (what the app can see), never
// against the window — that difference is the whole bug.
const boxOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    h: Math.round(r.height), w: Math.round(r.width),
    maxHeight: cs.maxHeight, display: cs.display,
    usableH: window.innerHeight, usableW: window.innerWidth,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  };
}, selector);

// Open the note-variables widget on a real note, through the exact call a click ends
// in (`modals.showNoteVariables` -> `updateNoteWidgetHeight`). Driving it by synthetic
// click instead makes this a test of the picker and the click-suppression heuristics,
// which is not what is on trial here — the widget's GEOMETRY is.
const openNoteWidget = async (page) => {
  const opened = await page.evaluate(async () => {
    const { getModule } = await import('/src/store/app-state.js');
    const { modals } = await import('/src/modals/index.js');
    const m = getModule();
    if (!m) return 'no module';
    // A real note, not a measure bar (no duration/frequency) and not the base note.
    const note = Object.values(m.notes || {}).find((n) =>
      n && n.id !== 0 && n.variables && n.variables.duration && n.variables.frequency);
    if (!note) return 'no note';
    modals.showNoteVariables(note, document.body);
    return 'ok';
  });
  if (opened !== 'ok') throw new Error(`could not open the note widget: ${opened}`);
  await page.waitForTimeout(400);
  const visible = await page.evaluate(() =>
    document.getElementById('note-widget').classList.contains('visible'));
  if (!visible) throw new Error('showNoteVariables ran but the widget is not visible');
};

// ─────────────────────────────── Scenario 1: a genuinely short landscape screen ────
console.log(`\n== landscape phone, 844x294 (a real phone's usable height in landscape)`);
{
  const { ctx, page } = await newPage({ width: 844, height: 294 });
  const vh = 294;

  // The "+" menu.
  await page.tap('.dropdown-button');
  await page.waitForTimeout(500);
  const menu = await boxOf(page, '#general-widget');
  console.log('  menu ' + JSON.stringify(menu));
  check('landscape: the "+" menu fits on the screen',
    menu.bottom <= vh, `bottom=${menu.bottom} (usable height=${vh}, max-height=${menu.maxHeight})`);
  await shoot(page, '01-landscape-menu');
  await page.tap('.dropdown-button');
  await page.waitForTimeout(400);

  // The note-variables widget — the 300px floor lived here.
  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('landscape: the note-variables widget fits on the screen',
    note.top >= 0 && note.bottom <= vh,
    `top=${note.top} bottom=${note.bottom} height=${note.h} (usable height=${vh})`);
  check('landscape: the note widget clears the top bar',
    note.top >= 50, `top=${note.top}`);
  await shoot(page, '02-landscape-note-widget');

  // The settings panel.
  await page.tap('#settingsGearBtn');
  await page.waitForTimeout(500);
  const set = await boxOf(page, '.rmt-set-panel');
  console.log('  settings ' + JSON.stringify(set));
  check('landscape: the settings panel fits on the screen',
    set.top >= 50 && set.bottom <= vh,
    `top=${set.top} bottom=${set.bottom} height=${set.h} (usable height=${vh})`);
  await shoot(page, '03-landscape-settings');

  // The module-library bar can never be taller than the screen minus the top bar.
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.second-top-bar');
    const r = b.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), h: Math.round(r.height) };
  });
  check('landscape: the module-library bar stays on the screen',
    bar.bottom <= vh, `bottom=${bar.bottom} (usable height=${vh})`);

  await ctx.close();
}

// ────────────── Scenario 2: full-height window, but a URL bar eats the bottom ────
console.log(`\n== portrait 390x844 with a ${CHROME_PX}px info bar (usable ${844 - CHROME_PX}) — the vh trap`);
{
  const { ctx, page } = await newPage({ width: 390, height: 844, fakeChrome: CHROME_PX });
  const usable = 844 - CHROME_PX;

  const wired = await page.evaluate(() => ({
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
    inner: window.innerHeight,
  }));
  check('the app measures the USABLE height, not the window',
    wired.appHeight === `${usable}px` && wired.inner === usable,
    `--app-height=${wired.appHeight}, innerHeight=${wired.inner} (window is 844)`);

  // The heart of it: the "+" menu must be bounded by the usable height, not by 100vh
  // (which still reports the full 844 — that is exactly what a phone does).
  await page.tap('.dropdown-button');
  await page.waitForTimeout(500);
  const menu = await boxOf(page, '#general-widget');
  console.log('  menu ' + JSON.stringify(menu));
  const cap = parseFloat(menu.maxHeight);
  check('the "+" menu is capped by the usable height, not by 100vh',
    cap <= usable - 100 + 1, `max-height=${menu.maxHeight} (usable ${usable} - 100 = ${usable - 100}; the 100vh bug gives ${844 - 100})`);
  check('the "+" menu fits inside the usable screen',
    menu.bottom <= usable, `bottom=${menu.bottom} (usable=${usable})`);
  await shoot(page, '04-urlbar-menu');
  await page.tap('.dropdown-button');
  await page.waitForTimeout(400);

  // The JS clamps must agree with the CSS about where the bottom is.
  //
  // Assert the HEIGHT, not the bottom edge. The note widget is `position: fixed;
  // bottom: 19px`, and a fixed element anchors to the LAYOUT viewport — which a real
  // phone shrinks to the visible area, but which Playwright leaves at the full 844
  // because there is no actual URL bar here. So `bottom` is the one number this
  // simulation cannot reproduce faithfully; scenario 1 covers it for real by using a
  // genuinely short window. Do not "fix" a bottom-edge failure here.
  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('the note widget is sized against the usable screen',
    note.h <= usable - 50 - 19, `height=${note.h} (band below the top bar = ${usable - 50 - 19})`);
  await shoot(page, '05-urlbar-note-widget');

  await ctx.close();
}

// ─────────────────────────────────────────── regression: desktop is untouched ────
console.log('\n== desktop 1280x820 (nothing may move)');
{
  const { ctx, page } = await newPage({ width: 1280, height: 820, touch: false });
  const vh = 820;

  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('desktop: the note widget still opens 300px tall, bottom-left',
    note.h === 300 && note.left === 19 && note.bottom === vh - 19,
    `${note.w}x${note.h} at left=${note.left} bottom=${note.bottom}`);

  await page.click('.dropdown-button');
  await page.waitForTimeout(500);
  const menu = await boxOf(page, '#general-widget');
  check('desktop: the "+" menu is capped at the same 100vh - 100 as before',
    parseFloat(menu.maxHeight) === vh - 100, `max-height=${menu.maxHeight} (expected ${vh - 100}px)`);
  await shoot(page, '06-desktop');

  await ctx.close();
}

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
}
console.log('wrote', OUT);
process.exit(failed.length ? 1 : 0);
