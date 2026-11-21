#!/usr/bin/env node
// Run against the dev server: node scripts/perf/check-measure-module-drops.mjs [url]
import type { Note } from '../../src/note.ts';
import type { Score } from '../../src/model-types.ts';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: process.env.RMT_BROWSER_CHANNEL || undefined });
try {
  const page = await browser.newPage();
  await page.goto((process.argv[2] || 'http://localhost:3000') + '/?perf=1');
  await page.waitForFunction(() => (window.__rmtRenderer?.instanceCount ?? 0) > 0);
  const targets = await page.evaluate(() => {
    const notes = Object.values(window.__rmtPerf!.getModuleRef()!.notes);
    return [0, notes.find(n => n.id && n.hasExpression('frequency'))!.id, notes.find(n => n.properties.measure)!.id];
  });
  const phrase = {
    baseNote: { frequency: '220', startTime: '0', duration: '1' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' },
      { id: 2, startTime: 'base.t + base.d * 2', duration: 'base.d * 4', measure: true },
      { id: 3, startTime: '[2].t + [2].d / 2', duration: '[2].d', measure: true },
      { id: 4, startTime: '[2].t + [2].d * 2', duration: '[1].d', measure: true },
    ],
  };
  async function drop(target: number, data: Score) {
    const prior = await page.evaluate(async ({ target, data }) => {
      const mod = window.__rmtPerf!.getModuleRef()!;
      const max = Math.max(...Object.keys(mod.notes).map(Number));
      const { eventBus } = await import('/src/utils/event-bus.ts');
      eventBus.emit('player:importModuleAtTarget', { targetNoteId: target, moduleData: data });
      return max;
    }, { target, data });
    await page.waitForFunction(max => window.__rmtPerf!.getModuleRef()!.notes[max + 4], prior);
    return prior + 1;
  }
  const first = await drop(0, phrase);
  await page.evaluate(async first => {
    const { eventBus } = await import('/src/utils/event-bus.ts');
    eventBus.emit('workspace:marqueeCommit', { ids: [first, first + 1, first + 2, first + 3] });
  }, first);
  await page.click('#group-widget [data-action="copy-to-modules"]');
  const copy = await page.locator('.icon[data-name="Selection (1 note and 3 measures)"]').evaluate(el => (el as HTMLElement & { moduleData: Score }).moduleData);
  assert.deepEqual(copy.notes.map(n => !!n.measure), [false, true, true, true]);
  await page.locator('.group-widget-close').click();
  assert.equal(await page.locator('.library-drop-end-btn').getAttribute('aria-pressed'), 'true');
  for (const end of [true, false]) {
    if (!end) await page.locator('.library-drop-start-btn').click();
    for (const target of targets) {
      const first = await drop(target, copy);
      const got = await page.evaluate(({ target, first, end }) => {
        const mod = window.__rmtPerf!.getModuleRef()!;
        const anchor = mod.getNoteById(target)!;
        const val = (n: Note, key: 'duration' | 'frequency' | 'startTime') => Number(n.getVariable(key)!.valueOf());
        const t0 = val(anchor, 'startTime') + (end && target !== 0 ? val(anchor, 'duration') : 0);
        const unit = val(mod.baseNote, 'duration');
        const notes = [0, 1, 2, 3].map(i => mod.getNoteById(first + i)!);
        return {
          offsets: notes.map(n => (val(n, 'startTime') - t0) / unit),
          durations: notes.map(n => val(n, 'duration') / unit),
          parents: notes.slice(1).map(n => n.parentId),
          flags: notes.map(n => !!n.properties.measure),
          pitchRatio: val(notes[0], 'frequency') / val(anchor.properties.measure ? mod.baseNote : anchor, 'frequency'),
        };
      }, { target, first, end });
      assert.deepEqual(got.offsets.map(n => Math.round(n * 1e8) / 1e8), [0, 2, 4, 10]);
      assert.deepEqual(got.durations, [1, 4, 4, 1]);
      assert.deepEqual(got.parents, [target, first + 1, first + 1]);
      assert.deepEqual(got.flags, [false, true, true, true]);
      assert.equal(got.pitchRatio, 1);
    }
  }
  console.log('Mixed note/measure copy passed all six start/end and note/measure/BaseNote drops.');
} finally {
  await browser.close();
}
