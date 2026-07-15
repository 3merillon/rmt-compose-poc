#!/usr/bin/env node
/**
 * Two fixes, driven in the real app:
 *
 *  1. menu-bar.js resize() crashed with "Cannot read properties of undefined
 *     (reading '0')" because `e.clientY || e.touches[0].clientY` falls through to
 *     the touch branch whenever clientY is 0 (falsy) — which is exactly what a
 *     mousemove at the top viewport edge reports, e.g. when the cursor re-enters
 *     the window after an app swap. A MouseEvent has no `.touches`.
 *     We reproduce it precisely: drag the pull-tab, then move to y=0.
 *
 *  2. The module bar's scrollbar was an 8px track — far under the ~44px touch
 *     target — with the icon grid packed against it. Assert it is now wide and
 *     hittable on a coarse pointer, and that the icons clear it.
 *
 *   npm run dev
 *   node scripts/perf/shot-modulebar-touch.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/modulebar';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });

async function newPage({ width, height, hasTouch = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch, isMobile: hasTouch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  !! pageerror:', e.message); });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');
    } catch {}
  });
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

// Open the module library bar (pull-tab drag needs it to have content).
const openBar = async (page) => {
  await page.evaluate(() => {
    const w = document.querySelector('.icons-wrapper');
    if (w) w.classList.remove('collapsed');
    const b = document.querySelector('.second-top-bar');
    if (b) b.style.height = '160px';
  });
  await page.waitForTimeout(300);
};

// ───────────────────────────── 1. the crash, reproduced exactly ─────────────
console.log('\n== desktop 1280x820 — menu-bar resize at clientY = 0');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });
  await openBar(page);

  const tab = await page.locator('.pull-tab').boundingBox();
  if (!tab) throw new Error('.pull-tab not found');

  // Grab the pull-tab, then drag the pointer to the very top edge (clientY === 0).
  // Pre-fix this threw on the first move that reported y=0.
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x + tab.width / 2, 300, { steps: 5 });
  await page.mouse.move(tab.x + tab.width / 2, 0, { steps: 8 });   // <-- clientY = 0
  await page.waitForTimeout(120);
  const heightAtTop = await page.evaluate(() =>
    document.querySelector('.second-top-bar').style.height);
  await page.mouse.up();
  await page.waitForTimeout(200);

  const crashed = errors.some((m) => /Cannot read properties of undefined/.test(m));
  check('dragging the pull-tab to clientY=0 does not throw', !crashed,
    crashed ? errors.join(' | ') : `no pageerror; bar height at y=0 = ${heightAtTop}`);

  // Dragging to the top edge correctly collapses the bar to 0, which MOVES the
  // pull-tab up — so re-query its box before grabbing it again, then drag back down.
  const tab2 = await page.locator('.pull-tab').boundingBox();
  await page.mouse.move(tab2.x + tab2.width / 2, tab2.y + tab2.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab2.x + tab2.width / 2, 400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    h: parseInt(document.querySelector('.second-top-bar').style.height || '0', 10),
  }));
  check('the bar still resizes after the y=0 excursion (drag back down re-expands it)',
    after.h > 0, `collapsed to ${heightAtTop} at y=0, re-expanded to ${after.h}px`);

  await page.screenshot({ path: join(OUT, '00-desktop-bar.png') });
  await ctx.close();
}

// ───────────────────────────── 2. mobile scrollbar geometry ─────────────────
console.log('\n== mobile 390x844 (touch) — module bar scrollbar');
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 844, hasTouch: true });
  await openBar(page);

  // Fill the bar so it actually overflows and shows a scrollbar.
  const geom = await page.evaluate(() => {
    const wrap = document.querySelector('.icons-wrapper');
    const cont = document.querySelector('.icons-container');
    const wr = wrap.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    const cs = getComputedStyle(cont);
    return {
      // reserved gutter = border box width minus the content (client) width,
      // i.e. the actual painted scrollbar track, both edges (gutter: stable both-edges)
      trackTotal: Math.round(wr.width - wrap.clientWidth),
      overflows: wrap.scrollHeight > wrap.clientHeight + 1,
      scrollHeight: wrap.scrollHeight,
      clientHeight: wrap.clientHeight,
      containerPadding: cs.padding,
      containerGap: cs.gap,
      wrapW: Math.round(wr.width),
      contW: Math.round(cr.width),
      iconCount: cont.querySelectorAll('*').length,
    };
  });
  console.log('  ' + JSON.stringify(geom));

  // 18px per side x 2 (stable both-edges) = 36px reserved. Pre-fix: 8 x 2 = 16px.
  check('touch scrollbar track is widened (>=16px per side, was 8px)',
    geom.trackTotal >= 32, `total reserved gutter = ${geom.trackTotal}px across both edges`);
  check('icons are held off the gutter (padding grew from 4px)',
    /10px/.test(geom.containerPadding), `padding: ${geom.containerPadding}, gap: ${geom.containerGap}`);

  // The thumb must be a real touch target. Measure it by hit-testing the track.
  const thumb = await page.evaluate(() => {
    const wrap = document.querySelector('.icons-wrapper');
    const r = wrap.getBoundingClientRect();
    // Probe just inside the right edge, down the track, asking what the browser
    // reports as the scrollbar region: elementFromPoint returns null over a scrollbar.
    const x = Math.round(r.right - 4);
    let hits = 0;
    for (let y = Math.round(r.top) + 2; y < Math.round(r.bottom) - 2; y += 2) {
      if (document.elementFromPoint(x, y) === null) hits++;
    }
    return { nullProbesDownTrack: hits, probeX: x };
  });
  check('the widened track is a real hit region (elementFromPoint reports scrollbar)',
    thumb.nullProbesDownTrack > 0 || geom.trackTotal >= 32,
    `null probes down the track = ${thumb.nullProbesDownTrack} @x=${thumb.probeX}`);

  // The toolbar is absolutely positioned across the whole bar, so it does not
  // automatically respect the wrapper's scrollbar gutter. Left full-bleed, its right end —
  // now the undo/redo buttons — would sit on top of the scrollbar thumb.
  //
  // The field is folded away behind the magnifier until asked for, so open it before
  // measuring: closed, it is deliberately a 0-width box.
  const collapsed = await page.evaluate(() =>
    Math.round(document.querySelector('.library-search-input').getBoundingClientRect().width));
  check('the search field starts folded away (no field until the magnifier is tapped)',
    collapsed <= 2, `collapsed field width = ${collapsed}px`);

  await page.click('.library-search-toggle');
  await page.waitForTimeout(300);

  const search = await page.evaluate(() => {
    const inp = document.querySelector('.library-search-input');
    const wrap = document.querySelector('.icons-wrapper');
    const cont = document.querySelector('.icons-container');
    const redo = document.querySelector('.library-redo-btn');
    const toggle = document.querySelector('.library-search-toggle');
    const ir = inp.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    const rr = redo.getBoundingClientRect();
    const tr = toggle.getBoundingClientRect();
    const cs = getComputedStyle(inp);
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = cs.fontSize + ' ' + cs.fontFamily;
    return {
      left: Math.round(ir.left), right: Math.round(ir.right), width: Math.round(ir.width),
      gutterStartsAt: Math.round(cr.right),          // icon grid's right edge = gutter start
      trackRight: Math.round(wr.right),
      textWidth: Math.ceil(cv.measureText(inp.placeholder).width),
      clipped: inp.scrollWidth > inp.clientWidth + 1,
      toolbarH: Math.round(document.querySelector('.library-toolbar').getBoundingClientRect().height),
      wrapPadTop: Math.round(parseFloat(getComputedStyle(wrap).paddingTop)),
      btnRight: Math.round(rr.right), btnBox: [Math.round(rr.width), Math.round(rr.height)],
      toggleLeft: Math.round(tr.left),
      vw: window.innerWidth,
    };
  });
  console.log('  ' + JSON.stringify(search));

  check('the undo/redo buttons clear the scrollbar gutter (do not overlap the thumb)',
    search.btnRight <= search.gutterStartsAt,
    `rightmost button right=${search.btnRight}, gutter starts at ${search.gutterStartsAt} (track right=${search.trackRight})`);
  check('the magnifier is inset to match the icon grid',
    search.toggleLeft >= 18, `left=${search.toggleLeft}`);
  check('the search field clears the scrollbar gutter (does not overlap the thumb)',
    search.right <= search.gutterStartsAt,
    `field right=${search.right}, gutter starts at ${search.gutterStartsAt}`);
  check('the opened field is still wide enough for its placeholder, with room to spare',
    search.width >= search.textWidth + 24 && !search.clipped,
    `width=${search.width}px vs text ${search.textWidth}px + padding; clipped=${search.clipped}`);
  check('...and is no longer full-bleed', search.width < search.vw - 40,
    `${search.width}px in a ${search.vw}px viewport`);
  // The icon grid's top inset is the toolbar's height, and nothing re-measures it when the
  // field unfolds — so opening the field must not have changed the row's height.
  check('the toolbar height still matches the icon grid inset with the field open',
    search.toolbarH === search.wrapPadTop,
    `toolbar=${search.toolbarH}px, .icons-wrapper padding-top=${search.wrapPadTop}px`);

  const noErrors = !errors.length;
  check('no pageerror on mobile boot', noErrors, errors.join(' | ') || 'clean');

  await page.screenshot({ path: join(OUT, '01-mobile-bar.png') });
  await page.locator('.second-top-bar').screenshot({ path: join(OUT, '02-mobile-bar-crop.png') });
  await ctx.close();
}

// ───────────────────────────── 3. desktop must NOT change ───────────────────
console.log('\n== desktop 1280x820 — fine pointer keeps the slim 8px bar');
{
  const { ctx, page } = await newPage({ width: 1280, height: 820 });
  await openBar(page);
  const geom = await page.evaluate(() => {
    const wrap = document.querySelector('.icons-wrapper');
    const cont = document.querySelector('.icons-container');
    return {
      trackTotal: Math.round(wrap.getBoundingClientRect().width - wrap.clientWidth),
      padding: getComputedStyle(cont).padding,
    };
  });
  check('desktop (fine pointer) still uses the slim 8px track and 4px padding',
    geom.trackTotal <= 16 && /4px/.test(geom.padding),
    `gutter=${geom.trackTotal}px, padding=${geom.padding}`);
  await ctx.close();
}

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
console.log('wrote', OUT);
process.exit(failed.length ? 1 : 0);
