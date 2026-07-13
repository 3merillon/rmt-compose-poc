#!/usr/bin/env node
/**
 * "Copy to Modules": export a group selection into the library's Custom section as a
 * self-contained module, rooted at the earliest selected note.
 *
 * The screenshots prove the icon shows up. The part a screenshot CANNOT prove is that
 * the copy is actually the same music, so this loads the exported JSON back as a real
 * Module, evaluates it, and compares it against the original selection:
 *
 *   LAYOUT      every note's offset from the earliest note, its duration, and its pitch
 *               RATIO to the base must match the original exactly.
 *   TREE        internal `[N]` references must be PRESERVED (renumbered), not flattened
 *               into constants — that is what "conserving the branching" means. A copy
 *               that merely lands in the right places but has lost its expressions would
 *               pass a layout check and still be wrong.
 *   SEALED      no reference may dangle outside the copy.
 *   ROUND TRIP  dropping the module back onto the note the selection hung from must
 *               land it exactly on top of the original.
 *
 *   npm run dev
 *   node scripts/perf/shot-copy-to-modules.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/copy-to-modules';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('  !! pageerror:', e.message); });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  console.log('  !! console.error:', m.text());
  if (!/wake lock/i.test(m.text())) errors.push(m.text());
});
// Clear ONCE, on the first load. addInitScript re-runs on every navigation, so an
// unguarded clear() here wipes the library on the reload we are about to test.
await page.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('__rmt_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__rmt_cleared', '1');
    }
  } catch {}
});
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(900);

const emit = (ev, payload) => page.evaluate(async ({ ev, payload }) => {
  const { eventBus } = await import('/src/utils/event-bus.js');
  eventBus.emit(ev, payload);
}, { ev, payload });

// Pick a selection with REAL internal branching: a chain A <- B <- C plus a sibling.
const sel = await page.evaluate(() => {
  const mod = window.__rmtWorkspace._module;
  const parentOf = (n) => {
    const raw = (n.variables && n.variables.startTimeString) || '';
    const m = raw.match(/\[(\d+)\]\./);
    return m ? Number(m[1]) : (/\bbase\./.test(raw) ? 0 : null);
  };
  const isMeasure = (n) => !!(n.variables?.startTime && !n.variables?.duration && !n.variables?.frequency);
  const ids = Object.keys(mod.notes).map(Number).filter((i) => i !== 0)
    .filter((i) => { const n = mod.getNoteById(i); return n && !isMeasure(n); });
  // longest run of consecutively-chained notes we can find, capped at 5
  const P = new Map(ids.map((i) => [i, parentOf(mod.getNoteById(i))]));
  for (const seed of ids) {
    const run = [seed];
    let cur = seed;
    while (run.length < 5) {
      const next = ids.find((i) => P.get(i) === cur && !run.includes(i));
      if (next == null) break;
      run.push(next);
      cur = next;
    }
    if (run.length >= 4) return run;
  }
  return ids.slice(0, 4);
});
console.log(`  selection: [${sel.join(', ')}]`);

// The original truth we must reproduce.
const before = await page.evaluate((sel) => {
  const mod = window.__rmtWorkspace._module;
  const v = (n, k) => { const x = n.getVariable(k); return x == null ? null : Number(x.valueOf()); };
  const baseF = v(mod.baseNote, 'frequency');
  const notes = sel.map((id) => {
    const n = mod.getNoteById(id);
    return { id, t: v(n, 'startTime'), d: v(n, 'duration'), f: v(n, 'frequency'),
             raw: n.variables.startTimeString || '' };
  }).sort((a, b) => a.t - b.t || a.id - b.id);
  const t0 = notes[0].t;
  return {
    baseF,
    t0,
    anchorRaw: notes[0].raw,
    notes: notes.map((n) => ({ id: n.id, dt: n.t - t0, d: n.d, ratio: n.f == null ? null : n.f / baseF })),
    // how many of them are anchored to another note IN the selection (= must stay a [ref])
    internalEdges: notes.filter((n) => {
      const m = (n.raw || '').match(/\[(\d+)\]\./);
      return m && sel.includes(Number(m[1]));
    }).length,
  };
}, sel);
console.log('  original: ' + JSON.stringify(before.notes.map((n) => ({ dt: +n.dt.toFixed(4), d: +n.d.toFixed(4), r: n.ratio ? +n.ratio.toFixed(6) : null }))));
console.log(`  internal branching edges in the original: ${before.internalEdges}`);

// ── copy it ──────────────────────────────────────────────────────────────────
await emit('workspace:marqueeCommit', { ids: sel, additive: false });
await page.waitForTimeout(300);

await page.evaluate(() => {
  document.querySelector('.icons-wrapper')?.classList.remove('collapsed');
  document.querySelector('.second-top-bar').style.height = '190px';
});
await page.waitForTimeout(300);
writeFileSync(join(OUT, '00-selection.png'), await page.screenshot());

await page.click('#group-widget .group-widget-btn[data-action="copy-to-modules"]');
await page.waitForTimeout(700);
writeFileSync(join(OUT, '01-copied.png'), await page.screenshot());

const icon = await page.evaluate(() => {
  const section = [...document.querySelectorAll('.library-section, .icons-container > div')]
    .find((c) => c.querySelector?.('.category-label[data-category="custom"]'));
  const icons = section ? [...section.querySelectorAll('.icon')] : [];
  const mine = icons.find((i) => /^Selection/.test(i.getAttribute('data-name') || ''));
  return mine ? {
    name: mine.getAttribute('data-name'),
    uploaded: mine.getAttribute('data-uploaded'),
    category: mine.getAttribute('data-category'),
    data: mine.moduleData || null,
  } : null;
});
check('a module icon appears in the Custom section', !!icon, icon ? `"${icon.name}" (uploaded=${icon.uploaded}, category=${icon.category})` : 'NOT FOUND');
if (!icon) { await browser.close(); process.exit(1); }
check('the selection is still live after copying (non-destructive)',
  (await page.evaluate(() => (window.__rmtRenderer.getMultiSelection() || []).length)) === sel.length);

const data = icon.data;
console.log('  exported: ' + JSON.stringify(data.notes.map((n) => n.startTime)));

// ── SEALED: no reference may point outside the copy ──────────────────────────
{
  const n = data.notes.length;
  const bad = [];
  for (const note of data.notes) {
    for (const k of ['startTime', 'duration', 'frequency']) {
      const raw = note[k];
      if (typeof raw !== 'string') continue;
      for (const m of raw.matchAll(/\[(\d+)\]/g)) {
        const ref = Number(m[1]);
        if (ref < 1 || ref > n) bad.push(`note ${note.id}.${k} -> [${ref}]`);
      }
    }
  }
  check('the module is SEALED: every reference points inside the copy',
    bad.length === 0, bad.length ? bad.join('; ') : `ids 1..${n}, no dangling refs`);
  check('the earliest note is rooted on the new baseNote',
    /^base\.t\s*$/.test(data.notes[0].startTime),
    `note 1 startTime = "${data.notes[0].startTime}"`);
}

// ── TREE: internal branching survived as references, not as constants ────────
{
  const withRefs = data.notes.filter((n) => /\[\d+\]\./.test(n.startTime || '')).length;
  check('the BRANCHING survived: internal anchors are still [N] references, not flattened',
    withRefs === before.internalEdges && withRefs > 0,
    `${withRefs} exported notes anchor to a sibling; original had ${before.internalEdges}`);
}

// ── LAYOUT: load the copy as a real Module and compare ───────────────────────
const after = await page.evaluate(async (data) => {
  const { Module } = await import('/src/module.js');
  const m = await Module.loadFromJSON(JSON.parse(JSON.stringify(data)));
  m.evaluateModule();
  const v = (n, k) => { const x = n.getVariable(k); return x == null ? null : Number(x.valueOf()); };
  const baseF = v(m.baseNote, 'frequency');
  const t0 = v(m.getNoteById(1), 'startTime');
  const ids = Object.keys(m.notes).map(Number).filter((i) => i !== 0).sort((a, b) => a - b);
  return {
    baseF,
    notes: ids.map((i) => {
      const n = m.getNoteById(i);
      const f = v(n, 'frequency');
      return { id: i, dt: v(n, 'startTime') - t0, d: v(n, 'duration'), ratio: f == null ? null : f / baseF };
    }),
  };
}, data);
console.log('  reloaded: ' + JSON.stringify(after.notes.map((n) => ({ dt: +n.dt.toFixed(4), d: +n.d.toFixed(4), r: n.ratio ? +n.ratio.toFixed(6) : null }))));

{
  const near = (a, b, eps = 1e-6) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < eps);
  const n = Math.min(before.notes.length, after.notes.length);
  check('the copy has the same number of notes as the selection',
    after.notes.length === before.notes.length, `${before.notes.length} -> ${after.notes.length}`);

  const dtBad = [], dBad = [], rBad = [];
  for (let i = 0; i < n; i++) {
    const o = before.notes[i], c = after.notes[i];
    if (!near(o.dt, c.dt, 1e-6)) dtBad.push(`#${i + 1}: ${o.dt} vs ${c.dt}`);
    if (!near(o.d, c.d, 1e-6)) dBad.push(`#${i + 1}: ${o.d} vs ${c.d}`);
    if (!near(o.ratio, c.ratio, 1e-9)) rBad.push(`#${i + 1}: ${o.ratio} vs ${c.ratio}`);
  }
  check('LAYOUT: every note keeps its exact offset from the earliest note',
    dtBad.length === 0, dtBad.length ? dtBad.join('; ') : `${n} notes, all offsets identical`);
  check('LAYOUT: every duration is preserved exactly',
    dBad.length === 0, dBad.length ? dBad.join('; ') : `${n} durations identical`);
  check('LAYOUT: every pitch RATIO to the base is preserved exactly',
    rBad.length === 0, rBad.length ? rBad.join('; ') : `${n} ratios identical`);
}

// ── PERSISTENCE: it must survive a reload ────────────────────────────────────
{
  const stored = await page.evaluate((name) => {
    const st = JSON.parse(localStorage.getItem('ui-state') || '{}');
    const cat = (st.categories || []).find((c) => c.name === 'custom');
    const m = (cat?.modules || []).find((x) => x.name === name);
    return m ? { name: m.name, isUploaded: !!m.isUploaded, hasData: !!m.moduleData,
                 notes: m.moduleData?.notes?.length ?? 0 } : null;
  }, icon.name);
  check('the copy is persisted to ui-state (survives a reload)',
    !!stored && stored.hasData && stored.notes === data.notes.length,
    JSON.stringify(stored));
}

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  document.querySelector('.icons-wrapper')?.classList.remove('collapsed');
  document.querySelector('.second-top-bar').style.height = '190px';
});
await page.waitForTimeout(400);
const survived = await page.evaluate((name) =>
  [...document.querySelectorAll('.icon')].some((i) => i.getAttribute('data-name') === name), icon.name);
check('...and it is still in the library after a reload', survived, `"${icon.name}"`);
writeFileSync(join(OUT, '02-after-reload.png'), await page.screenshot());

// ── ROUND TRIP: drop it back onto what the selection hung from ───────────────
{
  const anchorId = await page.evaluate((raw) => {
    const m = String(raw).match(/\[(\d+)\]\./);
    return m ? Number(m[1]) : 0;     // 0 = the BaseNote
  }, before.anchorRaw);
  console.log(`  round-trip: dropping the copy back onto note [${anchorId}] (what the earliest note hung from)`);

  const nBefore = await page.evaluate(() => Object.keys(window.__rmtWorkspace._module.notes).length);
  await emit('player:importModuleAtTarget', { targetNoteId: anchorId, moduleData: data });
  await page.waitForTimeout(900);

  const rt = await page.evaluate(({ nBefore, expect }) => {
    const mod = window.__rmtWorkspace._module;
    const ids = Object.keys(mod.notes).map(Number).sort((a, b) => a - b);
    const fresh = ids.slice(-expect);   // the notes the import just appended
    const v = (n, k) => { const x = n.getVariable(k); return x == null ? null : Number(x.valueOf()); };
    const baseF = v(mod.baseNote, 'frequency');
    const got = fresh.map((i) => {
      const n = mod.getNoteById(i);
      const f = v(n, 'frequency');
      return { t: v(n, 'startTime'), d: v(n, 'duration'), ratio: f == null ? null : f / baseF };
    });
    return { added: ids.length - nBefore, got };
  }, { nBefore, expect: data.notes.length });

  check('the round-tripped import added exactly the copied notes',
    rt.added === data.notes.length, `${rt.added} notes added`);

  // Dropped on the SAME anchor, the copy must land exactly on top of the originals.
  const near = (a, b, eps) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < eps);
  const bad = [];
  for (let i = 0; i < before.notes.length; i++) {
    const o = before.notes[i], c = rt.got[i];
    if (!c) { bad.push(`#${i + 1}: missing`); continue; }
    if (!near(o.dt + before.t0, c.t, 1e-4)) bad.push(`#${i + 1} t: ${(o.dt + before.t0).toFixed(4)} vs ${c.t.toFixed(4)}`);
    if (!near(o.d, c.d, 1e-4)) bad.push(`#${i + 1} d: ${o.d} vs ${c.d}`);
    if (!near(o.ratio, c.ratio, 1e-6)) bad.push(`#${i + 1} f: ${o.ratio} vs ${c.ratio}`);
  }
  check('ROUND TRIP: re-imported onto its original anchor, the copy lands ON TOP of the original',
    bad.length === 0, bad.length ? bad.slice(0, 4).join('; ') : 'start, duration and pitch all identical');
  writeFileSync(join(OUT, '03-round-tripped.png'), await page.screenshot());
}

check('no pageerror', !errors.length, errors.join(' | ') || 'clean');

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
console.log('wrote', OUT);
process.exit(failed.length ? 1 : 0);
