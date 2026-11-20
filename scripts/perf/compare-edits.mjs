#!/usr/bin/env node
/**
 * The same edits on two servers, compared step by step: what a change to the
 * edit path must leave as it was.
 *
 * Runs one sequence of edits (octave steps, a move, a resize, a group move,
 * undo, redo) through the app's own event bus on each server, in headless
 * Edge, and after every step records SHA-256 digests of:
 *   - the autosave (src/store/autosave.js where the server has it, after its
 *     write has landed; else localStorage rmt:moduleSnapshot:v1),
 *   - the undo and redo stacks (each entry's label and snapshot text),
 *   - what the renderer holds for drawing (instance positions, colours, flags,
 *     corruption, envelopes, note labels, instance count, module end).
 * Exit 1 when any digest differs between the servers, or when the autosave
 * is not JSON.stringify(module.createModuleJSON()) on either.
 *
 * Usage (two dev servers, e.g. v2 HEAD on 3221 and a branch on 3220):
 *   node scripts/perf/compare-edits.mjs [--before http://localhost:3221] [--after http://localhost:3220]
 *        [--module voices-5000|defaultModule|chain-1000|...] [--engine js|wasm]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BEFORE = flag('--before', 'http://localhost:3221');
const AFTER = flag('--after', 'http://localhost:3220');
const MODULE = flag('--module', 'voices-5000');
const ENGINE = flag('--engine', 'js');

const file = MODULE === 'defaultModule'
  ? join(here, '..', '..', 'public', 'modules', 'defaultModule.json')
  : join(here, '..', '..', 'public', 'modules', 'perf', `${MODULE}.json`);
const body = readFileSync(file, 'utf8');

async function run(browser, base) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.route('**/modules/defaultModule.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto(`${base}/?perf=1&evaluator=${ENGINE}`, { waitUntil: 'load' });
  await page.waitForFunction((engine) => {
    const P = window.__rmtPerf;
    if (!P || !(window.__rmtRenderer?.instanceCount > 0)) return false;
    try { const n = P.info().evaluator || ''; return engine === 'wasm' ? /wasm/i.test(n) : !/wasm/i.test(n); } catch { return false; }
  }, ENGINE, { timeout: 300_000 });
  await page.waitForTimeout(1000);

  const steps = await page.evaluate(async () => {
    const { history } = await import('/src/store/history.js');
    let A = null;
    try { A = await import('/src/store/autosave.js'); } catch {}
    const readSaved = async () => {
      if (A && typeof A.readSavedModuleText === 'function') { await A.whenSaved(); return (await A.readSavedModuleText()) || ''; }
      return localStorage.getItem('rmt:moduleSnapshot:v1') || '';
    };
    const P = window.__rmtPerf, r = window.__rmtRenderer;
    const enc = new TextEncoder();
    const digest = async (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    const mod = () => P.getModuleRef();
    const ids = Object.keys(mod().notes).map(Number).filter((id) => id !== 0).sort((a, b) => a - b);
    const withF = ids.filter((id) => mod().getNoteById(id).hasExpression('frequency') && mod().getNoteById(id).hasExpression('duration'));
    const a = withF[Math.floor(withF.length / 2)], b = withF[Math.floor(withF.length / 3)], c = withF[1] ?? withF[0];
    const startOf = (id) => P.getModuleRef().getNoteById(id).getVariable('startTime').valueOf();
    const durOf = (id) => P.getModuleRef().getNoteById(id).getVariable('duration').valueOf();
    const plan = [
      ['octave up ' + a, () => P.emit('player:octaveChange', { noteId: a, direction: 'up' })],
      ['octave down ' + b, () => P.emit('player:octaveChange', { noteId: b, direction: 'down' })],
      ['octave up ' + a + ' again', () => P.emit('player:octaveChange', { noteId: a, direction: 'up' })],
      ['move ' + c, () => P.emit('workspace:noteMoveCommit', { noteId: c, newStartSec: startOf(c) + 0.25 })],
      ['resize ' + b, () => P.emit('workspace:noteResizeCommit', { noteId: b, newDurationSec: durOf(b) * 1.5 })],
      ['group move ' + [a, b], () => P.emit('workspace:groupMoveCommit', { ids: [a, b], deltaSec: 0.5 })],
      ['undo', () => P.emit('history:undo')],
      ['undo', () => P.emit('history:undo')],
      ['redo', () => P.emit('history:redo')],
      ['octave down ' + c, () => P.emit('player:octaveChange', { noteId: c, direction: 'down' })],
      ['undo', () => P.emit('history:undo')],
      ['undo', () => P.emit('history:undo')],
      ['undo', () => P.emit('history:undo')],
      ['redo', () => P.emit('history:redo')]
    ];
    const settle = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 50)));
    const out = [];
    for (const [label, act] of plan) {
      act();
      await settle();
      const saved = await readSaved();
      const fresh = JSON.stringify(mod().createModuleJSON());
      const R = window.__rmtRenderer;
      const labels = [(R._noteFracNumStrs || []).join('|'), (R._noteFracDenStrs || []).join('|')].join('#');
      out.push({
        label,
        autosave: await digest(saved),
        autosaveIsModule: saved === fresh,
        autosaveBytes: saved.length,
        undo: await digest(history._undo.map((e) => e.label + '\u0000' + e.snapshot).join('\u0001')),
        undoCount: history._undo.length,
        redo: await digest(history._redo.map((e) => e.label + '\u0000' + e.snapshot).join('\u0001')),
        render: [
          await digest(R.posSize), await digest(R.colors), await digest(R._instanceFlags),
          await digest(R._corruptionType), await digest(R._envShape),
          await digest(labels), await digest(R._noteLabelApprox || new Uint8Array(0)),
          String(R.instanceCount), String(R._maxNoteEndSec)
        ].join(' ')
      });
    }
    return out;
  });
  await page.context().close();
  return { steps, errors };
}

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'msedge' });
const before = await run(browser, BEFORE);
const after = await run(browser, AFTER);
await browser.close();

let failures = 0;
console.log(`${MODULE}, ${ENGINE}: ${BEFORE} (before) vs ${AFTER} (after)`);
for (let i = 0; i < Math.max(before.steps.length, after.steps.length); i++) {
  const x = before.steps[i], y = after.steps[i];
  const diffs = [];
  for (const k of ['autosave', 'undo', 'redo', 'render', 'undoCount']) if (!x || !y || x[k] !== y[k]) diffs.push(k);
  if (!x?.autosaveIsModule) diffs.push('before: autosave is not the module');
  if (!y?.autosaveIsModule) diffs.push('after: autosave is not the module');
  if (diffs.length) failures++;
  console.log(`  ${diffs.length ? 'FAIL' : 'PASS'}  ${String(i + 1).padStart(2)} ${(y || x).label.padEnd(28)} autosave ${y?.autosave?.slice(0, 8)} ${y?.autosaveBytes ?? "-"} B, undo ${y?.undoCount ?? '-'}${diffs.length ? '  — differs: ' + diffs.join(', ') : ''}`);
}
for (const [name, r] of [['before', before], ['after', after]]) if (r.errors.length) { failures++; console.log(`  FAIL  page errors (${name}): ${r.errors.slice(0, 3).join(' | ')}`); }
console.log(failures ? `\n${failures} step(s) differ` : '\nIdentical at every step');
process.exit(failures ? 1 : 0);
