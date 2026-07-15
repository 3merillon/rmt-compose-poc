#!/usr/bin/env node
/**
 * Renders the same notes with the octave arrows on and off, so the label reflow into the
 * freed column can be checked by eye.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/arrows';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 650 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.removeItem('rmt:moduleSnapshot:v1'); } catch {} });
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForTimeout(1500);

await page.evaluate(() => { const c = window.__rmtWorkspace.camera; c.scale = 4.5; c.tx -= 250; c.onChange(); });
await page.waitForTimeout(400);

async function shoot(enabled, name) {
  await page.evaluate((en) => {
    window.__rmtRenderer.setDrawNoteArrows(en);
  }, enabled);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
  const buf = await page.locator('canvas').first().screenshot();
  writeFileSync(join(OUT, name), buf);

  // Magnified crop of a note's left edge so the reflow is unmistakable.
  const p = PNG.sync.read(buf);
  const X = 300, Y = 270, W = 240, H = 70, Z = 3;
  const o = new PNG({ width: W * Z, height: H * Z });
  for (let yy = 0; yy < H * Z; yy++) for (let xx = 0; xx < W * Z; xx++) {
    const si = ((Y + Math.floor(yy / Z)) * p.width + (X + Math.floor(xx / Z))) * 4;
    const di = (yy * o.width + xx) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1];
    o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  writeFileSync(join(OUT, name.replace('.png', '-zoom.png')), PNG.sync.write(o));
  console.log(`  wrote ${name}`);
}

await shoot(true, 'arrows-on.png');
await shoot(false, 'arrows-off.png');
await browser.close();
