#!/usr/bin/env node
// Replay docs/getting-started/first-composition.md against one or more Vite dev servers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, type Locator } from 'playwright';
import type { AudioEngine } from '../../src/player/audio-engine.ts';
import type { history } from '../../src/store/history.ts';

const origins = process.argv.slice(2);
if (!origins.length) throw new Error('Pass a Vite dev server URL, optionally followed by comparison URLs.');
const browser = await chromium.launch({ channel: process.env.RMT_BROWSER_CHANNEL || undefined });
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

async function run(url: string, touch: boolean) {
  const context = await browser.newContext({
    hasTouch: touch, isMobile: touch, viewport: {width: 1366, height: 864}, acceptDownloads: true,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const press = (target: Locator) => touch ? target.tap() : target.click();
    await page.goto(url + '/?perf=1');
    await page.waitForFunction(() => window.__rmtRenderer?.instanceCount && window.__rmtPerf?.getModuleRef()?.notes[11]);
    const sourceURL = async (stem: string) => page.evaluate(stem => {
      const entry = performance.getEntriesByType('resource').find(e =>
        new URL(e.name).pathname.replace(/\.(?:ts|js)$/, '') === '/src/' + stem);
      if (!entry) throw new Error('Unloaded module ' + stem);
      return entry.name;
    }, stem);
    const audioURL = await sourceURL('player/audio-engine');
    const historyURL = await sourceURL('store/history');
    const play = async () => {
      await press(page.locator('#playPauseBtn'));
      // Sample the sounding master bus, including the answering voice at 2.4 s.
      const peak = await page.evaluate(async url => {
        const {audioEngine}: {audioEngine: AudioEngine} = await import(url);
        const {audioContext, generalVolumeGainNode} = audioEngine.nodes();
        const analyser = audioContext.createAnalyser();
        generalVolumeGainNode.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let max = 0;
        try {
          const until = performance.now() + 2600;
          do {
            await new Promise(resolve => setTimeout(resolve, 24));
            analyser.getFloatTimeDomainData(samples);
            for (const sample of samples) max = Math.max(max, Math.abs(sample));
          } while (performance.now() < until);
          return max;
        } finally { generalVolumeGainNode.disconnect(analyser); }
      }, audioURL);
      assert.ok(peak > 0.0001, 'expected audible output on master gain');
      await press(page.locator('#stopButton'));
      return peak;
    };
    const pick = async (id: number) => {
      const point = await page.evaluate(id => {
        const r = window.__rmtRenderer!, w = window.__rmtWorkspace!;
        const index = r._noteIdToIndex.get(id);
        if (index === undefined || !r.posSize) throw new Error('Missing rectangle for ' + id);
        const origin = index * 4;
        const y = r.matrix[4] * (r.posSize[origin + 1] + r.posSize[origin + 3] / 2) + r.matrix[7];
        for (const portion of [0.5, 0.4, 0.65, 0.3, 0.75]) {
          const x = r.matrix[0] * (r.posSize[origin] + portion * r.posSize[origin + 2]) + r.matrix[6];
          if (document.elementFromPoint(x,y)?.closest('.myspaceapp') && w.pickAt(x,y,0)?.id === id) return {x,y};
        }
        throw new Error('No visible note body for ' + id);
      }, id);
      if (touch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x,point.y);
      await page.waitForFunction(id => document.getElementById('note-widget-title')?.textContent?.includes('[' + id + ']'), id);
    };
    const field = (name: string) => page.locator('.variable-row').filter({has: page.locator('.variable-name', {hasText: new RegExp('^' + name + '$')})});
    const times = async () => page.evaluate(() => {
      const m = window.__rmtPerf!.getModuleRef()!;
      return [m.notes[10].getVariable('duration')!.toFraction(), m.notes[11].getVariable('startTime')!.toFraction()];
    });
    const checkpoints = async () => page.evaluate(async url => {
      const state: {history: typeof history} = await import(url);
      return state.history._undo.map(entry => ({ label: entry.label, text: entry.snapshot }));
    }, historyURL);
    const opening = await play();
    await pick(11);
    assert.equal(await field('startTime').locator('.raw-value-input').inputValue(), '[10].t + [10].d');
    assert.deepEqual(await times(), ['3/20', '3/10']);
    await press(page.locator('.note-widget-close'));
    await pick(10);
    await field('duration').locator('.raw-value-input').fill('base.d');
    await press(field('duration').locator('.raw-value-save'));
    await page.waitForFunction(() => window.__rmtPerf!.getModuleRef()!.notes[11].getVariable('startTime')!.toFraction() === '3/4');
    assert.deepEqual(await times(), ['3/5', '3/4']);
    await press(page.locator('.note-widget-close'));
    const edited = await play();
    const historyBeforeSave = (await checkpoints()).map(entry => ({label: entry.label, sha256: digest(entry.text)}));
    await press(page.locator('.dropdown-button'));
    const downloadPending = page.waitForEvent('download');
    await press(page.locator('#saveModuleBtn'));
    const download = await downloadPending;
    assert.equal(download.suggestedFilename(), 'module.json');
    const path = await download.path();
    assert.ok(path);
    const bytes = await readFile(path);
    if (!await page.locator('#undoBtn').isVisible()) await press(page.locator('.dropdown-button'));
    await press(page.locator('#undoBtn'));
    await page.waitForFunction(() => window.__rmtPerf!.getModuleRef()!.notes[11].getVariable('startTime')!.toFraction() === '3/10');
    await page.locator('#loadModuleInput').setInputFiles({name: 'module.json', mimeType: 'application/json', buffer: bytes});
    await page.waitForFunction(() => window.__rmtPerf!.getModuleRef()!.notes[11].getVariable('startTime')!.toFraction() === '3/4');
    assert.deepEqual(await times(), ['3/5', '3/4']);
    assert.deepEqual(errors, []);
    const comparable = { saved: digest(bytes), history: historyBeforeSave };
    console.log(JSON.stringify({url, touch, openingPeak: opening, editedPeak: edited, ...comparable}));
    return comparable;
  } finally { await context.close(); }
}

try {
  for (const touch of [false, true]) {
    let reference: Awaited<ReturnType<typeof run>> | undefined;
    for (const url of origins) {
      const result = await run(url.replace(/\/$/, ''), touch);
      if (reference) assert.deepEqual(result, reference);
      else reference = result;
    }
  }
} finally { await browser.close(); }
