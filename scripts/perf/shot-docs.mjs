#!/usr/bin/env node
/**
 * Captures the screenshots embedded in the RMT Compose documentation.
 *
 * These are DOCS images, not regression shots: every frame is driven through the
 * real UI (real clicks on the GL canvas, the real settings gear, the real theme
 * dropdown, a real marquee drag), then cropped to the thing being documented so
 * it is legible at the size a doc page renders it — a full-viewport PNG of mostly
 * empty canvas teaches nobody anything.
 *
 * Everything here reuses the conventions of its sibling shot-* scripts: --url,
 * headless chromium, pageerror/console.error logging, and a deterministic boot
 * (addInitScript wipes the module snapshot, the ui-state and the settings, so the
 * default module and the factory theme are what gets photographed).
 *
 *   npm run dev                    # in another terminal
 *   node scripts/perf/shot-docs.mjs --url http://localhost:3005
 *
 * Writes to docs/public/img/.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3005');
const OUT = flag('--out', 'docs/public/img');
mkdirSync(OUT, { recursive: true });

// Desktop docs viewport. Shot at deviceScaleFactor 2, so a full-page frame lands at
// 2880x1800 — retina-crisp without being a 4K screenshot of nothing.
const VW = 1440, VH = 900;

const written = [];
const problems = [];
const consoleErrors = new Set();

const browser = await chromium.launch({ headless: true });

async function newPage({ width = VW, height = VH, hasTouch = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch,
    isMobile: hasTouch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror: ${e.message}`); console.log('  !! pageerror:', e.message); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    console.log('  !! console.error:', t);
    // Headless Chromium refuses the screen wake lock; that one is the harness, not the app.
    if (!/wake lock/i.test(t)) consoleErrors.add(t);
  });

  // Factory boot: the default module, the default library layout, the default theme.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');
    } catch {}
  });

  // ?perf=1 only exposes window.__rmtWorkspace / __rmtRenderer (see player.js). It
  // changes nothing that is drawn, so the shots are of the real app.
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForSelector('.icons-container .icon');
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
  return { ctx, page };
}

// Two rAFs plus a beat: the GL canvas is drawn on a frame loop, so a screenshot taken
// on the same tick as a state change catches the frame BEFORE it.
const settle = async (page, ms = 600) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
};

async function save(page, name, { selector, clip, pad = 0 } = {}) {
  await settle(page, 350);
  let buf;
  try {
    if (selector) {
      buf = await page.locator(selector).screenshot();
    } else if (clip) {
      const c = {
        x: Math.max(0, Math.round(clip.x - pad)),
        y: Math.max(0, Math.round(clip.y - pad)),
        width: Math.round(clip.width + pad * 2),
        height: Math.round(clip.height + pad * 2),
      };
      const vp = page.viewportSize();
      c.width = Math.min(c.width, vp.width - c.x);
      c.height = Math.min(c.height, vp.height - c.y);
      buf = await page.screenshot({ clip: c });
    } else {
      buf = await page.screenshot();
    }
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    console.log(`  XX ${name} — ${e.message}`);
    return false;
  }
  writeFileSync(join(OUT, name), buf);
  const kb = Math.round(statSync(join(OUT, name)).size / 1024);
  written.push({ name, kb });
  console.log(`  -> ${name}  (${kb} KB)`);
  return true;
}

// ── canvas helpers ─────────────────────────────────────────────────────────────

// Points that actually land on a note, found with the SAME picker the app's click
// handler uses (hardcoded screen coords land in empty world space).
const findNotePoints = (page, wanted = 3, fromY = 150) => page.evaluate(({ wanted, fromY }) => {
  const W = window.__rmtWorkspace;
  const seen = new Map();
  for (let y = fromY; y < window.innerHeight - 40 && seen.size < wanted; y += 7) {
    for (let x = 40; x < window.innerWidth - 40 && seen.size < wanted; x += 7) {
      const hit = W.pickAt(x, y, 2);
      if (hit && hit.type === 'note' && hit.id != null && !seen.has(hit.id)) {
        seen.set(hit.id, { x, y, id: Number(hit.id) });
      }
    }
  }
  return [...seen.values()];
}, { wanted, fromY });

// Select a note the way a user does: hover (warms the GPU pick path), then click.
const clickNote = async (page, pt) => {
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(150);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(450);
};

const screenOfNote = (page, id) => page.evaluate((id) => {
  const R = window.__rmtRenderer;
  const idx = R._noteIdToIndex?.get(Number(id));
  if (idx == null) return null;
  const o = idx * 4;
  const cx = R.posSize[o] + R.posSize[o + 2] * 0.5;
  const cy = R.posSize[o + 1] + R.posSize[o + 3] * 0.5;
  const m = R.matrix;
  return { x: m[0] * cx + m[3] * cy + m[6], y: m[1] * cx + m[4] * cy + m[7] };
}, id);

// The note's whole SCREEN RECT, not just its centre. A note bar is long; a crop built
// from centres alone slices the selected note in half at the frame edge.
const boxOfNote = (page, id) => page.evaluate((id) => {
  const R = window.__rmtRenderer;
  const idx = R._noteIdToIndex?.get(Number(id));
  if (idx == null) return null;
  const o = idx * 4;
  const x = R.posSize[o], y = R.posSize[o + 1], w = R.posSize[o + 2], h = R.posSize[o + 3];
  const m = R.matrix;
  const ax = m[0] * x + m[3] * y + m[6], ay = m[1] * x + m[4] * y + m[7];
  const bx = m[0] * (x + w) + m[3] * (y + h) + m[6], by = m[1] * (x + w) + m[4] * (y + h) + m[7];
  return { left: Math.min(ax, bx), right: Math.max(ax, bx), top: Math.min(ay, by), bottom: Math.max(ay, by) };
}, id);

// Notes ranked by how rich a dependency fan they would draw: how many of the three
// coloured properties (frequency / startTime / duration) reference something else,
// and how many distinct notes they reach. Returned as a ranked list, because the
// best candidate is not necessarily the one the PICKER resolves at its own centre —
// notes overlap, and a click lands on whatever is on top.
const rankedDependents = (page) => page.evaluate(() => {
  const mod = window.__rmtWorkspace._module;
  const R = window.__rmtRenderer;
  const onScreen = new Set(Array.from(R._instanceNoteIds || []).map(Number));
  const out = [];
  for (const key of Object.keys(mod.notes)) {
    const n = mod.getNoteById(Number(key));
    if (!n || n.id === 0 || !onScreen.has(Number(n.id))) continue;
    const v = n.variables || {};
    if (!v.duration || !v.frequency) continue;             // measure bar / silence
    const refs = new Set();                                // referenced NOTE ids
    let colored = 0;                                       // properties that reference anything
    for (const p of ['frequencyString', 'startTimeString', 'durationString']) {
      const raw = String(v[p] || '');
      const ids = [...raw.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      const usesBase = /\bbase\b/.test(raw);
      if (ids.length || usesBase) colored++;
      ids.forEach((i) => refs.add(i));
    }
    // A note that references OTHER NOTES draws lines that end somewhere you can see;
    // a note that only references `base` draws lines that run off to the origin. Both
    // are property-coloured, but the first makes the better picture — hence the weight.
    out.push({ id: Number(n.id), score: colored * 10 + refs.size * 4, colored, refs: [...refs] });
  }
  return out.sort((a, b) => b.score - a.score);
});

// The first candidate the app's OWN picker resolves at its own centre. Without this the
// script clicks note 21's centre and selects note 27 — because 27 is drawn on top of it —
// and then photographs a different note's dependencies than the one it chose.
const pickableCandidate = async (page, candidates, minY = 150) => {
  const vp = page.viewportSize();
  for (const c of candidates) {
    const p = await screenOfNote(page, c.id);
    if (!p || p.x < 30 || p.x > vp.width - 30 || p.y < minY || p.y > vp.height - 30) continue;
    const hit = await page.evaluate(({ x, y }) => {
      const h = window.__rmtWorkspace.pickAt(x, y, 2);
      return h && h.type === 'note' ? Number(h.id) : null;
    }, p);
    if (hit === c.id) return { ...c, pt: p };
  }
  return null;
};

// What the renderer ACTUALLY drew for the current selection. Note the three separate
// buckets: a note can depend on other notes (_relDepsIdx), on the base note
// (_relDepsHasBaseByProperty — the scalar _relDepsHasBase is NOT the same thing and is
// false even when per-property base links exist), and on a measure bar
// (_relDepsMeasureIds). A shot with none of the three is a picture of a note with no lines.
const depState = (page) => page.evaluate(() => {
  const R = window.__rmtRenderer;
  const byProp = R._relDepsIdxByProperty || {};
  const baseByProp = R._relDepsHasBaseByProperty || {};
  const n = (k) => (byProp[k] || []).length + (baseByProp[k] ? 1 : 0);
  return {
    selected: R._lastSelectedNoteId,
    noteDeps: (R._relDepsIdx || []).length,
    measureDeps: (R._relDepsMeasureIds || []).length,
    frequency: n('frequency'), startTime: n('startTime'), duration: n('duration'),
    coloursDrawn: ['frequency', 'startTime', 'duration'].filter((k) => n(k) > 0).length,
  };
});

// Pan/zoom the camera so a note sits at a given screen point, at a given zoom.
// The pan step is PROBED rather than assumed: the renderer's matrix composes the
// camera with the x/y scale factors and a y-flip, so "tx += 10" is not necessarily
// "10px right".
const focusNote = async (page, id, { scale = 3, sx = VW / 2, sy = VH / 2 } = {}) => {
  await page.evaluate((s) => { const c = window.__rmtWorkspace.camera; c.scale = s; c.onChange(); }, scale);
  await settle(page, 250);
  for (let i = 0; i < 4; i++) {
    const p = await screenOfNote(page, id);
    if (!p) return false;
    if (Math.abs(p.x - sx) < 2 && Math.abs(p.y - sy) < 2) break;
    const step = await page.evaluate(({ id, dx, dy }) => {
      const R = window.__rmtRenderer, c = window.__rmtWorkspace.camera;
      const at = () => {
        const idx = R._noteIdToIndex.get(Number(id)), o = idx * 4;
        const cx = R.posSize[o] + R.posSize[o + 2] * 0.5, cy = R.posSize[o + 1] + R.posSize[o + 3] * 0.5;
        const m = R.matrix;
        return { x: m[0] * cx + m[3] * cy + m[6], y: m[1] * cx + m[4] * cy + m[7] };
      };
      const p0 = at();
      c.tx += 10; c.ty += 10; c.onChange();
      const p1 = at();
      c.tx -= 10; c.ty -= 10; c.onChange();
      const kx = (p1.x - p0.x) / 10 || 1, ky = (p1.y - p0.y) / 10 || 1;
      c.tx += dx / kx; c.ty += dy / ky; c.onChange();
      return { kx, ky };
    }, { id, dx: sx - p.x, dy: sy - p.y });
    if (!step) return false;
    await settle(page, 200);
  }
  return true;
};

const closeSettings = async (page) => {
  const open = await page.evaluate(() =>
    !!document.querySelector('.rmt-set-panel')?.classList.contains('rmt-set-open'));
  if (open) { await page.click('.rmt-set-close'); await page.waitForTimeout(400); }
};

const closeNoteWidget = async (page) => {
  await page.evaluate(() => document.querySelector('.note-widget-close')?.click());
  await page.waitForTimeout(300);
};

// Park the note widget in a corner, by its header, exactly as a user would. Closing it
// instead would risk dropping the selection — and the selection is the whole point of the
// dependency-line shot. The widget opens bottom-LEFT, straight over the notes we want to
// photograph, so it has to be moved rather than merely tolerated.
const parkNoteWidget = async (page, x, y) => {
  const h = await page.locator('.note-widget-header').boundingBox();
  if (!h) return;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

// Drag the library bar open by its pull-tab, exactly as shot-library.mjs does.
const expandBar = async (page) => {
  const tab = await page.locator('.pull-tab').boundingBox();
  if (!tab) return;
  const x = tab.x + tab.width / 2, y = tab.y + tab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 300, { steps: 8 });
  await page.mouse.move(x, y + 700, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

// ══════════════════════════════════════════════════ workspace + chrome ═══════
console.log('\n== workspace, top bar, module bar, note widget');
{
  const { ctx, page } = await newPage();

  // --- the hero: default module, a note selected, its dependency lines drawn.
  const pts = await findNotePoints(page, 6);
  if (!pts.length) throw new Error('no note reachable on the default camera');
  const hero = await pickableCandidate(page, await rankedDependents(page));
  const heroPt = hero?.pt ?? pts[0];
  console.log(`  hero note ${hero ? `${hero.id} (${hero.colored} coloured properties, refs ${hero.refs.join(',')})` : `fallback ${pts[0].id}`}`);
  await clickNote(page, heroPt);
  const selected = await depState(page);
  const widgetUp = await page.evaluate(() =>
    document.getElementById('note-widget').classList.contains('visible'));
  console.log('  selection: ' + JSON.stringify(selected) + ` widget=${widgetUp}`);
  if (selected.selected == null) problems.push('workspace-overview: no note ended up selected');
  if (!selected.coloursDrawn) {
    problems.push(`workspace-overview: the selected note draws no dependency lines (${JSON.stringify(selected)})`);
  }
  await save(page, 'workspace-overview.png');

  // --- top bar, cropped to itself
  await save(page, 'top-bar.png', { selector: '.top-bar' });
  await closeNoteWidget(page);

  // --- module bar: pull it fully open so the sections and the toolbar are all in frame.
  await expandBar(page);
  const barState = await page.evaluate(() => ({
    sections: document.querySelectorAll('.icons-container .library-section').length,
    icons: document.querySelectorAll('.icons-container .icon:not(.empty-placeholder)').length,
    toolbarInBar: !!document.querySelector('.second-top-bar .library-toolbar'),
    magnifier: !!document.querySelector('.library-search-toggle'),
    undoRedo: !!document.querySelector('.library-undo-btn') && !!document.querySelector('.library-redo-btn'),
    // Exactly one of the drop-mode pair must be lit — it is a radio pair, and the docs
    // describe the active-mode fill.
    dropModeLit: document.querySelectorAll('.library-drop-btn.active').length === 1,
    barH: document.querySelector('.second-top-bar').offsetHeight,
  }));
  console.log('  module bar ' + JSON.stringify(barState));
  if (!barState.toolbarInBar || !barState.magnifier || !barState.undoRedo || !barState.dropModeLit) {
    problems.push('module-bar: the magnifier / drop-mode / undo / redo toolbar is not in .second-top-bar');
  }
  await save(page, 'module-bar.png', { selector: '.second-top-bar' });

  // --- close crop of the icons themselves, so the procedural captions are readable.
  const iconBox = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.icons-container .library-section:first-child .icon:not(.empty-placeholder)')]
      .filter((el) => el.offsetParent !== null)
      .slice(0, 5);
    if (!icons.length) return null;
    const label = document.querySelector('.icons-container .library-section:first-child .category-label');
    const boxes = [label, ...icons].filter(Boolean).map((el) => el.getBoundingClientRect());
    return {
      x: Math.min(...boxes.map((b) => b.left)),
      y: Math.min(...boxes.map((b) => b.top)),
      width: Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left)),
      height: Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top)),
      n: icons.length,
    };
  });
  if (!iconBox) {
    problems.push('module-library-icons: no visible icons in the first library section');
  } else {
    console.log('  icon crop ' + JSON.stringify(iconBox));
    await save(page, 'module-library-icons.png', { clip: iconBox, pad: 14 });
  }

  await ctx.close();
}

// ════════════════════════════════════════════════════════ note widget ═══════
// Its own, TALLER context on purpose. Undragged, the widget is a 300px card that
// scrolls; dragged, it fits its content but is still clamped to the viewport — and on
// a 900px-tall screen the full content (three expression fields, their evaluated
// readouts, the octave arrows and the Add Note / Silence section) does not fit, so the
// Add section stays below the fold. A tall viewport is the only honest way to get the
// whole widget in one frame rather than photographing a clipped one.
console.log('\n== note widget (tall viewport so nothing is below the fold)');
{
  const { ctx, page } = await newPage({ width: 1100, height: 1400 });

  const pts = await findNotePoints(page, 6);
  const cand = await pickableCandidate(page, await rankedDependents(page));
  const pt = cand?.pt ?? pts[0];
  if (!pt) throw new Error('no note to open the widget on');
  await clickNote(page, pt);

  // Drag it by the header: that writes an inline top and switches the widget out of
  // 300px-card mode into fit-content mode (see shot-settings.mjs).
  await parkNoteWidget(page, 90, 60);                   // clamps to top = 50 + 19

  // ...and even in fit-content mode the widget is still clamped to the viewport, so on any
  // ordinary screen the Add Note / Silence section stays below the fold. MEASURE what the
  // content needs and give the viewport that much, rather than photographing a clipped
  // widget and calling it a picture of the whole widget.
  const need = await page.evaluate(() => {
    const w = document.getElementById('note-widget');
    const c = w.querySelector('.note-widget-content');
    const chrome = w.getBoundingClientRect().height - c.getBoundingClientRect().height;
    return Math.ceil(chrome + c.scrollHeight + 70 /* top bar + clamp */ + 40 /* slack */);
  });
  const vp = page.viewportSize();
  if (need > vp.height) {
    console.log(`  content needs ${need}px — growing the viewport from ${vp.height}px`);
    await page.setViewportSize({ width: vp.width, height: Math.min(3000, need) });
    await page.waitForTimeout(400);
    await parkNoteWidget(page, 90, 60);                 // re-fit at the new height
  }

  const fit = await page.evaluate(() => {
    const w = document.getElementById('note-widget');
    const c = w.querySelector('.note-widget-content');
    const add = c.querySelector('.add-note-section');
    return {
      title: document.getElementById('note-widget-title').textContent,
      h: Math.round(w.getBoundingClientRect().height),
      scrolls: c.scrollHeight > c.clientHeight + 1,
      hasAddSection: !!add,
      // is the Add section actually inside the painted box?
      addVisible: !!add && add.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom + 1,
      fields: c.querySelectorAll('input[type=text], .variable-row').length,
    };
  });
  console.log('  ' + JSON.stringify(fit));
  if (!fit.hasAddSection) problems.push('note-widget: no .add-note-section in the widget');
  if (fit.scrolls || !fit.addVisible) {
    problems.push(`note-widget: the Add Note / Silence section is still below the fold (h=${fit.h}, scrolls=${fit.scrolls})`);
  }
  await save(page, 'note-widget.png', { selector: '#note-widget' });

  await ctx.close();
}

