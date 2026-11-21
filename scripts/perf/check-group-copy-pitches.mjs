#!/usr/bin/env node
// Run against Vite dev or preview: node scripts/perf/check-group-copy-pitches.mjs [url]
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4175';
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.RMT_BROWSER_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

async function loadFile(page, data) {
  await page.locator('#loadModuleInput').setInputFiles({
    name: 'phrase.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.waitForFunction(ids => {
    const notes = window.__rmtWorkspace._module.notes;
    return Object.keys(notes).length === ids.length + 1 && ids.every(id => notes[id]);
  }, data.notes.map(n => n.id));
}

function pitches(page, ids) {
  return page.evaluate(ids => ids.map(id =>
    Number(window.__rmtWorkspace._module.notes[id].getVariable('frequency').valueOf())), ids);
}

// Find the actual canvas target under the pointer, away from tabs and transpose arrows.
async function pointOfNote(page, id) {
  const point = await page.evaluate(id => {
    const w = window.__rmtWorkspace;
    const r = window.__rmtRenderer;
    for (let y = 160; y < innerHeight - 20; y += 6) {
      for (let x = 15; x < innerWidth - 15; x += 12) {
        const hit = w.pickAt(x, y, 0);
        if (hit?.id !== id || !document.elementFromPoint(x, y)?.closest('.myspaceapp')) continue;
        if (hit.type === 'base' || r.hitTestSubRegion(x, y, hit)?.region === 'body') return { x, y };
      }
    }
  }, id);
  assert.ok(point, 'expected a visible target for note ' + id);
  return point;
}

async function clickNote(page, id) {
  const { x, y } = await pointOfNote(page, id);
  await page.mouse.click(x, y);
}

async function copyPair(page) {
  await page.keyboard.down('Shift');
  await clickNote(page, 21);
  await clickNote(page, 22);
  await page.keyboard.up('Shift');
  await page.click('#group-widget [data-action="copy-to-modules"]');
  return page.locator('.icon[data-category="custom"][data-name="Selection (2 notes)"]');
}

for (const [name, baseFrequency, lastFrequency, editId] of [
  ['uncopied pitch anchor of the BaseNote', '[20].f', 'base.f * 2', 0],
  ['spaced reference inside the copied group', '330', '[ 21 ].f * 2', 1],
]) {
  test(name, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(url + '/?perf=1');
      await page.waitForFunction(() => window.__rmtRenderer?.instanceCount > 0);
      await loadFile(page, {
        baseNote: { frequency: baseFrequency, startTime: '0', duration: '1' },
        notes: [
          { id: 20, startTime: '0', duration: '1', frequency: '330' },
          { id: 21, startTime: '1', duration: 'base.d', frequency: 'base.f' },
          { id: 22, startTime: '2', duration: 'base.d', frequency: lastFrequency },
        ],
      });
      assert.deepEqual(await pitches(page, [21, 22]), [330, 660]);

      const tile = await copyPair(page);
      await page.reload();
      const copy = await tile.evaluate(el => el.moduleData);
      assert.deepEqual(copy.notes.map(n => n.id), [1, 2]);
      await loadFile(page, copy);
      assert.deepEqual(await pitches(page, [1, 2]), [330, 660], 'pitches after reopening the library copy');

      await clickNote(page, editId);
      const frequency = page.locator('#note-widget .variable-row').filter({
        has: page.locator('.variable-name', { hasText: /^frequency$/ }),
      });
      await frequency.locator('.raw-value-input').fill('350');
      await frequency.getByRole('button', { name: 'Save' }).click();
      assert.deepEqual(await pitches(page, [1, 2]), [350, 700], 'the copied pitch relationship stays editable');
    } finally {
      await page.close();
    }
  });
}

test('library drop remaps a commented reference past a colliding host ID', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url + '/?perf=1');
    await page.waitForFunction(() => window.__rmtRenderer?.instanceCount > 0);
    await loadFile(page, {
      baseNote: { frequency: '330', startTime: '0', duration: '1' },
      notes: [
        { id: 1, startTime: '0', duration: '1', frequency: '110' },
        { id: 21, startTime: '1', duration: '1', frequency: 'base.f' },
        { id: 22, startTime: '2', duration: '1', frequency: '[ # phrase root\n21 ].f * 2' },
      ],
    });
    const tile = await copyPair(page);
    const copy = await tile.evaluate(el => el.moduleData);
    assert.deepEqual(copy.notes.map(n => n.id), [1, 2]);
    assert.match(copy.notes[1].frequency, /# phrase root\s+1\s*\]/);
    await page.click('[data-action="clear-selection"]');

    const pull = await page.locator('.pull-tab').boundingBox();
    await page.mouse.move(pull.x + pull.width / 2, pull.y + pull.height / 2);
    await page.mouse.down();
    await page.mouse.move(pull.x + pull.width / 2, 280, { steps: 10 });
    await page.mouse.up();
    await tile.scrollIntoViewIfNeeded();
    const target = await pointOfNote(page, 0);
    const canvas = page.locator('.myspaceapp');
    const bounds = await canvas.boundingBox();
    await tile.dragTo(canvas, { targetPosition: { x: target.x - bounds.x, y: target.y - bounds.y } });

    await page.waitForFunction(() => window.__rmtWorkspace._module.notes[24]);
    assert.deepEqual(await pitches(page, [1, 23, 24]), [110, 330, 660]);
    const refs = await page.evaluate(() => [...window.__rmtWorkspace._module.notes[24].getAllDependencies()]);
    assert.deepEqual(refs, [23], 'the imported child reads the imported root');
  } finally {
    await page.close();
  }
});
