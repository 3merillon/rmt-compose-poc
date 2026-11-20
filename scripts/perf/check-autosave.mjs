#!/usr/bin/env node
/**
 * The autosave (src/store/autosave.js) in the running app: headless Edge, a dev server.
 *
 *   node scripts/perf/check-autosave.mjs [--url http://localhost:3220] [--big voices-100000]
 *
 * A session in localStorage opens and moves to IndexedDB; an edit is saved after
 * its frame, and edits in one task make one write; a reload restores the module,
 * also one that starts right after an edit; undo is saved; a cleared autosave
 * opens the default module; without IndexedDB the autosave uses localStorage;
 * and a module too large for localStorage (--big, from public/modules/perf/) is
 * saved and restored. Exit 1 on any failure.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3220');
const BIG = flag('--big', 'voices-100000');
const perfFile = (name) => join(here, '..', '..', 'public', 'modules', 'perf', `${name}.json`);

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'msedge' });

async function open({ inject = null, defaultBody = null, noIndexedDB = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/wake lock/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(({ inject, noIndexedDB }) => {
    // Count the autosave's writes
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) {
      if (this.name !== 'autosave') return put.apply(this, a);
      window.__autosavePuts = (window.__autosavePuts || 0) + 1;
      window.__lastPutAt = performance.now();
      const t0 = performance.now();
      try { return put.apply(this, a); } finally { window.__lastPutMs = performance.now() - t0; }
    };
    if (noIndexedDB) { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch {} }
    if (inject && !sessionStorage.getItem('__injected')) {
      sessionStorage.setItem('__injected', '1');
      localStorage.setItem('rmt:moduleSnapshot:v1', inject);
    }
  }, { inject, noIndexedDB });
  if (defaultBody) await page.route('**/modules/defaultModule.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: defaultBody }));
  const ready = () => page.waitForFunction(() => window.__rmtPerf?.getModuleRef?.() && window.__rmtRenderer?.instanceCount > 0, null, { timeout: 300_000 });
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await ready();
  await page.evaluate(async () => {
    window.__A = await import('/src/store/autosave.js');
    window.__live = () => JSON.stringify(window.__rmtPerf.getModuleRef().createModuleJSON());
    window.__saved = async () => { await window.__A.whenSaved(); return window.__A.readSavedModuleText(); };
    window.__idb = () => new Promise((resolve) => {
      const r = indexedDB.open('rmt-compose');
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('autosave')) { db.close(); resolve(null); return; }
        const g = db.transaction('autosave').objectStore('autosave').get('module');
        g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
        g.onerror = () => { db.close(); resolve(null); };
      };
      r.onerror = () => resolve(null);
    });
    window.__freqNote = () => {
      const m = window.__rmtPerf.getModuleRef();
      const ids = Object.keys(m.notes).map(Number).filter((id) => id !== 0 && m.getNoteById(id).hasExpression('frequency') && m.getNoteById(id).hasExpression('duration'));
      return ids[Math.floor(ids.length / 2)];
    };
  });
  const reload = async () => {
    await page.reload({ waitUntil: 'load' });
    await ready();
    await page.evaluate(async () => {
      window.__A = await import('/src/store/autosave.js');
      window.__live = () => JSON.stringify(window.__rmtPerf.getModuleRef().createModuleJSON());
      window.__saved = async () => { await window.__A.whenSaved(); return window.__A.readSavedModuleText(); };
    });
  };
  return { ctx, page, errors, reload };
}

const small = readFileSync(join(here, '..', '..', 'public', 'modules', 'perf', 'chain-1000.json'), 'utf8');

