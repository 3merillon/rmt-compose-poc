#!/usr/bin/env node
/**
 * Drives the real module-library bar and screenshots it in every state that the
 * layout fix has to get right: expanded, one section collapsed, several collapsed
 * (adjacent + non-adjacent), mid-search across categories, after clearing the
 * search, and at the extremes of the library.iconSizePx setting.
 *
 * Also dumps measurements (label vs icon height, rows used, hidden breakers) so the
 * screenshots can be checked against numbers rather than vibes.
 *
 *   npm run dev            # in another terminal
 *   node scripts/perf/shot-library.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/library';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  !! console.error:', m.text()); });

// Fresh library every run: no stored ui-state (collapse state / layout), no module snapshot.
await page.addInitScript(() => {
  try { localStorage.removeItem('rmt:moduleSnapshot:v1'); localStorage.removeItem('ui-state'); } catch {}
});
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(800);

// Expand the bar the way a user does: drag the pull-tab down (it self-clamps to fit).
async function expandBar() {
  const tab = await page.locator('.pull-tab').boundingBox();
  const x = tab.x + tab.width / 2, y = tab.y + tab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 300, { steps: 8 });
  await page.mouse.move(x, y + 700, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

// What the layout actually did — measured, not assumed.
const measure = () => page.evaluate(() => {
  const c = document.querySelector('.icons-container');
  const sections = Array.from(c.querySelectorAll('.library-section'));
  const vis = (el) => el.offsetParent !== null || getComputedStyle(el).display !== 'none';
  const rowsOf = (els) => new Set(els.filter(vis).map((el) => el.offsetTop)).size;
  const label = c.querySelector('.category-label');
  const icon = c.querySelector('.icon:not(.empty-placeholder)');
  const secRows = {};
  sections.filter(vis).forEach((s) => {
    const name = s.querySelector('.category-label-text')?.textContent || '?';
    secRows[name] = { top: s.offsetTop, h: s.offsetHeight, collapsed: s.classList.contains('section-collapsed'), w: Math.round(s.offsetWidth) };
  });
  // Gap above vs below each visible divider — these must match, in both directions.
  const gaps = [];
  const kids = Array.from(c.children).filter(vis);
  kids.forEach((el, i) => {
    if (!el.classList.contains('separator')) return;
    const prev = kids[i - 1], next = kids[i + 1];
    if (!prev || !next) return;
    gaps.push([
      Math.round(el.offsetTop - (prev.offsetTop + prev.offsetHeight)),          // above
      Math.round(next.offsetTop - (el.offsetTop + el.offsetHeight)),            // below
    ]);
  });
  const cs = getComputedStyle(c);
  const del = c.querySelector('.module-delete-btn');
  return {
    labelH: label ? label.offsetHeight : null,
    labelRadius: label ? getComputedStyle(label).borderRadius : null,
    labelFont: label ? getComputedStyle(label).fontSize : null,
    iconH: icon ? icon.offsetHeight : null,
    iconRadius: icon ? getComputedStyle(icon).borderRadius : null,
    deleteBtn: del ? { w: del.offsetWidth, top: getComputedStyle(del).top, right: getComputedStyle(del).right } : null,
    visibleSections: sections.filter(vis).length,
    hiddenSections: sections.filter((s) => !vis(s)).length,
    sectionRows: rowsOf(sections),                                  // distinct offsetTops => rows used
    sectionHeights: [...new Set(sections.filter(vis).map((s) => s.offsetHeight))].sort((a, b) => a - b),
    dividerGaps: gaps,                                             // [[above, below], ...] must all be equal
    containerPad: [cs.paddingTop, cs.paddingBottom],
    visibleSeparators: Array.from(c.querySelectorAll('.separator')).filter(vis).length,
    containerScrollW: c.scrollWidth,
    containerClientW: c.clientWidth,
    searchRowInBar: !!document.querySelector('.second-top-bar > .library-search-row'),
    barH: document.querySelector('.second-top-bar').offsetHeight,
    sections: secRows,
  };
});

async function shoot(name) {
  await page.waitForTimeout(220);
  const buf = await page.locator('.second-top-bar').screenshot();
  writeFileSync(join(OUT, name + '.png'), buf);
  const m = await measure();
  console.log(`\n== ${name}`);
  console.log('   ' + JSON.stringify(m, null, 1).replace(/\n/g, '\n   '));
}

const labels = () => page.locator('.icons-container .category-label');
const clickLabel = async (i) => { await labels().nth(i).click({ position: { x: 6, y: 30 } }); await page.waitForTimeout(150); };
const setIconSize = async (px) => {
  await page.evaluate(async (v) => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    settingsStore.set('library.iconSizePx', v);
  }, px);
  await page.waitForTimeout(300);
  await expandBar(); // content grew/shrank; re-fit
};

// Default height, untouched: must show the search row + the first row of icons.
await shoot('00-default-open');

// Drag the pull-tab all the way up: the bar must close over the search row too.
{
  const tab = await page.locator('.pull-tab').boundingBox();
  const x = tab.x + tab.width / 2, y = tab.y + tab.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y - 400, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => {
    const bar = document.querySelector('.second-top-bar');
    const row = document.querySelector('.library-search-row');
    const tabEl = document.querySelector('.pull-tab');
    // Hit-test, not getBoundingClientRect: a clipped element still reports a box.
    const painted = (el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!hit && (hit === el || el.contains(hit));
    };
    return { barH: bar.offsetHeight, bodyH: bar.querySelector('.library-body').offsetHeight,
             searchVisible: painted(row), pullTabVisible: painted(tabEl) };
  });
  // Viewport clip, not an element shot: a fully closed bar has no box to screenshot.
  writeFileSync(join(OUT, '00b-closed.png'),
    await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 160 } }));
  console.log('closed bar:', JSON.stringify(closed), '(want barH 0, searchVisible false, pullTabVisible true)');
}

await expandBar();
const names = await labels().allTextContents();
console.log('sections:', names.map((s) => s.replace(/[▾▸]/g, '').trim()).join(', '));

await shoot('01-expanded');

// Scroll the library: the search row must not move (it is outside the scroll area).
const beforeScroll = await page.locator('.library-search-row').boundingBox();
await page.evaluate(() => { document.querySelector('.icons-wrapper').scrollTop = 120; });
await page.waitForTimeout(200);
const afterScroll = await page.locator('.library-search-row').boundingBox();
await shoot('01b-scrolled');
console.log('search row y before/after scroll:', beforeScroll.y, afterScroll.y,
  beforeScroll.y === afterScroll.y ? '(fixed)' : '(MOVED!)');
await page.evaluate(() => { document.querySelector('.icons-wrapper').scrollTop = 0; });

// 1 collapsed
await clickLabel(0);
await shoot('02-collapsed-one');

// several collapsed, adjacent (0,1,2) -> should pack onto one row
await clickLabel(1);
await clickLabel(2);
await shoot('03-collapsed-adjacent');

// non-adjacent mix: re-expand #1 so the run is broken (0, [2 expanded], 3...)
await clickLabel(1);
await clickLabel(3);
await shoot('04-collapsed-noncontiguous');

// all collapsed
const n = await labels().count();
for (let i = 0; i < n; i++) {
  const collapsed = await labels().nth(i).evaluate((el) => el.parentNode.classList.contains('section-collapsed'));
  if (!collapsed) await clickLabel(i);
}
await shoot('05-collapsed-all');

// back to all expanded
for (let i = 0; i < n; i++) {
  const collapsed = await labels().nth(i).evaluate((el) => el.parentNode.classList.contains('section-collapsed'));
  if (collapsed) await clickLabel(i);
}
await expandBar();
await shoot('06-reexpanded');

// search: a query that hits several categories. Collapse one first, so we can prove
// the search reveals it and that clearing restores the collapse.
await clickLabel(0);
await page.waitForTimeout(150);
for (const q of ['3', 'maj']) {
  await page.fill('.library-search-input', q);
  await page.waitForTimeout(250);
  await shoot(`07-search-${q}`);
}
await page.fill('.library-search-input', '');
await page.waitForTimeout(250);
await shoot('08-search-cleared');   // section 0 must be collapsed again
await clickLabel(0);                // re-expand for the size sweep

// icon-size sweep: labels must track the icons
for (const px of [32, 96, 56]) {
  await setIconSize(px);
  await shoot(`09-size-${px}`);
  await clickLabel(1);
  await shoot(`10-size-${px}-collapsed`);
  await clickLabel(1);
}

await browser.close();
console.log('\nwrote', OUT);
