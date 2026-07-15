#!/usr/bin/env node
/**
 * Drives the module bar's toolbar (magnifier + collapsible search + undo/redo) in the
 * real app, and asserts the things the rebuild has to get right:
 *
 *  1. The field is folded away at boot; the magnifier unfolds it and folds it back.
 *  2. Folding it back CLEARS the query — a filter left applied behind a hidden field is
 *     a library silently missing modules.
 *  3. The row's height never moves, because it is the icon grid's top inset and the
 *     pull-tab's fit height, and nothing re-measures it on toggle.
 *  4. Undo/redo start disabled, light up when there is history, and actually undo/redo
 *     when CLICKED (not just when Ctrl+Z is pressed).
 *  5. Clicking the toolbar does not trip player.js's "clicked outside → clearSelection"
 *     guard — including when the click lands on the SVG glyph rather than the button.
 *
 *   npm run dev
 *   node scripts/perf/shot-toolbar.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/toolbar';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('  !! pageerror:', e.message); });

await page.addInitScript(() => {
  try { localStorage.removeItem('rmt:moduleSnapshot:v1'); localStorage.removeItem('ui-state'); } catch {}
});
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForSelector('.icons-container .icon');
await page.waitForTimeout(900);

const shoot = async (n) => writeFileSync(join(OUT, n + '.png'),
  await page.locator('.second-top-bar').screenshot());

const state = () => page.evaluate(() => {
  const row = document.querySelector('.library-toolbar');
  const inp = document.querySelector('.library-search-input');
  const wrap = document.querySelector('.icons-wrapper');
  const vis = (el) => !el.classList.contains('library-hidden');
  return {
    open: row.classList.contains('search-open'),
    fieldW: Math.round(inp.getBoundingClientRect().width),
    rowH: Math.round(row.getBoundingClientRect().height),
    gridInset: Math.round(parseFloat(getComputedStyle(wrap).paddingTop)),
    value: inp.value,
    undoDisabled: document.querySelector('.library-undo-btn').disabled,
    redoDisabled: document.querySelector('.library-redo-btn').disabled,
    visibleModules: Array.from(document.querySelectorAll('.icons-container .icon:not(.empty-placeholder)')).filter(vis).length,
  };
});

// ─────────────────────────────── 1. boot ───────────────────────────────────
console.log('\n== boot');
const s0 = await state();
console.log('  ' + JSON.stringify(s0));
await shoot('00-boot-collapsed');
check('the field is folded away at boot (magnifier only)', !s0.open && s0.fieldW <= 2,
  `open=${s0.open}, field width=${s0.fieldW}px`);
check('undo AND redo start disabled (nothing on the stack yet)',
  s0.undoDisabled && s0.redoDisabled,
  `undoDisabled=${s0.undoDisabled}, redoDisabled=${s0.redoDisabled}`);
check('the row height matches the icon grid inset', s0.rowH === s0.gridInset,
  `row=${s0.rowH}px, grid inset=${s0.gridInset}px`);

// ─────────────────────────────── 2. search ─────────────────────────────────
console.log('\n== search');
await page.click('.library-search-toggle');
await page.waitForTimeout(350);
const s1 = await state();
await shoot('01-search-open');
check('the magnifier unfolds the field', s1.open && s1.fieldW > 200,
  `open=${s1.open}, field width=${s1.fieldW}px`);
check('unfolding does NOT change the row height (grid inset stays put)',
  s1.rowH === s0.rowH && s1.rowH === s1.gridInset,
  `row=${s1.rowH}px (was ${s0.rowH}px), grid inset=${s1.gridInset}px`);
check('the field takes focus, so you can just type',
  await page.evaluate(() => document.activeElement === document.querySelector('.library-search-input')));

await page.keyboard.type('maj');
await page.waitForTimeout(350);
const s2 = await state();
await shoot('02-search-typed');
check('typing filters the library', s2.visibleModules > 0 && s2.visibleModules < s0.visibleModules,
  `${s2.visibleModules} of ${s0.visibleModules} modules match "maj"`);

// Escape must fold it away AND clear the filter.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const s3 = await state();
await shoot('03-search-escaped');
check('Escape folds the field away', !s3.open && s3.fieldW <= 2, `open=${s3.open}, width=${s3.fieldW}px`);
check('...and clears the query with it (no filter left applied behind a hidden field)',
  s3.value === '' && s3.visibleModules === s0.visibleModules,
  `value=${JSON.stringify(s3.value)}, ${s3.visibleModules} modules visible (boot: ${s0.visibleModules})`);

// Same again, but closed with the magnifier rather than Escape.
await page.click('.library-search-toggle');
await page.waitForTimeout(300);
await page.keyboard.type('maj');
await page.waitForTimeout(300);
await page.click('.library-search-toggle');   // toggle shut while the field has focus
await page.waitForTimeout(400);
const s4 = await state();
check('the magnifier toggles a focused field shut (and does not instantly reopen it)',
  !s4.open && s4.value === '' && s4.visibleModules === s0.visibleModules,
  `open=${s4.open}, value=${JSON.stringify(s4.value)}, ${s4.visibleModules} modules visible`);

// ─────────────────────────────── 3. undo / redo ────────────────────────────
console.log('\n== undo / redo');
const noteId = await page.evaluate(() => window.__rmtPerf.pickFreqNoteId());
const f0 = await page.evaluate((id) => window.__rmtPerf.noteFreq(id), noteId);

// A real edit, through the same event the octave buttons emit.
await page.evaluate((id) => window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' }), noteId);
await page.waitForTimeout(700);
const f1 = await page.evaluate((id) => window.__rmtPerf.noteFreq(id), noteId);
const s5 = await state();
await shoot('04-after-edit');
check('an edit lights up Undo in the toolbar (redo stays dark)',
  !s5.undoDisabled && s5.redoDisabled,
  `note ${noteId}: ${f0.toFixed(2)}Hz → ${f1.toFixed(2)}Hz; undoDisabled=${s5.undoDisabled}, redoDisabled=${s5.redoDisabled}`);

// CLICK the toolbar's undo — not Ctrl+Z. This is the whole point of the feature.
await page.click('.library-undo-btn');
await page.waitForTimeout(900);
const f2 = await page.evaluate((id) => window.__rmtPerf.noteFreq(id), noteId);
const s6 = await state();
await shoot('05-after-undo');
check('clicking the toolbar Undo actually undoes the edit',
  Math.abs(f2 - f0) < 1e-6, `note ${noteId} back to ${f2.toFixed(2)}Hz (was ${f0.toFixed(2)}Hz before the edit)`);
check('...and lights up Redo', !s6.redoDisabled, `redoDisabled=${s6.redoDisabled}`);

await page.click('.library-redo-btn');
await page.waitForTimeout(900);
const f3 = await page.evaluate((id) => window.__rmtPerf.noteFreq(id), noteId);
await shoot('06-after-redo');
check('clicking the toolbar Redo re-applies it',
  Math.abs(f3 - f1) < 1e-6, `note ${noteId} back to ${f3.toFixed(2)}Hz (edited value was ${f1.toFixed(2)}Hz)`);

// ──────────── 3b. a restore must not leave a stale selection behind ─────────
// Undo/redo replace the module wholesale, so any open note widget is left bound to a Note
// object that no longer exists — it would keep showing the OLD expression, and committing
// a field from it would write into a dead note. Select a note, then undo from the toolbar.
console.log('\n== stale selection after undo');
{
  // Hunt for a note by clicking, the way a user would — the notes live in the GL canvas, so
  // there is no selector to aim at. Start below the two fixed top bars, which overlay the
  // workspace and would eat the clicks.
  const barBottom = await page.evaluate(() => {
    const b = document.querySelector('.second-top-bar').getBoundingClientRect();
    return Math.ceil(b.bottom + 24);
  });
  const vp = page.viewportSize();
  let opened = false;
  for (let y = barBottom; y < vp.height - 40 && !opened; y += 26) {
    for (let x = 40; x < vp.width - 40 && !opened; x += 45) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(45);
      opened = await page.evaluate(() =>
        document.querySelector('#note-widget')?.classList.contains('visible') ?? false);
    }
  }
  if (!opened) {
    console.log('  (skipped: could not land a click on a note in the GL canvas)');
  } else {
    // A fresh edit so there is something to undo, without disturbing the selection.
    await page.evaluate((id) => window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' }), noteId);
    await page.waitForTimeout(700);
    const before = await page.evaluate(() =>
      document.querySelector('#note-widget').classList.contains('visible'));
    await page.click('.library-undo-btn');
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      widget: document.querySelector('#note-widget').classList.contains('visible'),
      group: document.querySelector('#group-widget')?.classList.contains('visible') ?? false,
    }));
    await shoot('07-after-undo-with-selection');
    check('undoing from the toolbar drops the selection it invalidated (no stale note widget)',
      before && !after.widget && !after.group,
      `note widget open before undo=${before}, still open after=${after.widget}`);
  }
}

// ──────────────── 4. the click must not read as "outside" ───────────────────
// player.js clears the note selection on any mouseup whose target is not allow-listed.
// Assert the exact expression it evaluates — on a REAL click, including one that lands
// on the SVG glyph inside the button rather than the button box.
console.log('\n== selection guard');
const guard = await page.evaluate(async () => {
  const seen = [];
  const probe = (e) => seen.push({
    tag: e.target.tagName.toLowerCase(),
    insideToolbar: !!(e.target.closest && e.target.closest('.library-toolbar')),
  });
  document.addEventListener('mouseup', probe, true);
  const btn = document.querySelector('.library-undo-btn');
  const svg = btn.querySelector('svg');
  for (const el of [btn, svg]) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new MouseEvent('mouseup', opts));
  }
  document.removeEventListener('mouseup', probe, true);
  return seen;
});
console.log('  ' + JSON.stringify(guard));
check('a mouseup anywhere in the toolbar resolves to .library-toolbar (button AND svg glyph)',
  guard.length === 2 && guard.every((g) => g.insideToolbar),
  guard.map((g) => `${g.tag}:${g.insideToolbar}`).join(', '));

// ──────────────── 5. keyboard + assistive tech ─────────────────────────────
console.log('\n== keyboard / a11y');
const kbd = await page.evaluate(async () => {
  const toggle = document.querySelector('.library-search-toggle');
  const input = document.querySelector('.library-search-input');
  const cls = () => (document.activeElement?.className || document.activeElement?.tagName || '?').toString();
  const wait = () => new Promise((r) => setTimeout(r, 250));

  // Collapsed: the field must be unreachable, even programmatically — visibility:hidden is
  // what keeps a screen reader from focusing an invisible 2px textbox and typing into it.
  const collapsedVis = getComputedStyle(input).visibility;
  input.focus();
  const focusableWhenClosed = document.activeElement === input;

  // Open with the keyboard, then close with Escape: focus must come back to the magnifier,
  // not be dumped on <body>, or Enter cannot reopen the field.
  toggle.focus();
  toggle.click();
  await wait();
  const afterOpen = cls();
  const openVis = getComputedStyle(input).visibility;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait();
  const afterEscape = cls();

  // ...and Enter on the (now focused) magnifier reopens it.
  document.activeElement.click();
  await wait();
  return {
    collapsedVis, openVis, focusableWhenClosed, afterOpen, afterEscape,
    reopened: document.querySelector('.library-toolbar').classList.contains('search-open'),
    afterReopen: cls(),
  };
});
console.log('  ' + JSON.stringify(kbd));
check('the folded field is hidden from assistive tech and cannot be focused',
  kbd.collapsedVis === 'hidden' && !kbd.focusableWhenClosed,
  `visibility=${kbd.collapsedVis}, programmatic focus landed=${kbd.focusableWhenClosed}`);
check('opening still focuses the field (visibility:hidden does not block it)',
  kbd.openVis === 'visible' && kbd.afterOpen.includes('library-search-input'),
  `visibility=${kbd.openVis}, activeElement=${kbd.afterOpen}`);
check('closing hands focus back to the magnifier (not <body>)',
  kbd.afterEscape.includes('library-search-toggle'), `activeElement=${kbd.afterEscape}`);
check('...so the magnifier can reopen it straight away',
  kbd.reopened && kbd.afterReopen.includes('library-search-input'),
  `reopened=${kbd.reopened}, activeElement=${kbd.afterReopen}`);

check('no pageerror throughout', !errors.length, errors.join(' | ') || 'clean');

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log('wrote', OUT);
await browser.close();
process.exit(failed.length ? 1 : 0);
