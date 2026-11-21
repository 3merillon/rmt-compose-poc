// Tails are display only (Phase I): pickAt, pickAllAt, hitTestSubRegion, the marquee, a drag and a resize
// give the same results with tails and every envelope drawn as without, on the canon and voices-5000.
// Needs the dev server: node scripts/perf/check-tails-display.mjs [http://localhost:3220/?perf=1]
import type { Page } from 'playwright';
import type { Score } from '../../src/model-types.ts';
declare global { interface Window { __tailsWanted: boolean } }
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const URL = process.argv[2] || 'http://localhost:3220/?perf=1';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
let fails = 0;
const check = (n: string, ok: boolean, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

async function session<T>(moduleJson: string|null, tails: boolean, act: (page: Page) => Promise<T>) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(([m, t]) => {
    if (!sessionStorage.getItem('__pk')) {
      sessionStorage.setItem('__pk', '1');
      if (m) localStorage.setItem('rmt:moduleSnapshot:v1', m); else localStorage.removeItem('rmt:moduleSnapshot:v1');
      const s = JSON.parse(localStorage.getItem('rmt:settings:v1') || 'null');
      window.__tailsWanted = t;
    }
  }, [moduleJson, tails] as [string | null, boolean]);
  await page.goto(URL);
  await page.waitForFunction(() => window.__rmtPerf?.getModuleRef?.() && (window.__rmtRenderer?.instanceCount ?? 0) > 0, null, { timeout: 60000 });
  await page.evaluate(async (t) => {
    const { settingsStore } = await import('/src/settings/settings-store.ts');
    settingsStore.set('appearance.envelopes', t ? 'all' : 'own'); settingsStore.set('appearance.showTails', t);
  }, tails);
  await page.waitForTimeout(800);
  const r = await act(page);
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.ts');
    settingsStore.set('appearance.envelopes', 'own'); settingsStore.set('appearance.showTails', false);
    localStorage.removeItem('rmt:moduleSnapshot:v1');
  });
  await page.context().close();
  return r;
}

const probe = (page: Page) => page.evaluate(() => {
  const r = window.__rmtRenderer!;
  const c = document.querySelector('canvas')!; const b = r._cachedCanvasRect || c.getBoundingClientRect();
  const picks = [], subs = [], rects = [];
  for (let i = 0; i <= 60; i++) for (let j = 0; j <= 40; j++) {
    const x = b.left + (b.width * i) / 60, y = b.top + (b.height * j) / 40;
    const p = r.pickAt(x, y); picks.push(p == null ? null : (p.id ?? p));
    const all = r.pickAllAt ? r.pickAllAt(x, y) : null; picks.push(all ? JSON.stringify(all) : null);
    const s = r.hitTestSubRegion(x, y); subs.push(s ? JSON.stringify(s) : null);
  }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 40; k++) {
    const x0 = b.left + rnd() * b.width, y0 = b.top + rnd() * b.height;
    rects.push(JSON.stringify(r.pickRect(x0, y0, x0 + rnd() * 400, y0 + rnd() * 300)));
  }
  return { picks, subs, rects, tails: r.tailCount };
});

// A real drag of a note's body and a real resize of its pull tab, then what the module wrote.
const gestures = (id: number) => async (page: Page) => {
  const pt = await page.evaluate((nid) => {
    const r = window.__rmtRenderer!, idx = r._noteIdToIndex!.get(nid)!;
    const ps = r.posSize!, m = r.matrix; // world -> page CSS px
    const wx = ps[idx * 4] + ps[idx * 4 + 2] * 0.4, wy = ps[idx * 4 + 1] + ps[idx * 4 + 3] * 0.5;
    const X = m[0] * wx + m[3] * wy + m[6], Y = m[1] * wx + m[4] * wy + m[7];
    // the pull tab: scan right along the note for the resize region
    let tab = null;
    for (let x = X; x < X + 2000 && !tab; x += 1) { const s = r.hitTestSubRegion(x, Y); if (s && s.region === 'tab') tab = [x, Y]; }
    return { body: [X, Y], tab };
  }, id);
  await page.mouse.move(pt.body[0], pt.body[1]); await page.mouse.down();
  await page.mouse.move(pt.body[0] + 60, pt.body[1], { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(500);
  let afterResize = null;
  if (pt.tab) {
    const tab = await page.evaluate((nid) => {
      const r = window.__rmtRenderer!, idx = r._noteIdToIndex!.get(nid)!, ps = r.posSize!, m = r.matrix;
      const wy = ps[idx * 4 + 1] + ps[idx * 4 + 3] * 0.5;
      for (let wx = ps[idx * 4]; wx < ps[idx * 4] + ps[idx * 4 + 2] * 1.2; wx += 0.05) {
        const X = m[0] * wx + m[3] * wy + m[6], Y = m[1] * wx + m[4] * wy + m[7];
        const s = r.hitTestSubRegion(X, Y); if (s && s.region === 'tab') return [X, Y];
      }
      return null;
    }, id);
    if (tab) {
      await page.mouse.move(tab[0], tab[1]); await page.mouse.down();
      await page.mouse.move(tab[0] + 45, tab[1], { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(500);
    }
  }
  return page.evaluate(() => JSON.stringify(window.__rmtPerf!.getModuleRef()!.createModuleJSON()));
};

for (const [name, json] of [['canon', null], ['voices-5000', readFileSync('public/modules/perf/voices-5000.json', 'utf8')]] as const) {
  const off = await session(json, false, probe), on = await session(json, true, probe);
  check(`${name}: tails drawn when on (${on.tails}), none when off (${off.tails})`, on.tails > 0 && off.tails === 0);
  check(`${name}: pickAt and pickAllAt at 2501 points identical`, JSON.stringify(off.picks) === JSON.stringify(on.picks), `${off.picks.filter(Boolean).length} hits`);
  check(`${name}: hitTestSubRegion at 2501 points identical`, JSON.stringify(off.subs) === JSON.stringify(on.subs), `${off.subs.filter(Boolean).length} hits`);
  check(`${name}: 40 marquee rectangles identical`, JSON.stringify(off.rects) === JSON.stringify(on.rects));
}
{
  const a = await session(null, false, gestures(10)), b = await session(null, true, gestures(10));
  const untouched = await session(null, false, (page: Page) => page.evaluate(() => JSON.stringify(window.__rmtPerf!.getModuleRef()!.createModuleJSON())));
  const n10 = (j: string) => JSON.stringify((JSON.parse(j) as Score).notes.find((n) => n.id === 10) || null);
  check('canon: the gestures did change note 10', a !== untouched, `before ${n10(untouched)} after ${n10(a)}`);
  check('canon: a drag and a resize of note 10 write the same module with tails on as off', a === b, `${a.length} chars`);
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll display-only checks passed.');
process.exit(fails ? 1 : 0);
