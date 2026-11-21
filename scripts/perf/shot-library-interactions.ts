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
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
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
await page.waitForFunction(() => !!((window.__rmtRenderer?.instanceCount ?? 0) > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(800);

async function expandBar() {
  const tab = (await page.locator('.pull-tab').boundingBox())!;
  const x = tab.x + tab.width / 2, y = tab.y + tab.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + 300, { steps: 6 });
  await page.mouse.move(x, y + 800, { steps: 6 });
  await page.mouse.up(); await page.waitForTimeout(250);
}

// Real HTML5 drag: dragstart on source, dragover+drop on target, dragend.
// (page.mouse cannot drive HTML5 DnD, so the handlers are fed the events directly.)
const drag = async (srcLoc: Locator, tgtLoc: Locator) => {
  const tgt = await tgtLoc.elementHandle();
  await srcLoc.evaluate((src, t) => {
    const dt = new DataTransfer();
    const ev = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    ev(src, 'dragstart'); ev(t!, 'dragover'); ev(t!, 'drop'); ev(src, 'dragend');
  }, tgt);
  await page.waitForTimeout(400);
};
const section = (i: number) => page.locator('.icons-container .library-section').nth(i);
const modIcon = (i: number, j: number) => section(i).locator('.icon:not(.empty-placeholder)').nth(j);
const label = (cat: string|null) => page.locator(`.category-label[data-category="${cat}"]`);

// Structural health of .icons-container: the invariants the reorder/delete code assumes.
const structure = () => page.evaluate(async () => {
  const { isLibraryLayout } = await import('/src/menu/menu-bar.ts');
  const layout: unknown = JSON.parse(localStorage.getItem('ui-state') || 'null');
  const categories = isLibraryLayout(layout) ? layout.categories : undefined;
  const c = document.querySelector<HTMLElement>('.icons-container')!;
  const kids = Array.from(c.children);
  const kind = (el: Element) => el.classList.contains('library-section') ? 'S'
    : el.classList.contains('separator') ? '-' : 'A';
  const sections = kids.filter((el) => el.classList.contains('library-section'));
  return {
    shape: kids.map(kind).join(''),                       // expect (S-)* S - A
    sectionsSeparated: sections.every((s, i) =>
      i === sections.length - 1 || s.nextElementSibling?.classList.contains('separator')),
    dividerAboveActions: kids[kids.length - 2]?.classList.contains('separator') === true,
    everySectionHasLabelAndPlaceholder: sections.every((s) =>
      s.querySelector<HTMLElement>(':scope > .category-label') && s.querySelector<HTMLElement>(':scope > .empty-placeholder')),
    placeholderIsLast: sections.every((s) => s.lastElementChild?.classList.contains('empty-placeholder')),
    labels: sections.map((s) => s.querySelector<HTMLElement>('.category-label-text')?.textContent),
    counts: sections.map((s) => s.querySelectorAll<HTMLElement>(':scope > .icon:not(.empty-placeholder)').length),
    savedOrder: categories?.map((c2) => c2.name),
    savedCollapsed: categories?.map((c2) => !!c2.collapsed),
    savedLabels: categories?.map((c2) => c2.label),
  };
});

const shot = async (name: string) => writeFileSync(join(OUT, name + '.png'), await page.locator('.second-top-bar').screenshot());
const report = async (name: string) => { const s = await structure(); console.log(`\n== ${name}\n   ` + JSON.stringify(s, null, 1).replace(/\n/g, '\n   ')); return s; };

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
  const isCollapsed = await label(cat).evaluate((el) => el.parentElement!.classList.contains('section-collapsed'));
  if (!isCollapsed) await label(cat).click({ position: { x: 6, y: 30 } });
}
await page.waitForTimeout(600); // let the 200ms autosave debounce land
await shot('I5-before-reload');
await report('I-before-reload');

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!((window.__rmtRenderer?.instanceCount ?? 0) > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(1000);
await expandBar();
await shot('I6-after-reload');
const after = await report('J-after-reload');

const packed = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll<HTMLElement>('.library-section.section-collapsed'));
  return { chips: chips.length, rows: new Set(chips.map((c) => c.offsetTop)).size };
});
console.log('\ncollapsed chips after reload:', JSON.stringify(packed), '(2 chips on 1 row = packed)');
console.log('shape ok:', after.sectionsSeparated && after.dividerAboveActions && after.placeholderIsLast);

