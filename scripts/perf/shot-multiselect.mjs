#!/usr/bin/env node
/**
 * Drives the real app to prove multi-note selection: marquee, shift-click refine,
 * the white group highlight, the group widget, group drag, and the touch flow.
 *
 * The screenshots are the easy half. The half a screenshot CANNOT confirm is the
 * dependency algebra, so this asserts it NUMERICALLY against the real module:
 *
 *   TEST 1  A <- B <- C chain, select {A,B}, drag by D.
 *           A, B and C must ALL land at +D, and B's and C's expressions must be
 *           byte-for-byte UNCHANGED (they ride for free; rewriting them would
 *           destroy the authored relative structure).
 *
 *   TEST 2  THE DOUBLE-MOVE TRAP.  A <- X <- M, where A and M are selected but X
 *           is NOT. M's DIRECT anchor (X) is outside the selection, so the naive
 *           rule ("apply the delta wherever the direct anchor is outside") moves M.
 *           But X already follows A. M must land at exactly +D, never +2D.
 *
 *   npm run dev
 *   node scripts/perf/shot-multiselect.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/multiselect';
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
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    console.log('  !! console.error:', t);
    // The wake-lock denial is a headless-Chromium artifact, not ours. Everything else
    // counts — including "Unable to preventDefault inside passive event listener",
    // which is a real bug that only ever surfaces as a console message.
    if (!/wake lock/i.test(t)) errors.push(t);
  });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');
    } catch {}
  });
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

const shoot = async (page, name) => {
  await page.waitForTimeout(250);
  writeFileSync(join(OUT, name + '.png'), await page.screenshot());
};

// Warm the pick path the way a user does (hover first), then act.
const warm = async (page, x, y) => { await page.mouse.move(x, y); await page.waitForTimeout(120); };

// Screen point for a note id, from the SAME buffers the picker uses.
const pointOfNote = (page, id) => page.evaluate((id) => {
  const R = window.__rmtRenderer;
  const idx = R._noteIdToIndex?.get(Number(id));
  if (idx == null) return null;
  const o = idx * 4;
  const cx = R.posSize[o + 0] + R.posSize[o + 2] * 0.5;
  const cy = R.posSize[o + 1] + R.posSize[o + 3] * 0.5;
  const m = R.matrix;
  return { x: m[0] * cx + m[3] * cy + m[6], y: m[1] * cx + m[4] * cy + m[7] };
}, id);

const selection = (page) => page.evaluate(() => (window.__rmtRenderer.getMultiSelection?.() || []).slice().sort((a, b) => a - b));

const starts = (page, ids) => page.evaluate((ids) => {
  const mod = window.__rmtWorkspace._module;
  const out = {};
  for (const id of ids) {
    const n = mod.getNoteById(Number(id));
    out[id] = n ? {
      t: Number(n.getVariable('startTime').valueOf()),
      raw: n.variables.startTimeString || ''
    } : null;
  }
  return out;
}, ids);

// Walk startTime parents out of the real module, to find genuine dependency chains.
const findChains = (page) => page.evaluate(() => {
  const mod = window.__rmtWorkspace._module;
  const parentOf = (n) => {
    const raw = (n.variables && n.variables.startTimeString) || '';
    const m = raw.match(/\[(\d+)\]\./) || raw.match(/\b(?:beat|tempo|measure)\s*\(\s*\[(\d+)\]\s*\)/);
    if (m) return Number(m[1]);
    if (/\bbase\./.test(raw) || /\b(?:beat|tempo|measure)\s*\(\s*base\s*\)/.test(raw)) return 0;
    return null;
  };
  const isMeasure = (n) => !!(n.variables?.startTime && !n.variables?.duration && !n.variables?.frequency);

  const ids = Object.keys(mod.notes).map(Number).filter((i) => i !== 0);
  const P = new Map();
  for (const id of ids) {
    const n = mod.getNoteById(id);
    if (!n || isMeasure(n)) continue;
    P.set(id, parentOf(n));
  }
  // Find C with parent B with parent A, all real (non-measure, non-base) notes.
  const chains = [];
  for (const c of P.keys()) {
    const b = P.get(c);
    if (!b || !P.has(b)) continue;
    const a = P.get(b);
    if (!a || !P.has(a)) continue;
    chains.push({ a, b, c });
  }
  return chains.slice(0, 12);
});

const emit = (page, ev, payload) => page.evaluate(async ({ ev, payload }) => {
  const { eventBus } = await import('/src/utils/event-bus.js');
  eventBus.emit(ev, payload);
}, { ev, payload });

const undoDepth = (page) => page.evaluate(async () => {
  const { history } = await import('/src/store/history.js');
  return history.size().undo;
});

// ═══════════════════════════════════════════ THE DEPENDENCY MATH ════════════
console.log('\n== dependency algebra (the part a screenshot cannot confirm)');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  const chains = await findChains(page);
  if (!chains.length) throw new Error('no A<-B<-C chain found in the default module');
  const { a: A, b: B, c: C } = chains[0];
  console.log(`  chain: ${A} <- ${B} <- ${C}   (B anchored to A, C anchored to B)`);

  // ---------- TEST 1: select {A, B}, drag by D. A, B and C must all move by D.
  const D = 0.75;
  const before = await starts(page, [A, B, C]);
  console.log('  before ' + JSON.stringify(before));

  await emit(page, 'workspace:marqueeCommit', { ids: [A, B], additive: false });
  await page.waitForTimeout(200);
  check('selection is exactly {A, B}',
    JSON.stringify(await selection(page)) === JSON.stringify([A, B].sort((x, y) => x - y)),
    JSON.stringify(await selection(page)));

  const u0 = await undoDepth(page);
  await emit(page, 'workspace:groupMoveCommit', { ids: [A, B], deltaSec: D });
  await page.waitForTimeout(500);
  const after = await starts(page, [A, B, C]);
  const u1 = await undoDepth(page);
  console.log('  after  ' + JSON.stringify(after));

  const moved = (id) => after[id].t - before[id].t;
  const near = (v, target, eps = 1e-3) => Math.abs(v - target) < eps;

  check(`A (the mover) moved by exactly D=${D}`, near(moved(A), D), `ΔA = ${moved(A).toFixed(6)}`);
  check(`B (a RIDER: anchored to selected A) moved by exactly D — not 0, not 2D`,
    near(moved(B), D), `ΔB = ${moved(B).toFixed(6)}`);
  check(`C (outside the selection, anchored to B) FOLLOWED by exactly D`,
    near(moved(C), D), `ΔC = ${moved(C).toFixed(6)}`);

  check("B's startTime expression was NOT rewritten (it rides for free)",
    after[B].raw === before[B].raw, `"${before[B].raw}" -> "${after[B].raw}"`);
  check("C's startTime expression was NOT rewritten (nothing outside the selection is touched)",
    after[C].raw === before[C].raw, `"${before[C].raw}" -> "${after[C].raw}"`);
  check("A's startTime expression WAS re-anchored (it is the mover)",
    after[A].raw !== before[A].raw, `"${before[A].raw}" -> "${after[A].raw}"`);

  check('the whole group move is ONE undo entry', u1 - u0 === 1, `undo depth ${u0} -> ${u1}`);

  // ---------- TEST 2: THE DOUBLE-MOVE TRAP.  select {A, C} but NOT B.
  // C's direct anchor is B, which is OUTSIDE the selection — but B follows A.
  // The naive "direct anchor outside => apply delta" rule moves C twice.
  const D2 = 0.5;
  const before2 = await starts(page, [A, B, C]);
  await emit(page, 'workspace:marqueeCommit', { ids: [A, C], additive: false });
  await page.waitForTimeout(200);
  await emit(page, 'workspace:groupMoveCommit', { ids: [A, C], deltaSec: D2 });
  await page.waitForTimeout(500);
  const after2 = await starts(page, [A, B, C]);
  const moved2 = (id) => after2[id].t - before2[id].t;
  console.log(`  trap: ΔA=${moved2(A).toFixed(4)} ΔB=${moved2(B).toFixed(4)} ΔC=${moved2(C).toFixed(4)} (D=${D2}, 2D=${2 * D2})`);

  check(`DOUBLE-MOVE TRAP: C moved by exactly D=${D2}, NOT 2D=${2 * D2}`,
    near(moved2(C), D2), `ΔC = ${moved2(C).toFixed(6)}  (2D would be ${(2 * D2).toFixed(6)})`);
  check("DOUBLE-MOVE TRAP: C's expression untouched (it is a transitive rider)",
    after2[C].raw === before2[C].raw, `"${after2[C].raw}"`);
  check(`trap: A and the un-selected in-between B both moved by D=${D2}`,
    near(moved2(A), D2) && near(moved2(B), D2),
    `ΔA=${moved2(A).toFixed(6)} ΔB=${moved2(B).toFixed(6)}`);

  check('no pageerror during the algebra', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═══════════════════════════════════════════ THE REAL GESTURES ══════════════
console.log('\n== desktop 1280x820 — marquee, shift-click, widget, group drag');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  // Derive a marquee box that actually covers notes, from the renderer's own buffers.
  // (Hardcoding screen coords is a trap: most of the module sits off-screen, so a
  // plausible-looking rectangle can easily land in empty world space.)
  const box = await page.evaluate(() => {
    const R = window.__rmtRenderer, W = window.__rmtWorkspace;
    const m = R.matrix;
    const onScreen = [];
    for (let i = 0; i < R.instanceCount; i++) {
      const o = i * 4;
      const x = R.posSize[o], y = R.posSize[o + 1], w = R.posSize[o + 2], h = R.posSize[o + 3];
      const ax = m[0] * x + m[3] * y + m[6], ay = m[1] * x + m[4] * y + m[7];
      const bx = m[0] * (x + w) + m[3] * (y + h) + m[6], by = m[1] * (x + w) + m[4] * (y + h) + m[7];
      const L = Math.min(ax, bx), Rr = Math.max(ax, bx);
      const T = Math.min(ay, by), B = Math.max(ay, by);
      if (Rr < 10 || L > innerWidth - 10 || B < 70 || T > innerHeight - 10) continue;
      onScreen.push({ id: R._instanceNoteIds[i], L, R: Rr, T, B });
    }
    if (onScreen.length < 3) return null;
    onScreen.sort((a, b) => a.L - b.L);
    const take = onScreen.slice(0, Math.min(6, onScreen.length));
    const L = Math.min(...take.map((s) => s.L)), Rr = Math.max(...take.map((s) => s.R));
    const T = Math.min(...take.map((s) => s.T)), B = Math.max(...take.map((s) => s.B));

    // The drag must START on empty background or the gesture becomes a note drag.
    // Walk the top-left corner outwards until the picker says nothing is there.
    let x0 = L - 24, y0 = T - 24;
    for (let k = 0; k < 40 && W.pickAt(x0, y0, 3); k++) { x0 -= 6; y0 -= 6; }
    return { x0: Math.max(6, x0), y0: Math.max(70, y0), x1: Rr + 24, y1: B + 24,
             expect: take.map((s) => s.id) };
  });
  if (!box) throw new Error('no on-screen notes to marquee');
  console.log('  marquee box ' + JSON.stringify(box));

  // --- marquee mid-drag
  await warm(page, box.x0, box.y0);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 10 });
  await page.waitForTimeout(200);
  await shoot(page, '00-marquee-mid-drag');
  const midRect = await page.evaluate(() => !!window.__rmtRenderer._marqueeRect);
  check('the rubber-band rectangle is live mid-drag', midRect);

  await page.mouse.move(box.x1, box.y1, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  const sel1 = await selection(page);
  check('marquee selected notes', sel1.length > 1, `${sel1.length} notes: [${sel1.slice(0, 10).join(', ')}]`);
  const rectGone = await page.evaluate(() => !window.__rmtRenderer._marqueeRect);
  check('the rectangle is taken down on release', rectGone);
  await shoot(page, '01-marquee-result-white-highlight');

  // --- the marquee's own trailing click must not wipe what it just selected
  check('the marquee survives its own trailing click (suppression window works)',
    (await selection(page)).length === sel1.length, `${(await selection(page)).length} still selected`);

  // --- group widget
  const widget = await page.evaluate(() => {
    const w = document.getElementById('group-widget');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return {
      visible: w.classList.contains('visible'),
      parentIsBody: w.parentElement === document.body,
      insideWorkspace: !!w.closest('.myspaceapp'),
      text: (w.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      z: getComputedStyle(w).zIndex,
      box: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
  console.log('  widget ' + JSON.stringify(widget));
  check('the group widget opened', !!widget?.visible);
  check('the group widget is a BODY-level sibling of .myspaceapp (or the workspace click handler eats it)',
    widget?.parentIsBody && !widget?.insideWorkspace);
  check('the widget shows the live count', new RegExp(`\\b${sel1.length}\\b`).test(widget?.text || ''), widget?.text);
  await shoot(page, '02-group-widget');

  // --- clicking inside the widget must NOT clear the selection
  await page.click('#group-widget .group-widget-header');
  await page.waitForTimeout(250);
  check('clicking the widget does NOT wipe the selection (allowlists)',
    (await selection(page)).length === sel1.length,
    `${(await selection(page)).length}/${sel1.length} still selected`);

  // --- shift-click REMOVES a selected note
  const victim = sel1[0];
  const p = await pointOfNote(page, victim);
  await warm(page, p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const sel2 = await selection(page);
  check(`shift-click REMOVED note ${victim} from the group`,
    !sel2.includes(victim) && sel2.length === sel1.length - 1,
    `${sel1.length} -> ${sel2.length}`);
  await shoot(page, '03-shift-click-removed');

  // --- shift-click ADDS it back
  await warm(page, p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const sel3 = await selection(page);
  check(`shift-click ADDED note ${victim} back`,
    sel3.includes(victim) && sel3.length === sel1.length, `${sel2.length} -> ${sel3.length}`);
  await shoot(page, '04-shift-click-added-back');

  // --- GROUP DRAG: grab a selected note, drag, and prove every selected note moved
  const dragId = sel3[Math.floor(sel3.length / 2)];
  const dp = await pointOfNote(page, dragId);
  const beforeDrag = await starts(page, sel3);
  const uBefore = await undoDepth(page);

  await warm(page, dp.x, dp.y);
  await page.mouse.move(dp.x, dp.y);
  await page.mouse.down();
  await page.mouse.move(dp.x + 90, dp.y, { steps: 12 });
  await page.waitForTimeout(250);
  await shoot(page, '05-group-mid-drag');
  const dragging = await page.evaluate(() => !!window.__rmtRenderer._dragActive);
  check('group drag previews (drag is active in the renderer)', dragging);

  await page.mouse.up();
  await page.waitForTimeout(600);
  await shoot(page, '06-group-after-drop');

  const afterDrag = await starts(page, sel3);
  const deltas = sel3.map((id) => afterDrag[id].t - beforeDrag[id].t);
  const d0 = deltas[0];
  const allSame = deltas.every((d) => Math.abs(d - d0) < 1e-3);
  check('group drag moved EVERY selected note by the SAME delta',
    allSame && Math.abs(d0) > 1e-3,
    `delta=${d0.toFixed(4)}s, spread=${(Math.max(...deltas) - Math.min(...deltas)).toFixed(6)}`);
  check('the group drag is ONE undo entry',
    (await undoDepth(page)) - uBefore === 1, `undo ${uBefore} -> ${await undoDepth(page)}`);

  // --- plain click clears everything
  await warm(page, 900, 700);
  await page.mouse.click(900, 700);
  await page.waitForTimeout(350);
  const cleared = await selection(page);
  const widgetGone = await page.evaluate(() =>
    !document.getElementById('group-widget')?.classList.contains('visible'));
  check('a plain click clears the group', cleared.length === 0, `${cleared.length} left`);
  check('...and closes the group widget', widgetGone);
  await shoot(page, '07-plain-click-cleared');

  // --- REGRESSION: single-note select + move still work
  const solo = await pointOfNote(page, sel1[1]);
  await warm(page, solo.x, solo.y);
  await page.mouse.click(solo.x, solo.y);
  await page.waitForTimeout(300);
  const noteWidgetUp = await page.evaluate(() =>
    document.getElementById('note-widget').classList.contains('visible'));
  check('REGRESSION: single-note click still opens the note widget', noteWidgetUp);

  const t0 = (await starts(page, [sel1[1]]))[sel1[1]].t;
  await page.mouse.move(solo.x, solo.y);
  await page.mouse.down();
  await page.mouse.move(solo.x + 70, solo.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const t1 = (await starts(page, [sel1[1]]))[sel1[1]].t;
  check('REGRESSION: single-note drag still moves the note',
    Math.abs(t1 - t0) > 1e-3, `${t0.toFixed(3)} -> ${t1.toFixed(3)}`);

  check('no pageerror on desktop', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═════════════════════════ 1 NOTE IS NOT A GROUP ════════════════════════════
console.log('\n== a one-note selection is a NORMAL selection, however you get there');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  const widgets = () => page.evaluate(() => ({
    note: document.getElementById('note-widget').classList.contains('visible'),
    group: !!document.getElementById('group-widget')?.classList.contains('visible'),
    sel: (window.__rmtRenderer.getMultiSelection?.() || []).length,
    title: document.getElementById('note-widget-title')?.textContent || '',
  }));

  const chains = await findChains(page);
  const { a: A, b: B } = chains[0];
  const pA = await pointOfNote(page, A);
  const pB = await pointOfNote(page, B);

  // --- 1. a LONE shift-click must give the NORMAL note widget, not the group widget
  await warm(page, pA.x, pA.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pA.x, pA.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(350);
  const w1 = await widgets();
  console.log('  after lone shift-click ' + JSON.stringify(w1));
  check('a lone shift-click opens the NORMAL note widget, not the group widget',
    w1.note && !w1.group, JSON.stringify(w1));
  check('...and it is not held as a one-note group', w1.sel === 0, `group set size = ${w1.sel}`);
  await shoot(page, '14-lone-shiftclick-note-widget');

  // --- 2. normal-select, then shift-click a SECOND -> 2 notes, group widget,
  //        and the note widget must GO AWAY (it no longer describes anything)
  await warm(page, pA.x, pA.y);
  await page.mouse.click(pA.x, pA.y);
  await page.waitForTimeout(300);
  const wSolo = await widgets();
  check('plain click selects one note and opens the note widget', wSolo.note && !wSolo.group);

  await warm(page, pB.x, pB.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pB.x, pB.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  const w2 = await widgets();
  console.log('  after adding a 2nd with shift ' + JSON.stringify(w2));
  check('click one + shift-click another = TWO selected (the first is not dropped)',
    w2.sel === 2, `${w2.sel} selected`);
  check('...the group widget opens', w2.group);
  check('...and the note-variables widget CLOSES (it no longer applies)', !w2.note);
  await shoot(page, '15-two-selected-group-widget');

  // --- 3. shift-click back down to one -> normal note widget returns
  await warm(page, pB.x, pB.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pB.x, pB.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  const w3 = await widgets();
  console.log('  after shift-clicking back down to one ' + JSON.stringify(w3));
  check('dropping back to ONE note restores the normal note widget',
    w3.note && !w3.group && w3.sel === 0, JSON.stringify(w3));
  await shoot(page, '16-back-down-to-one');

  check('no pageerror', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═══════════════ GROUP DRAG: labels/arrows follow, and the preview clamps ═══
console.log('\n== group drag: glyphs follow the notes, and the ghost clamps at the base note');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  const box = await page.evaluate(() => {
    const R = window.__rmtRenderer, W = window.__rmtWorkspace, m = R.matrix;
    const on = [];
    for (let i = 0; i < R.instanceCount; i++) {
      const o = i * 4;
      const x = R.posSize[o], y = R.posSize[o + 1], w = R.posSize[o + 2], h = R.posSize[o + 3];
      const ax = m[0] * x + m[3] * y + m[6], ay = m[1] * x + m[4] * y + m[7];
      const bx = m[0] * (x + w) + m[3] * (y + h) + m[6], by = m[1] * (x + w) + m[4] * (y + h) + m[7];
      const L = Math.min(ax, bx), Rr = Math.max(ax, bx), T = Math.min(ay, by), B = Math.max(ay, by);
      if (Rr < 10 || L > innerWidth - 10 || B < 70 || T > innerHeight - 10) continue;
      on.push({ id: R._instanceNoteIds[i], L, R: Rr, T, B });
    }
    on.sort((a, b) => a.L - b.L);
    const t = on.slice(0, 6);
    const L = Math.min(...t.map(s => s.L)), Rr = Math.max(...t.map(s => s.R));
    const T = Math.min(...t.map(s => s.T)), B = Math.max(...t.map(s => s.B));
    let x0 = L - 24, y0 = T - 24;
    for (let k = 0; k < 40 && W.pickAt(x0, y0, 3); k++) { x0 -= 6; y0 -= 6; }
    return { x0: Math.max(6, x0), y0: Math.max(70, y0), x1: Rr + 24, y1: B + 24 };
  });

  await warm(page, box.x0, box.y0);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move(box.x1, box.y1, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  const sel = await selection(page);
  check('marquee selected a group to drag', sel.length > 1, `${sel.length} notes`);

  // --- grab one and drag RIGHT; mid-drag, every selected note must be flagged as
  //     moving in _dragMovingIds — that set is what shifts the glyph atlas (fraction
  //     labels) and the octave arrows. If it misses group members, the rects move and
  //     the labels stay behind.
  const grabId = sel[Math.floor(sel.length / 2)];
  const gp = await pointOfNote(page, grabId);
  await warm(page, gp.x, gp.y);
  await page.mouse.move(gp.x, gp.y);
  await page.mouse.down();
  await page.mouse.move(gp.x + 100, gp.y, { steps: 12 });
  await page.waitForTimeout(250);

  const flags = await page.evaluate((sel) => {
    const R = window.__rmtRenderer;
    const moving = R._dragMovingIds;
    const anchor = R._dragOverlay?.noteId;
    const covered = sel.filter((id) => moving?.has(Number(id)) || Number(id) === Number(anchor));
    return {
      dragActive: !!R._dragActive,
      movingSize: moving ? moving.size : 0,
      anchor,
      coveredCount: covered.length,
      missing: sel.filter((id) => !(moving?.has(Number(id)) || Number(id) === Number(anchor))),
    };
  }, sel);
  console.log('  drag flags ' + JSON.stringify(flags));
  check('EVERY selected note is flagged moving (so its fraction label + arrows shift too)',
    flags.coveredCount === sel.length,
    `${flags.coveredCount}/${sel.length} covered; missing=[${flags.missing.join(', ')}]`);
  await shoot(page, '17-group-drag-glyphs-follow');
  await page.mouse.up();
  await page.waitForTimeout(500);

  // --- drag the group HARD to the left: the ghost must stop at the base note, not
  //     slide past it and snap back on drop.
  const sel2 = await selection(page);
  const grab2 = sel2[0];
  const gp2 = await pointOfNote(page, grab2);
  const baseT = await page.evaluate(() =>
    Number(window.__rmtWorkspace._module.baseNote.getVariable('startTime').valueOf()));

  await warm(page, gp2.x, gp2.y);
  await page.mouse.move(gp2.x, gp2.y);
  await page.mouse.down();
  await page.mouse.move(gp2.x - 900, gp2.y, { steps: 18 });   // way past the base note
  await page.waitForTimeout(250);

  const ghost = await page.evaluate((sel) => {
    const R = window.__rmtRenderer, W = window.__rmtWorkspace;
    const st = W._interaction;
    const dxSec = R._dragDxSec || 0;
    const mod = W._module;
    // where every selected note's ghost currently sits
    const previewStarts = sel.map((id) =>
      Number(mod.getNoteById(Number(id)).getVariable('startTime').valueOf()) + dxSec);
    return { dxSec, minPreviewStart: Math.min(...previewStarts),
             groupMinDeltaSec: st?.groupMinDeltaSec };
  }, sel2);
  console.log('  ghost ' + JSON.stringify(ghost));
  check('the group GHOST clamps at the base note (no overshoot-then-snap-back)',
    ghost.minPreviewStart >= baseT - 1e-3,
    `earliest ghost start = ${ghost.minPreviewStart.toFixed(4)}, base = ${baseT.toFixed(4)}`);
  await shoot(page, '18-group-drag-clamped-at-base');

  await page.mouse.up();
  await page.waitForTimeout(600);

  const dropped = await starts(page, sel2);
  const minDropped = Math.min(...sel2.map((id) => dropped[id].t));
  check('...and the DROP lands where the ghost was (no jump)',
    minDropped >= baseT - 1e-3 && Math.abs(minDropped - ghost.minPreviewStart) < 0.05,
    `earliest dropped start = ${minDropped.toFixed(4)} vs ghost ${ghost.minPreviewStart.toFixed(4)}`);

  check('no pageerror', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═════════════════ MEASURE BARS ARE NOT GROUP-SELECTABLE ════════════════════
console.log('\n== measure bars must stay out of multi-select entirely');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  const measureIds = await page.evaluate(() =>
    Array.from(window.__rmtRenderer._measureTriIds || []).map(Number));
  console.log(`  module has ${measureIds.length} measure bars: [${measureIds.join(', ')}]`);

  // pickRect over the WHOLE viewport — the widest net there is.
  const rectHits = await page.evaluate(() => {
    const R = window.__rmtRenderer;
    const hits = R.pickRect(0, 0, innerWidth, innerHeight) || [];
    return { types: [...new Set(hits.map(h => h.type))], ids: hits.map(h => Number(h.id)) };
  });
  const rectMeasures = rectHits.ids.filter((id) => measureIds.includes(id));
  check('pickRect never returns a measure bar',
    rectMeasures.length === 0 && !rectHits.types.includes('measure'),
    `types=[${rectHits.types.join(', ')}], measures caught=[${rectMeasures.join(', ')}]`);

  // A real marquee across the whole workspace, which certainly crosses measure bars.
  await warm(page, 40, 200);
  await page.keyboard.down('Shift');
  await page.mouse.move(40, 200);
  await page.mouse.down();
  await page.mouse.move(1240, 800, { steps: 14 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);

  const sel = await selection(page);
  const selMeasures = sel.filter((id) => measureIds.includes(id));
  check('a full-workspace marquee selects notes but NO measure bars',
    sel.length > 0 && selMeasures.length === 0,
    `${sel.length} selected, measures among them = [${selMeasures.join(', ')}]`);
  await shoot(page, '19-marquee-excludes-measures');

  // Find a measure triangle with the SAME picker the click handler uses — deriving its
  // screen box by hand puts it off-viewport and the test silently skips.
  const mPt = await page.evaluate(() => {
    const W = window.__rmtWorkspace;
    for (let y = window.innerHeight - 12; y > 70; y -= 4) {
      for (let x = 20; x < window.innerWidth - 20; x += 4) {
        const h = W.pickAt(x, y, 3);
        if (h && h.type === 'measure' && h.id != null) return { x, y, id: Number(h.id) };
      }
    }
    return null;
  });
  if (!mPt) throw new Error('no measure triangle reachable by the picker');
  console.log('  measure triangle at ' + JSON.stringify(mPt));

  // Shift-clicking a measure must do nothing at all.
  {
    const before = await selection(page);
    await warm(page, mPt.x, mPt.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(mPt.x, mPt.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(350);
    const after = await selection(page);
    check(`shift-clicking measure bar [${mPt.id}] does NOT add it to the group`,
      !after.includes(mPt.id) && after.length === before.length,
      `selection ${before.length} -> ${after.length}`);
  }

  // REGRESSION: measures must still work exactly as they always did on their own.
  await warm(page, 900, 700);
  await page.mouse.click(900, 700);          // clear
  await page.waitForTimeout(300);

  await warm(page, mPt.x, mPt.y);
  await page.mouse.click(mPt.x, mPt.y);
  await page.waitForTimeout(400);
  const mSel = await page.evaluate(() => ({
    noteWidget: document.getElementById('note-widget').classList.contains('visible'),
    title: document.getElementById('note-widget-title')?.textContent || '',
    groupWidget: !!document.getElementById('group-widget')?.classList.contains('visible'),
    selectedId: window.__rmtRenderer._lastSelectedNoteId,
  }));
  check('REGRESSION: a measure bar still selects normally on a plain click',
    mSel.noteWidget && !mSel.groupWidget && Number(mSel.selectedId) === mPt.id,
    `widget="${mSel.title}", renderer selection=${mSel.selectedId}`);
  await shoot(page, '20-measure-still-selects-normally');

  const mBefore = (await starts(page, [mPt.id]))[mPt.id].t;
  await page.mouse.move(mPt.x, mPt.y);
  await page.mouse.down();
  await page.mouse.move(mPt.x + 80, mPt.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const mAfter = (await starts(page, [mPt.id]))[mPt.id].t;
  check('REGRESSION: a measure bar still drags on its own',
    Math.abs(mAfter - mBefore) > 1e-3, `${mBefore.toFixed(4)} -> ${mAfter.toFixed(4)}`);

  check('no pageerror', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═══════════════════════════════════════════ GROUP DELETE ═══════════════════
console.log('\n== group delete: liberate dependents, keep their positions, one undo');
{
  const { ctx, page, errors } = await newPage({ width: 1280, height: 820 });

  // Select a chain A,B but NOT C — so C is an OUTSIDE dependent that must be
  // liberated (kept, with its position) rather than deleted.
  const chains = await findChains(page);
  const { a: A, b: B, c: C } = chains[0];
  const noteCount = () => page.evaluate(() =>
    Object.keys(window.__rmtWorkspace._module.notes).length);

  const nBefore = await noteCount();
  const before = await starts(page, [A, B, C]);
  const uBefore = await undoDepth(page);

  await emit(page, 'workspace:marqueeCommit', { ids: [A, B], additive: false });
  await page.waitForTimeout(250);
  await shoot(page, '10-before-group-delete');

  await page.click('#group-widget .group-widget-btn-danger');
  await page.waitForTimeout(350);
  const dialog = await page.evaluate(() => {
    const o = document.querySelector('.delete-confirm-overlay');
    return o ? { present: true, text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) } : { present: false };
  });
  check('"Delete all" goes through the house confirm dialog', dialog.present, dialog.text);
  await shoot(page, '11-group-delete-confirm');

  await page.click('.delete-confirm-modal button:first-child');   // confirm
  await page.waitForTimeout(700);

  const after = await starts(page, [A, B, C]);
  const nAfter = await noteCount();

  check('the two selected notes are gone', after[A] === null && after[B] === null,
    `note count ${nBefore} -> ${nAfter}`);
  check('the OUTSIDE dependent C was LIBERATED, not deleted', after[C] !== null,
    after[C] ? `C survives, expr now "${after[C].raw}"` : 'C WAS DELETED');
  check('...and C kept its absolute position',
    after[C] && Math.abs(after[C].t - before[C].t) < 1e-3,
    after[C] ? `C.t ${before[C].t.toFixed(4)} -> ${after[C].t.toFixed(4)}` : 'n/a');
  check("...and C's expression was rewritten to stand alone (no dangling [A]/[B] refs)",
    after[C] && !new RegExp(`\\[(${A}|${B})\\]`).test(after[C].raw),
    after[C] ? after[C].raw : 'n/a');

  check('the group delete is ONE undo entry',
    (await undoDepth(page)) - uBefore === 1, `undo ${uBefore} -> ${await undoDepth(page)}`);
  check('the base note survived', await page.evaluate(() => !!window.__rmtWorkspace._module.baseNote));
  check('the selection and widget are cleared after the delete',
    (await selection(page)).length === 0 &&
    await page.evaluate(() => !document.getElementById('group-widget')?.classList.contains('visible')));
  await shoot(page, '12-after-group-delete');

  // Undo must bring them back.
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/utils/event-bus.js');
    eventBus.emit('history:undo');
  });
  await page.waitForTimeout(700);
  const restored = await starts(page, [A, B, C]);
  check('a single undo restores the whole group',
    restored[A] !== null && restored[B] !== null &&
    Math.abs(restored[A].t - before[A].t) < 1e-3 && Math.abs(restored[B].t - before[B].t) < 1e-3,
    `A=${restored[A] ? restored[A].t.toFixed(3) : 'gone'} B=${restored[B] ? restored[B].t.toFixed(3) : 'gone'}`);
  await shoot(page, '13-after-undo');

  check('no pageerror during group delete', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

// ═══════════════════════════════════════════ LOCKED ═════════════════════════
console.log('\n== locked workspace: multi-select must be inert');
{
  const { ctx, page } = await newPage({ width: 1280, height: 820 });
  await page.click('#lockButton');
  await page.waitForTimeout(300);

  const box = { x0: 616, y0: 368, x1: 1024, y1: 555 };
  await warm(page, box.x0, box.y0);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move(box.x1, box.y1, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  check('a locked workspace cannot be marquee-selected',
    (await selection(page)).length === 0,
    `${(await selection(page)).length} selected`);
  await ctx.close();
}

// ═══════════════════════════════════════════ TOUCH ══════════════════════════
console.log('\n== mobile 390x844 (touch) — long-press marquee');
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 844, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

  // --- a short drag on the background must still PAN (long-press must not steal it)
  const camBefore = await page.evaluate(() => window.__rmtWorkspace.camera.tx);
  await touch('touchStart', [{ x: 200, y: 500 }]);
  for (const x of [190, 170, 140, 110]) { await touch('touchMove', [{ x, y: 500 }]); await page.waitForTimeout(30); }
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const camAfter = await page.evaluate(() => window.__rmtWorkspace.camera.tx);
  check('REGRESSION: a quick single-finger drag still PANS the camera',
    Math.abs(camAfter - camBefore) > 1, `tx ${camBefore.toFixed(1)} -> ${camAfter.toFixed(1)}`);
  check('...and did not start a marquee',
    (await selection(page)).length === 0 && await page.evaluate(() => !window.__rmtRenderer._marqueeRect));

  // --- long-press on empty background, HOLD STILL, then rubber-band
  await touch('touchStart', [{ x: 60, y: 300 }]);
  await page.waitForTimeout(700);           // > 500ms, no travel => marquee arms
  const armed = await page.evaluate(() => window.__rmtWorkspace._interaction?.type);
  check('long-press (500ms, still) enters marquee mode', armed === 'marquee', `interaction type = ${armed}`);

  for (const [x, y] of [[140, 400], [230, 520], [330, 640]]) {
    await touch('touchMove', [{ x, y }]);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);
  await shoot(page, '08-mobile-marquee-mid-drag');
  const camPanned = await page.evaluate(() => window.__rmtWorkspace.camera.inputEnabled);
  check('the camera is GATED during the marquee (no pan-while-rubber-banding)', camPanned === false);

  await touch('touchEnd', []);
  await page.waitForTimeout(500);

  const mSel = await selection(page);
  check('touch marquee selected notes', mSel.length > 0, `${mSel.length} notes`);
  const mWidget = await page.evaluate(() => {
    const w = document.getElementById('group-widget');
    const r = w.getBoundingClientRect();
    return { visible: w.classList.contains('visible'), w: Math.round(r.width), h: Math.round(r.height),
             left: Math.round(r.left), top: Math.round(r.top), vw: innerWidth, vh: innerHeight };
  });
  check('the group widget is a floating card on mobile, inside the viewport',
    mWidget.visible && mWidget.w < mWidget.vw && mWidget.left >= 0 && mWidget.top >= 50,
    JSON.stringify(mWidget));
  await shoot(page, '09-mobile-marquee-result');

  const camRestored = await page.evaluate(() => window.__rmtWorkspace.camera.inputEnabled);
  check('the camera is restored after the marquee', camRestored === true);

  // ── long-press ON A NOTE = the touch equivalent of shift-click ──────────────
  // Press and HOLD on a note, without moving, then release.
  const longPressNote = async (id) => {
    const p = await pointOfNote(page, id);
    await touch('touchStart', [{ x: p.x, y: p.y }]);
    await page.waitForTimeout(750);          // > 500ms, no travel => the press fires
    await touch('touchEnd', []);
    await page.waitForTimeout(450);
    return selection(page);
  };

  // 1. REMOVE a note that is in the group
  const victim = mSel[0];
  const afterRemove = await longPressNote(victim);
  check(`long-press REMOVES note ${victim} from the group (was clearing everything)`,
    !afterRemove.includes(victim) && afterRemove.length === mSel.length - 1,
    `${mSel.length} -> ${afterRemove.length} selected`);
  await shoot(page, '21-mobile-longpress-removed');

  // 2. ADD it back
  const afterAdd = await longPressNote(victim);
  check(`long-press ADDS note ${victim} back to the group`,
    afterAdd.includes(victim) && afterAdd.length === mSel.length,
    `${afterRemove.length} -> ${afterAdd.length} selected`);
  await shoot(page, '22-mobile-longpress-added');

  // 3. the group must SURVIVE the release (the tap that follows a long-press used to
  //    reach player.js's pointerup handler and clear everything)
  await page.waitForTimeout(600);
  check('the group survives the long-press release (tap suppression holds)',
    (await selection(page)).length === afterAdd.length,
    `${(await selection(page)).length} still selected 600ms after release`);

  // 4. a long-press on a note with NOTHING selected must SELECT it (it was doing nothing)
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/utils/event-bus.js');
    eventBus.emit('workspace:marqueeCommit', { ids: [], additive: false });
  });
  await page.waitForTimeout(300);
  const notes = await page.evaluate(() => Array.from(window.__rmtRenderer._instanceNoteIds || []).slice(0, 40));
  const solo = notes.find((n) => n !== 0);
  const p = await pointOfNote(page, solo);
  await touch('touchStart', [{ x: p.x, y: p.y }]);
  await page.waitForTimeout(750);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const soloState = await page.evaluate(() => ({
    sel: (window.__rmtRenderer.getMultiSelection?.() || []).length,
    selectedId: window.__rmtRenderer._lastSelectedNoteId,
    noteWidget: document.getElementById('note-widget').classList.contains('visible'),
    groupWidget: !!document.getElementById('group-widget')?.classList.contains('visible'),
  }));
  check(`an initial long-press on note ${solo} SELECTS it (one note = normal selection)`,
    Number(soloState.selectedId) === Number(solo) && soloState.noteWidget && !soloState.groupWidget,
    JSON.stringify(soloState));
  await shoot(page, '23-mobile-longpress-initial-select');

  // 5. REGRESSION: a quick TAP on a note must still select it normally (not toggle)
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/utils/event-bus.js');
    eventBus.emit('workspace:marqueeCommit', { ids: [], additive: false });
  });
  await page.waitForTimeout(300);
  await touch('touchStart', [{ x: p.x, y: p.y }]);
  await page.waitForTimeout(80);            // well under the long-press threshold
  await touch('touchEnd', []);
  await page.waitForTimeout(450);
  const tapped = await page.evaluate(() => ({
    selectedId: window.__rmtRenderer._lastSelectedNoteId,
    noteWidget: document.getElementById('note-widget').classList.contains('visible'),
  }));
  check('REGRESSION: a quick tap on a note still selects it normally',
    Number(tapped.selectedId) === Number(solo) && tapped.noteWidget,
    JSON.stringify(tapped));

  check('no pageerror on mobile', !errors.length, errors.join(' | ') || 'clean');
  await ctx.close();
}

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
console.log('wrote', OUT);
process.exit(failed.length ? 1 : 0);