// ══════════════════════════════════════════════════════ settings tabs ════════
console.log('\n== settings panel, every tab');
{
  const { ctx, page } = await newPage();
  await page.click('#settingsGearBtn');
  await page.waitForTimeout(600);

  const open = await page.evaluate(() =>
    !!document.querySelector('.rmt-set-panel')?.classList.contains('rmt-set-open'));
  if (!open) throw new Error('the settings gear did not open the panel');

  for (const tab of ['appearance', 'arrows', 'audio', 'library', 'scale']) {
    await page.click(`.rmt-set-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    const active = await page.evaluate(() => document.querySelector('.rmt-set-tab.active')?.dataset.tab);
    if (active !== tab) { problems.push(`settings-${tab}: tab did not activate (active=${active})`); continue; }
    // Un-hover, so the frame shows the tab at rest rather than mid-hover-glow.
    await page.mouse.move(VW - 30, VH - 30);
    await page.waitForTimeout(200);
    await save(page, `settings-${tab}.png`, { selector: '.rmt-set-panel' });
  }

  await ctx.close();
}

// ═════════════════════════════════════════════════════════════ themes ════════
// Driven through the REAL Appearance-tab preset dropdown, then the panel is closed —
// a theme shot has to show the workspace the theme repainted, not the panel that set it.
console.log('\n== themes (via the Appearance preset dropdown)');
{
  const { ctx, page } = await newPage();

  const pts = await findNotePoints(page, 4);
  const cand = await pickableCandidate(page, await rankedDependents(page));
  if (cand || pts[0]) await clickNote(page, cand?.pt ?? pts[0]);

  // The theme change MUST be delivered while the <select> holds focus.
  //
  // settings-panel.js's change handler writes `appearance.overrides` FIRST, which notifies
  // the store, which runs syncControls(), which re-seeds every control that is not the
  // activeElement — this select included. Its re-seeder is
  // `presetSel.value = get('appearance.themeId')`, i.e. the OLD theme. Only on the NEXT
  // line does the handler read `presetSel.value` to write the new themeId. So if the change
  // event ever arrives at an unfocused select, the re-seed overwrites the user's choice a
  // microtask before it is read, and the theme silently reverts. A human is safe (changing
  // a select focuses it); anything programmatic is not — Playwright's own selectOption()
  // does not survive it either. Focus explicitly, then dispatch.
  const setTheme = async (themeId) => {
    await page.click('#settingsGearBtn');
    await page.waitForTimeout(450);
    await page.click('.rmt-set-tab[data-tab="appearance"]');
    await page.waitForTimeout(250);
    const res = await page.evaluate((v) => {
      const sel = document.querySelector('.rmt-set-tabpanel select.rmt-set-select');
      if (!sel) return 'no preset select in the Appearance tab';
      if (![...sel.options].some((o) => o.value === v)) return `no "${v}" option in the dropdown`;
      sel.focus();
      if (document.activeElement !== sel) return 'the select refused focus';
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }, themeId);
    if (res !== 'ok') return res;
    await page.waitForTimeout(500);
    await closeSettings(page);
    await settle(page, 800);           // let the repaint land
    return page.evaluate(async () => {
      const { settingsStore } = await import('/src/settings/settings-store.js');
      return settingsStore.get('appearance.themeId');
    });
  };

  for (const themeId of ['classic-orange', 'slate-cyan', 'mono-light', 'high-contrast']) {
    const applied = await setTheme(themeId);
    if (applied !== themeId) {
      problems.push(`theme-${themeId}: dropdown did not apply it (store says "${applied}")`);
      console.log(`  XX ${themeId}: store says "${applied}"`);
      continue;
    }
    console.log(`  theme ${themeId} applied`);
    await save(page, `theme-${themeId}.png`);
  }

  await ctx.close();
}

// ═════════════════════════════════════════ multi-select + dependency lines ═══
console.log('\n== marquee / group selection, and the property-coloured dependency lines');
{
  const { ctx, page } = await newPage();

  // --- the marquee. Box derived from the renderer's own buffers (a plausible-looking
  // hardcoded rectangle lands in empty world space); the drag must START on background
  // or the gesture becomes a note drag.
  const box = await page.evaluate(() => {
    const R = window.__rmtRenderer, W = window.__rmtWorkspace, m = R.matrix;
    const on = [];
    for (let i = 0; i < R.instanceCount; i++) {
      const o = i * 4;
      const x = R.posSize[o], y = R.posSize[o + 1], w = R.posSize[o + 2], h = R.posSize[o + 3];
      const ax = m[0] * x + m[3] * y + m[6], ay = m[1] * x + m[4] * y + m[7];
      const bx = m[0] * (x + w) + m[3] * (y + h) + m[6], by = m[1] * (x + w) + m[4] * (y + h) + m[7];
      const L = Math.min(ax, bx), Rr = Math.max(ax, bx), T = Math.min(ay, by), B = Math.max(ay, by);
      if (Rr < 10 || L > innerWidth - 10 || B < 140 || T > innerHeight - 10) continue;
      on.push({ id: Number(R._instanceNoteIds[i]), L, R: Rr, T, B });
    }
    if (on.length < 3) return null;
    on.sort((a, b) => a.L - b.L);
    const take = on.slice(0, Math.min(7, on.length));
    const L = Math.min(...take.map((s) => s.L)), Rr = Math.max(...take.map((s) => s.R));
    const T = Math.min(...take.map((s) => s.T)), B = Math.max(...take.map((s) => s.B));
    let x0 = L - 26, y0 = T - 26;
    for (let k = 0; k < 40 && W.pickAt(x0, y0, 3); k++) { x0 -= 6; y0 -= 6; }
    return { x0: Math.max(8, x0), y0: Math.max(145, y0), x1: Math.min(innerWidth - 8, Rr + 26),
             y1: Math.min(innerHeight - 8, B + 26) };
  });
  if (!box) {
    problems.push('multi-select-marquee: fewer than 3 notes on screen to marquee');
  } else {
    console.log('  marquee ' + JSON.stringify(box));
    await page.mouse.move(box.x0, box.y0);
    await page.waitForTimeout(120);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 10 });
    await page.mouse.move(box.x1 - 6, box.y1 - 6, { steps: 10 });
    await page.waitForTimeout(250);
    const live = await page.evaluate(() => !!window.__rmtRenderer._marqueeRect);
    // Mid-drag: the rubber band is on screen. This IS the gesture, so shoot it here.
    if (!live) problems.push('multi-select-marquee: no live _marqueeRect mid-drag');
    await save(page, 'multi-select-marquee.png');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page, 500);

    const sel = await page.evaluate(() =>
      (window.__rmtRenderer.getMultiSelection?.() || []).length);
    const groupWidget = await page.evaluate(() =>
      !!document.getElementById('group-widget')?.classList.contains('visible'));
    console.log(`  marquee committed: ${sel} notes selected, group widget=${groupWidget}`);
    if (sel < 2) problems.push(`multi-select-marquee: the marquee only caught ${sel} note(s)`);
  }

  await ctx.close();
}

{
  const { ctx, page } = await newPage();

  // --- dependency lines, zoomed until the property colours are readable.
  //
  // The pick matters. In the default module almost every note anchors its frequency and
  // duration to `base` — those lines run all the way back to the origin, so a zoomed crop
  // shows three coloured lines LEAVING the note and no endpoints. The interesting notes
  // (31, 38, 39, 41, 44 …) anchor frequency to ANOTHER NOTE ([9].f), startTime to their
  // predecessor and duration to a measure bar: three colours, three endpoints, all local.
  // rankedDependents weights note-refs for exactly that reason; take the best one whose
  // three properties are all anchored.
  const ranked0 = await rankedDependents(page);
  const target = ranked0.find((c) => c.colored === 3 && c.refs.length >= 2)
              || ranked0.find((c) => c.colored >= 2)
              || ranked0[0];
  if (!target) {
    problems.push('dependency-lines: no on-screen note with references to photograph');
  } else {
    const CX = VW * 0.42, CY = VH * 0.44;
    await focusNote(page, target.id, { scale: 1.7, sx: CX, sy: CY });
    let cand = await pickableCandidate(page, [target, ...(await rankedDependents(page))]);
    if (cand && cand.id !== target.id) {
      // The picker resolved a different note at the centre (notes overlap). Re-aim the
      // camera at the one we are actually going to click, or the crop frames the wrong note.
      await focusNote(page, cand.id, { scale: 1.7, sx: CX, sy: CY });
      cand = { ...cand, pt: await screenOfNote(page, cand.id) };
    }
    if (!cand) {
      problems.push('dependency-lines: no note the picker resolves at its own centre after zooming');
    } else {
      console.log(`  dep note ${cand.id}: ${cand.colored} coloured properties, refs [${cand.refs.join(', ')}]`);
      await clickNote(page, cand.pt);
      const drawn = await depState(page);
      console.log('  drawn ' + JSON.stringify(drawn));
      if (drawn.coloursDrawn < 2) {
        problems.push(`dependency-lines: only ${drawn.coloursDrawn} property colour(s) drawn (${JSON.stringify(drawn)})`);
      }
      // The widget opens bottom-left, directly on top of the lines. Park it out of frame.
      await parkNoteWidget(page, VW - 210, VH - 120);

      // Crop to the WHOLE selected note plus the anchors its lines actually end on, so the
      // frame contains the endpoints rather than three colours vanishing off the edge — and
      // so the selected bar itself is not sliced in half at the frame boundary.
      const boxes = [await boxOfNote(page, cand.id)];
      for (const r of cand.refs) {
        const rb = await boxOfNote(page, r);
        if (rb) boxes.push(rb);
      }
      const vp = page.viewportSize();
      const inside = boxes.filter((b) => b && b.right > -60 && b.left < vp.width + 60);
      const x0 = Math.min(...inside.map((b) => b.left)), x1 = Math.max(...inside.map((b) => b.right));
      const y0 = Math.min(...inside.map((b) => b.top)), y1 = Math.max(...inside.map((b) => b.bottom));
      console.log(`  anchors span x ${Math.round(x0)}..${Math.round(x1)}, y ${Math.round(y0)}..${Math.round(y1)}`);
      const clip = {
        x: Math.max(0, x0 - 60),
        y: Math.max(145, y0 - 130),
        width: (x1 - x0) + 120,
        height: Math.max(360, (y1 - y0) + 260),
      };
      // Never let the parked widget creep back into the frame.
      const w = await page.locator('#note-widget').boundingBox();
      if (w && clip.x + clip.width > w.x - 12) clip.width = Math.max(320, w.x - 12 - clip.x);
      await save(page, 'dependency-lines.png', { clip });
    }
  }

  await ctx.close();
}

// ══════════════════════════════════════════════════════ scale controls ══════
console.log('\n== scale controls widget (bottom-left), expanded');
{
  const { ctx, page } = await newPage();
  await page.click('#scale-controls-toggle');
  await settle(page, 500);

  const shown = await page.evaluate(() => {
    const c = document.getElementById('scale-controls');
    const t = document.getElementById('scale-controls-toggle');
    if (!c || !t) return null;
    const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
    return {
      visible: c.classList.contains('visible'),
      x: Math.min(a.left, b.left), y: Math.min(a.top, b.top),
      width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
      height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top),
      sliders: c.querySelectorAll('input[type=range]').length,
    };
  });
  console.log('  ' + JSON.stringify(shown));
  if (!shown?.visible) {
    problems.push('scale-controls: the toggle did not expand #scale-controls');
  } else {
    // Padded, not hairline-cropped: the widget is two bare sliders and a toggle, and a
    // shot of just those reads as nothing. The pad keeps the bottom-left corner of the
    // workspace in frame, which is what tells a reader WHERE the thing lives.
    await save(page, 'scale-controls.png', { clip: shown, pad: 70 });
  }
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════ mobile ════════
console.log('\n== mobile 390x844 (touch)');
{
  const { ctx, page } = await newPage({ width: 390, height: 844, hasTouch: true });
  await settle(page, 700);
  const fits = await page.evaluate(() => ({
    barOverflows: document.querySelector('.top-bar').scrollWidth > document.querySelector('.top-bar').clientWidth,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  }));
  console.log('  ' + JSON.stringify(fits));
  if (fits.barOverflows) problems.push('mobile-layout: the top bar overflows at 390px');
  await save(page, 'mobile-layout.png');
  await ctx.close();
}

await browser.close();

// ─────────────────────────────────────────────────────────────── report ──────
const EXPECTED = [
  'workspace-overview.png', 'top-bar.png', 'module-bar.png', 'note-widget.png',
  'settings-appearance.png', 'settings-arrows.png', 'settings-audio.png',
  'settings-library.png', 'settings-scale.png',
  'theme-classic-orange.png', 'theme-slate-cyan.png', 'theme-mono-light.png',
  'theme-high-contrast.png', 'multi-select-marquee.png', 'dependency-lines.png',
  'module-library-icons.png', 'scale-controls.png', 'mobile-layout.png',
];

console.log(`\n${written.length}/${EXPECTED.length} shots written to ${OUT}`);
const missing = EXPECTED.filter((n) => !written.some((w) => w.name === n));
const thin = written.filter((w) => w.kb < 15);
if (missing.length) console.log('MISSING:\n  - ' + missing.join('\n  - '));
if (thin.length) console.log('SUSPICIOUSLY SMALL (<15 KB):\n  - ' + thin.map((t) => `${t.name} (${t.kb} KB)`).join('\n  - '));
if (consoleErrors.size) console.log('CONSOLE ERRORS:\n  - ' + [...consoleErrors].join('\n  - '));
if (problems.length) console.log('PROBLEMS:\n  - ' + problems.join('\n  - '));
process.exit(missing.length ? 1 : 0);
