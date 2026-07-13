/**
 * REPRO of the reviewer's claim:
 *   portrait -> open note widget -> DRAG it -> close it -> rotate to landscape (hidden!)
 *   -> tap a note again. Does the widget come back on screen?
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3000';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));

await page.addInitScript(() => {
  try {
    localStorage.removeItem('rmt:moduleSnapshot:v1');
    localStorage.removeItem('ui-state');
    localStorage.removeItem('rmt:settings:v1');
  } catch {}
});
await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
await page.waitForFunction(async () => {
  const { getModule } = await import('/src/store/app-state.js');
  return !!getModule();
}, null, { timeout: 60000 });
await page.waitForTimeout(900);

const openNoteWidget = async () => {
  const r = await page.evaluate(async () => {
    const { getModule } = await import('/src/store/app-state.js');
    const { modals } = await import('/src/modals/index.js');
    const m = getModule();
    if (!m) return 'no module';
    const note = Object.values(m.notes || {}).find((n) =>
      n && n.id !== 0 && n.variables && n.variables.duration && n.variables.frequency);
    if (!note) return 'no note';
    modals.showNoteVariables(note, document.body);
    return 'ok';
  });
  if (r !== 'ok') throw new Error(r);
  await page.waitForTimeout(300);
};

const state = () => page.evaluate(() => {
  const el = document.getElementById('note-widget');
  const r = el.getBoundingClientRect();
  return {
    visible: el.classList.contains('visible'),
    inlineTop: el.style.top || '(none)',
    inlineHeight: el.style.height || '(none)',
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  };
});

console.log('\n--- PORTRAIT 390x844 ---');
await openNoteWidget();
console.log('open (untouched):', JSON.stringify(await state()));

const h = await page.locator('.note-widget-header').boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 200, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
console.log('after drag down: ', JSON.stringify(await state()));

await page.locator('.note-widget-close').click();
await page.waitForTimeout(200);
console.log('after close:     ', JSON.stringify(await state()));

console.log('\n--- ROTATE to landscape 844x294 (widget hidden) ---');
await page.setViewportSize({ width: 844, height: 294 });
await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
await page.waitForTimeout(900);
console.log('while hidden:    ', JSON.stringify(await state()));

console.log('\n--- TAP A NOTE (showNoteVariables) ---');
await openNoteWidget();
const s = await state();
console.log('reopened:        ', JSON.stringify(s));

const vh = 294;
const onScreen = s.top >= 0 && s.bottom <= vh && s.h > 60;
console.log('\nRESULT: ' + (onScreen ? 'widget IS on screen -> claim REFUTED' : 'widget NOT usable on screen -> claim CONFIRMED'));
console.log(`  top=${s.top} bottom=${s.bottom} height=${s.h}  screen height=${vh}`);

await openNoteWidget();
console.log('after tapping another note:', JSON.stringify(await state()));

await page.screenshot({ path: 'C:/Users/zenon/AppData/Local/Temp/claude/c--GitHub-Projects-rmt-compose-poc/329c877a-685f-4da8-b9fa-e6003c1d1f46/scratchpad/repro-rot2.png' });
await ctx.close();
await browser.close();
