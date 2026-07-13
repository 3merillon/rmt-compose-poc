#!/usr/bin/env node
/**
 * Exercises the library bar's interactions against the layout fix, to prove none of
 * them regressed: module reorder, module move across sections, category reorder,
 * module delete, category delete, Add Category, the empty '+' placeholder, and
 * collapse-state persistence across a reload.
 *
 * HTML5 drag/drop can't be driven with page.mouse, so drags are dispatched as real
 * DragEvents with a DataTransfer — the same events the handlers listen for.
 *
 *   node scripts/perf/shot-library-interactions.mjs --url http://localhost:3000
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
page.on('dialog', (d) => d.accept('Test Cat')); // Add Category uses window.prompt

// NOTE: no addInitScript here on purpose — it re-runs on every navigation, so clearing
// 'ui-state' in it would wipe the library layout right before the reload we want to test.
// A fresh context already starts with empty localStorage.
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(800);

async function expandBar() {
  const tab = await page.locator('.pull-tab').boundingBox();
  const x = tab.x + tab.width / 2, y = tab.y + tab.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + 300, { steps: 6 });
  await page.mouse.move(x, y + 800, { steps: 6 });
  await page.mouse.up(); await page.waitForTimeout(250);
}

// Real HTML5 drag: dragstart on source, dragover+drop on target, dragend.
// (page.mouse cannot drive HTML5 DnD, so the handlers are fed the events directly.)
const drag = async (srcLoc, tgtLoc) => {
  const tgt = await tgtLoc.elementHandle();
  await srcLoc.evaluate((src, t) => {
    const dt = new DataTransfer();
    const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    ev(src, 'dragstart'); ev(t, 'dragover'); ev(t, 'drop'); ev(src, 'dragend');
  }, tgt);
  await page.waitForTimeout(400);
};
const section = (i) => page.locator('.icons-container .library-section').nth(i);
const modIcon = (i, j) => section(i).locator('.icon:not(.empty-placeholder)').nth(j);
const label = (cat) => page.locator(`.category-label[data-category="${cat}"]`);

// Structural health of .icons-container: the invariants the reorder/delete code assumes.
const structure = () => page.evaluate(() => {
  const c = document.querySelector('.icons-container');
  const kids = Array.from(c.children);
  const kind = (el) => el.classList.contains('library-section') ? 'S'
    : el.classList.contains('separator') ? '-' : 'A';
  const sections = kids.filter((el) => el.classList.contains('library-section'));
  return {
    shape: kids.map(kind).join(''),                       // expect (S-)* S - A
    sectionsSeparated: sections.every((s, i) =>
      i === sections.length - 1 || s.nextElementSibling?.classList.contains('separator')),
    dividerAboveActions: kids[kids.length - 2]?.classList.contains('separator') === true,
    everySectionHasLabelAndPlaceholder: sections.every((s) =>
      s.querySelector(':scope > .category-label') && s.querySelector(':scope > .empty-placeholder')),
    placeholderIsLast: sections.every((s) => s.lastElementChild?.classList.contains('empty-placeholder')),
    labels: sections.map((s) => s.querySelector('.category-label-text')?.textContent),
    counts: sections.map((s) => s.querySelectorAll(':scope > .icon:not(.empty-placeholder)').length),
    savedOrder: JSON.parse(localStorage.getItem('ui-state') || '{}').categories?.map((c2) => c2.name),
    savedCollapsed: JSON.parse(localStorage.getItem('ui-state') || '{}').categories?.map((c2) => !!c2.collapsed),
    savedLabels: JSON.parse(localStorage.getItem('ui-state') || '{}').categories?.map((c2) => c2.label),
  };
});

const shot = async (name) => writeFileSync(join(OUT, name + '.png'), await page.locator('.second-top-bar').screenshot());
const report = async (name) => { const s = await structure(); console.log(`\n== ${name}\n   ` + JSON.stringify(s, null, 1).replace(/\n/g, '\n   ')); return s; };

await expandBar();
await report('A-baseline');

// --- module reorder within a section (drop INTERVALS icon #3 onto icon #0)
await drag(modIcon(0, 3), modIcon(0, 0));
await report('B-module-reordered');

// --- module moved to another section (drop an INTERVALS icon on CUSTOM's placeholder)
await drag(modIcon(0, 1), section(5).locator('.empty-placeholder'));
await report('C-module-moved-to-custom');

// --- category reorder: drop CHORDS label onto MELODIES label
await drag(label('chords'), label('melodies'));
await shot('I1-category-reordered');
await report('D-category-reordered');

// --- reorder with a collapsed chip involved
await label('intervals').click({ position: { x: 6, y: 30 } });
await page.waitForTimeout(200);
await drag(label('intervals'), label('progressions'));
await shot('I2-collapsed-chip-reordered');
await report('E-collapsed-chip-reordered');

// --- Add Category (window.prompt auto-accepted as "Test Cat")
await page.locator('.icons-container').getByText('Add Category', { exact: true }).click();
await page.waitForTimeout(500);
await expandBar();
await shot('I3-category-added');
await report('F-category-added');

// --- delete a module (× on a CUSTOM icon), confirm modal
await section(5).locator('.icon:not(.empty-placeholder) .module-delete-btn').first().click();
await page.locator('.delete-confirm-modal button').first().click();
await page.waitForTimeout(400);
await report('G-module-deleted');

// --- delete a category (× on the new Test Cat label)
await label('test-cat').locator('.category-delete-btn').click();
await page.locator('.delete-confirm-modal button').first().click();
await page.waitForTimeout(400);
await shot('I4-category-deleted');
await report('H-category-deleted');

// --- collapse two adjacent sections, reload, and check persistence + packing
const names = await page.locator('.icons-container .category-label').evaluateAll((els) => els.map((e) => e.getAttribute('data-category')));
for (const cat of [names[1], names[2]]) {          // collapse, don't toggle
  const isCollapsed = await label(cat).evaluate((el) => el.parentNode.classList.contains('section-collapsed'));
  if (!isCollapsed) await label(cat).click({ position: { x: 6, y: 30 } });
}
await page.waitForTimeout(600); // let the 200ms autosave debounce land
await shot('I5-before-reload');
await report('I-before-reload');

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(1000);
await expandBar();
await shot('I6-after-reload');
const after = await report('J-after-reload');

const packed = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('.library-section.section-collapsed'));
  return { chips: chips.length, rows: new Set(chips.map((c) => c.offsetTop)).size };
});
console.log('\ncollapsed chips after reload:', JSON.stringify(packed), '(2 chips on 1 row = packed)');
console.log('shape ok:', after.sectionsSeparated && after.dividerAboveActions && after.placeholderIsLast);

await browser.close();
console.log('\nwrote', OUT);