console.log('A session in localStorage, edits, reloads');
{
  const { ctx, page, errors, reload } = await open({ inject: small });
  const first = await page.evaluate(async () => {
    await window.__A.whenSaved();
    return { notes: Object.keys(window.__rmtPerf.getModuleRef().notes).length, ls: localStorage.getItem('rmt:moduleSnapshot:v1'), idb: await window.__idb(), live: window.__live() };
  });
  check('the module in localStorage opens', first.notes === JSON.parse(small).notes.length + 1, `${first.notes} notes`);
  check('…and moves to IndexedDB as it was saved: the localStorage copy is gone', first.ls === null && first.idb === small, `IndexedDB holds ${first.idb ? first.idb.length : 0} chars`);

  const id = await page.evaluate(() => window.__freqNote());
  const edit = await page.evaluate(async (id) => {
    const before = window.__autosavePuts || 0;
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' });
    // A write started by the edit would reach put() within a few microtasks (the database is open)
    for (let i = 0; i < 10; i++) await null;
    const startedDuringEdit = (window.__autosavePuts || 0) - before;
    const saved = await window.__saved();
    return { startedDuringEdit, same: saved === window.__live(), puts: (window.__autosavePuts || 0) - before };
  }, id);
  check('an edit is not written during the edit, and is written after', edit.startedDuringEdit === 0 && edit.same && edit.puts === 1, `${edit.puts} write(s)`);

  const burst = await page.evaluate(async (id) => {
    const before = window.__autosavePuts || 0;
    for (let i = 0; i < 10; i++) window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: i % 2 ? 'up' : 'down' });
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' });
    const saved = await window.__saved();
    return { same: saved === window.__live(), puts: (window.__autosavePuts || 0) - before };
  }, id);
  check('eleven edits in one task make one write, of the last state', burst.same && burst.puts === 1, `${burst.puts} write(s)`);

  const before = await page.evaluate(() => window.__live());
  await reload();
  const after = await page.evaluate(() => ({ live: window.__live(), ls: localStorage.getItem('rmt:moduleSnapshot:v1') }));
  check('a reload restores the module from IndexedDB', after.live === before && after.ls === null);

  // A reload that starts in the same task as an edit: beforeunload saves the module at once
  const expected = await page.evaluate((id) => {
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'down' });
    const text = window.__live();
    setTimeout(() => location.reload(), 0);
    return text;
  }, id);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__rmtPerf?.getModuleRef?.() && window.__rmtRenderer?.instanceCount > 0, null, { timeout: 300_000 });
  await page.evaluate(async () => { window.__A = await import('/src/store/autosave.js'); });
  const kept = await page.evaluate(() => JSON.stringify(window.__rmtPerf.getModuleRef().createModuleJSON()));
  check('an edit followed at once by a reload survives it', kept === expected);

  const undo = await page.evaluate(async (id) => {
    window.__live = () => JSON.stringify(window.__rmtPerf.getModuleRef().createModuleJSON());
    window.__saved = async () => { await window.__A.whenSaved(); return window.__A.readSavedModuleText(); };
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' });
    await window.__saved();
    const edited = window.__live();
    window.__rmtPerf.emit('history:undo');
    for (let i = 0; i < 100 && window.__live() === edited; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    const saved = await window.__saved();
    return { undone: window.__live() !== edited, same: saved === window.__live() };
  }, id);
  check('an undo is saved', undo.undone && undo.same);

  await page.evaluate(async () => { await window.__A.clearSavedModule({ hold: true }); location.reload(); });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__rmtPerf?.getModuleRef?.() && window.__rmtRenderer?.instanceCount > 0, null, { timeout: 300_000 });
  const fresh = await page.evaluate(() => Object.keys(window.__rmtPerf.getModuleRef().notes).length);
  check('a cleared autosave (the perf harness\'s restoreDefault) opens the default module', fresh < 500, `${fresh} notes`);

  const unl = await page.evaluate(async () => {
    const A = await import('/src/store/autosave.js');
    const where = await A.keepUnloadable('{"probe":1}');
    return where;
  });
  check('a session that cannot be loaded is kept in IndexedDB', /IndexedDB/.test(unl || ''), unl || 'nowhere');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

console.log('\nWithout IndexedDB');
{
  const { ctx, page, errors, reload } = await open({ inject: small, noIndexedDB: true });
  const id = await page.evaluate(() => window.__freqNote());
  const r = await page.evaluate(async (id) => {
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' });
    await window.__A.whenSaved();
    return { same: localStorage.getItem('rmt:moduleSnapshot:v1') === window.__live(), live: window.__live() };
  }, id);
  check('the autosave falls back to localStorage', r.same);
  await reload();
  check('…and a reload restores it', (await page.evaluate(() => window.__live())) === r.live);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (existsSync(perfFile(BIG))) {
  console.log(`\nA module too large for localStorage (${BIG})`);
  const body = readFileSync(perfFile(BIG), 'utf8');
  const { ctx, page, errors, reload } = await open({ defaultBody: body });
  const id = await page.evaluate(() => window.__freqNote());
  const r = await page.evaluate(async (id) => {
    const tEdit = performance.now();
    window.__rmtPerf.emit('player:octaveChange', { noteId: id, direction: 'up' });
    const t0 = performance.now();
    const saved = await window.__saved();
    return { edit: t0 - tEdit, startedAfter: window.__lastPutAt - t0, putMs: window.__lastPutMs, ms: performance.now() - t0, same: saved === window.__live(), chars: saved ? saved.length : 0, notes: Object.keys(window.__rmtPerf.getModuleRef().notes).length, live: window.__live() };
  }, id);
  check(`an edit of ${r.notes} notes is saved`, r.same, `${(r.chars / 1e6).toFixed(1)} M chars; edit ${r.edit.toFixed(0)} ms, write started ${r.startedAfter.toFixed(0)} ms after it, put() held the main thread ${r.putMs.toFixed(1)} ms, landed ${r.ms.toFixed(0)} ms after the edit`);
  await reload();
  check('…and a reload restores it (not the module the server serves)', (await page.evaluate(() => window.__live())) === r.live);
  check('no page errors (no quota errors)', errors.length === 0, errors.slice(0, 2).map((e) => e.slice(0, 120)).join(' | '));
  await ctx.close();
} else {
  console.log(`\n(${BIG}.json not generated: npm run perf:gen; skipped the large module)`);
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll autosave checks passed');
process.exit(failures ? 1 : 0);