// An exported v2 layout could carry the score itself, even for a shipped tile.
// Use the released Half cadence with its two silent roots to exercise a real upgrade.
const restored = await page.evaluate(async () => {
  const { menuBar, isLibraryLayout } = await import('/src/menu/menu-bar.ts');
  const { isInputScore } = await import('/src/model-types.ts');
  const oldScore = {
    baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
    notes: [
      ['base.t', '', 'base.f', '150,150,150,0.5'],
      ['[1].t', 'base.d * 2', '[1].f', '128,128,128,0.7'],
      ['[2].t', '[2].d', '(5/4) * [1].f', '0,200,80,0.7'],
      ['[2].t', '[2].d', '(3/4) * [1].f', '220,60,60,0.7'],
      ['[2].t + [2].d', '', '(3/2) * [1].f', '150,150,150,0.5'],
      ['[5].t', 'base.d * 2', '(1/2) * [5].f', '128,128,128,0.7'],
      ['[6].t', '[6].d', '(5/8) * [5].f', '0,200,80,0.7'],
      ['[6].t', '[6].d', '(3/4) * [5].f', '220,60,60,0.7'],
    ].map(([startTime, duration, frequency, color], i) => ({
      id: i + 1, startTime, frequency, color: 'rgba(' + color + ')', ...(duration && { duration })
    })),
  };
  const half = 'progressions/half-cadence.json', major = 'chords/major.json';
  const freshHalf: unknown = await (await fetch('modules/' + half)).json();
  const freshMajor: unknown = await (await fetch('modules/' + major)).json();
  if (!isInputScore(freshHalf) || !isInputScore(freshMajor)) throw Error('Missing library comparison scores');
  const edit = { baseNote: oldScore.baseNote, notes: [{ id: 1, startTime: 'base.t', duration: 'base.d', frequency: '777' }] };
  const entries = [
    { name: 'Half (I–V)', file: half, data: oldScore },
    { name: 'My copied cadence', isUploaded: true, moduleData: oldScore },
    { name: 'My edited cadence', file: half, moduleData: edit },
    { name: 'Major', moduleData: edit },
    { name: 'Major', moduleData: freshMajor },
  ];
  localStorage.setItem('ui-state', JSON.stringify({libraryVersion: 2, categories: [
    { name: 'test-layout', label: 'My tiles', collapsed: true, modules: entries }
  ]}));
  const payloads = [];
  for (let pass = 0; pass < 2; pass++) {
    if (!await menuBar.loadUIStateFromLocalStorage()) throw Error('Saved library failed to reopen');
    const section = document.querySelector('.category-label[data-category="test-layout"]')!.parentElement!;
    const tiles = Array.from(section.querySelectorAll<HTMLElement>('.icon[data-name]'));
    // An ordinary file-backed tile loads its score asynchronously after a reload.
    const deadline = performance.now() + 10000;
    while (tiles.some(tile => !('moduleData' in tile)) && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    payloads.push(tiles.map(tile => {
      const dt = new DataTransfer();
      tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      tile.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      const score: unknown = JSON.parse(dt.getData('application/json'));
      if (!isInputScore(score)) throw Error('Tile did not transfer its score');
      return score.notes;
    }));
    menuBar.saveUIStateToLocalStorage();
  }
  const ui: unknown = JSON.parse(localStorage.getItem('ui-state') || 'null');
  if (!isLibraryLayout(ui)) throw Error('Invalid saved library');
  const layout = ui.categories.find(cat => cat.name === 'test-layout')!;
  return { payloads, expected: [freshHalf.notes, oldScore.notes, edit.notes, edit.notes, freshMajor.notes],
    names: layout.modules?.map(m => m.name), flags: layout.modules?.map(m => [m.isUploaded, !!m.moduleData]),
    label: layout.label, collapsed: layout.collapsed };
});
for (const payload of restored.payloads) assert.deepEqual(payload, restored.expected);
assert.deepEqual(restored.flags, [[false, false], [true, true], [true, true], [true, true], [false, false]]);
assert.deepEqual(restored.names, ['Half (I–V)', 'My copied cadence', 'My edited cadence', 'Major', 'Major']);
assert.equal(restored.label, 'My tiles');
assert.equal(restored.collapsed, true);
console.log('Revised stock, same-name legacy edits and explicit copies survived drag and two UI restores.');

await browser.close();
console.log('\nwrote', OUT);
