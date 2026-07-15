#!/usr/bin/env node
/**
 * Mobile viewport: does the app lay itself out inside the screen it ACTUALLY has?
 *
 * The app is `overflow: hidden`, so the document never scrolls, so a mobile browser never
 * collapses its URL bar. Three things went wrong because of that, and each scenario below
 * pins one of them.
 *
 *   1. The screen is genuinely short. A landscape phone leaves ~200px between the top bar
 *      and the bottom edge, and every panel has to fit in it. A short window reproduces
 *      this exactly — no tricks needed.
 *
 *   2. `100vh` is not the screen. By spec `vh` is the LARGE viewport — the page as it
 *      would be *if* the URL bar collapsed — so the "+" menu's
 *      `max-height: calc(100vh - 100px)` was permanently taller than the phone and its
 *      footer sat below the fold.
 *
 *   3. The browser lies at boot. Loading straight into landscape, a phone can report a
 *      viewport its chrome has not taken its cut of yet — and the note widget's fit was
 *      SELF-REFERENTIAL (bottom-anchored, so `viewportHeight() - rect.top` is just the
 *      height it already had), so it inherited a bogus boot-time size and only snapped
 *      right when you touched it, which broke the self-reference.
 *
 * Playwright renders no browser chrome, so the `vh` gap in (2) cannot be produced
 * end-to-end. It is tested as two links instead: scenario 3 proves the app measures the
 * true layout viewport even when every API lies, and scenario 2 proves the CSS that used
 * to say `100vh` now follows that measurement.
 *
 *   npm run dev            # in another terminal
 *   node scripts/perf/shot-mobile-viewport.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/mobile-viewport';
mkdirSync(OUT, { recursive: true });

// What a mobile browser's info bar typically steals.
const CHROME_PX = 96;

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });

async function newPage({ width, height, liesBy = 0, touch = true }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  !! console.error:', m.text()); });

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');
    } catch {}
  });

  // A browser that LIES about the viewport: every API the app can ask reports `liesBy`
  // px MORE height than the screen really has, forever, and no resize is ever fired to
  // correct it. This is the boot-into-landscape case, taken to its worst: the real
  // window is `height` tall (and `position: fixed` still anchors to it, exactly as on a
  // phone), but every number the app is handed is wrong. Anything that survives this
  // survives because it MEASURED, not because it was told.
  if (liesBy > 0) {
    await page.addInitScript((lie) => {
      const innerDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight')
        || Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        get: () => innerDesc.get.call(window) + lie,
      });

      // This runs at document-start, so document.documentElement does not exist yet —
      // patch the getter on Element.prototype and lie only for the root element.
      const rootDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
      Object.defineProperty(Element.prototype, 'clientHeight', {
        configurable: true,
        get() {
          const real = rootDesc.get.call(this);
          return this === document.documentElement ? real + lie : real;
        },
      });

      const vv = window.visualViewport;
      if (vv) {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          get: () => ({
            get width() { return vv.width; },
            get height() { return vv.height + lie; },
            get scale() { return vv.scale; },
            get offsetTop() { return vv.offsetTop; },
            get offsetLeft() { return vv.offsetLeft; },
            addEventListener: vv.addEventListener.bind(vv),
            removeEventListener: vv.removeEventListener.bind(vv),
          }),
        });
      }
    }, liesBy);
  }

  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}

const shoot = async (page, name) => {
  await page.waitForTimeout(220);
  writeFileSync(join(OUT, name + '.png'), await page.screenshot());
};

// Every measurement is taken against the USABLE height (what the app can see), never
// against the window — that difference is the whole bug.
const boxOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    h: Math.round(r.height), w: Math.round(r.width),
    maxHeight: cs.maxHeight, display: cs.display,
    usableH: window.innerHeight, usableW: window.innerWidth,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  };
}, selector);

// Open the note-variables widget on a real note, through the exact call a click ends
// in (`modals.showNoteVariables` -> `updateNoteWidgetHeight`). Driving it by synthetic
// click instead makes this a test of the picker and the click-suppression heuristics,
// which is not what is on trial here — the widget's GEOMETRY is.
const openNoteWidget = async (page) => {
  const opened = await page.evaluate(async () => {
    const { getModule } = await import('/src/store/app-state.js');
    const { modals } = await import('/src/modals/index.js');
    const m = getModule();
    if (!m) return 'no module';
    // A real note, not a measure bar (no duration/frequency) and not the base note.
    const note = Object.values(m.notes || {}).find((n) =>
      n && n.id !== 0 && n.variables && n.variables.duration && n.variables.frequency);
    if (!note) return 'no note';
    modals.showNoteVariables(note, document.body);
    return 'ok';
  });
  if (opened !== 'ok') throw new Error(`could not open the note widget: ${opened}`);
  await page.waitForTimeout(400);
  const visible = await page.evaluate(() =>
    document.getElementById('note-widget').classList.contains('visible'));
  if (!visible) throw new Error('showNoteVariables ran but the widget is not visible');
};

// ─────────────────────────────── Scenario 1: a genuinely short landscape screen ────
console.log(`\n== landscape phone, 844x294 (a real phone's usable height in landscape)`);
{
  const { ctx, page } = await newPage({ width: 844, height: 294 });
  const vh = 294;

  // The "+" menu.
  await page.tap('.dropdown-button');
  await page.waitForTimeout(500);
  const menu = await boxOf(page, '#general-widget');
  console.log('  menu ' + JSON.stringify(menu));
  check('landscape: the "+" menu fits on the screen',
    menu.bottom <= vh, `bottom=${menu.bottom} (usable height=${vh}, max-height=${menu.maxHeight})`);
  await shoot(page, '01-landscape-menu');
  await page.tap('.dropdown-button');
  await page.waitForTimeout(400);

  // The note-variables widget — the 300px floor lived here.
  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('landscape: the note-variables widget fits on the screen',
    note.top >= 0 && note.bottom <= vh,
    `top=${note.top} bottom=${note.bottom} height=${note.h} (usable height=${vh})`);
  check('landscape: the note widget clears the top bar',
    note.top >= 50, `top=${note.top}`);
  await shoot(page, '02-landscape-note-widget');

  // The settings panel.
  await page.tap('#settingsGearBtn');
  await page.waitForTimeout(500);
  const set = await boxOf(page, '.rmt-set-panel');
  console.log('  settings ' + JSON.stringify(set));
  check('landscape: the settings panel fits on the screen',
    set.top >= 50 && set.bottom <= vh,
    `top=${set.top} bottom=${set.bottom} height=${set.h} (usable height=${vh})`);
  await shoot(page, '03-landscape-settings');

  // The module-library bar can never be taller than the screen minus the top bar.
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.second-top-bar');
    const r = b.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), h: Math.round(r.height) };
  });
  check('landscape: the module-library bar stays on the screen',
    bar.bottom <= vh, `bottom=${bar.bottom} (usable height=${vh})`);

  await ctx.close();
}

// ───────────────────────────────── Scenario 2: the `vh` trap, and the CSS binding ────
//
// A real URL bar makes the LARGE viewport (what `vh` means) taller than the layout
// viewport (what you can see). Playwright renders no browser chrome, so it cannot
// produce that gap — and stubbing the viewport APIs no longer fakes it either, because
// the app stopped trusting those APIs and now measures the layout itself (scenario 3
// proves it does so even against a browser that lies outright).
//
// So test the two links in the chain separately. Scenario 3 proves link one: the app
// measures the true layout viewport. Here we prove link two: the chrome that used to be
// sized in `vh` now follows that measurement. Drive `--app-height` down to what a URL bar
// would leave and the "+" menu's cap must follow it — the old `100vh` rule could not.
console.log('\n== portrait 390x844 — the "+" menu must follow the measured viewport, not 100vh');
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });

  const wired = await page.evaluate(() => ({
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
    inner: window.innerHeight,
  }));
  check('with no browser chrome, the measured viewport IS the window',
    wired.appHeight === '844px' && wired.inner === 844,
    `--app-height=${wired.appHeight}, innerHeight=${wired.inner}`);

  await page.tap('.dropdown-button');
  await page.waitForTimeout(500);

  // Now pretend a URL bar just took CHROME_PX off the bottom.
  const usable = 844 - CHROME_PX;
  await page.evaluate((h) => {
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }, usable);
  // `.widget` carries `transition: all 0.3s`, and max-height is animatable — read it
  // mid-flight and you get the value it is transitioning AWAY from.
  await page.waitForTimeout(600);
  const capped = await page.evaluate(() => ({
    maxHeight: getComputedStyle(document.querySelector('#general-widget')).maxHeight,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  }));
  const cap = parseFloat(capped.maxHeight);
  check('the "+" menu is capped by the MEASURED viewport, not by 100vh',
    Math.abs(cap - (usable - 100)) <= 1,
    `--app-height=${usable}px -> max-height=${capped.maxHeight} (want ${usable - 100}px; the 100vh bug gives ${844 - 100}px)`);
  await shoot(page, '04-menu-follows-measured-viewport');
  await page.tap('.dropdown-button');
  await page.waitForTimeout(400);

  // And the note widget, at full height, sits in the band below the top bar.
  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('portrait: the note widget opens as a 300px card, bottom-left',
    note.h === 300 && note.left === 19 && note.bottom === 844 - 19,
    `${note.w}x${note.h} at left=${note.left} bottom=${note.bottom}`);
  await shoot(page, '05-portrait-note-widget');

  await ctx.close();
}

// ── Scenario 3: boot into landscape on a browser that LIES about the viewport ────
// The bug this guards: on first open the widget's fit was self-referential — it is
// bottom-anchored, so `viewportHeight() - rect.top` is just the height it already had,
// which was whatever got computed at boot while it was still display:none. Open it and
// it inherited that; TOUCH it (which writes an inline top, breaking the self-reference)
// and it snapped to the right size. So: the widget must be right WITHOUT being touched,
// even when every viewport API is lying to it.
const LIE = 90;
console.log(`\n== boot into landscape 844x294, every viewport API lying by +${LIE}px`);
{
  const { ctx, page } = await newPage({ width: 844, height: 294, liesBy: LIE });
  const vh = 294;                       // what the screen REALLY is
  const minTop = 50 + 19;               // top bar + buffer

  const lied = await page.evaluate(() => window.innerHeight);
  check(`the browser really is lying (innerHeight says ${lied}, screen is ${vh})`,
    lied === vh + LIE, `innerHeight=${lied}`);

  await openNoteWidget(page);
  const opened = await boxOf(page, '#note-widget');
  console.log('  note widget @open ' + JSON.stringify(opened));
  check('boot: the widget opens ON the screen even though the viewport is lying',
    opened.top >= minTop && opened.bottom <= vh,
    `top=${opened.top} bottom=${opened.bottom} height=${opened.h} (screen=${vh}, must clear ${minTop})`);
  await shoot(page, '07-lying-viewport-open');

  // ...and it must not JUMP when first touched. A widget that only becomes correct once
  // you grab it is the exact symptom this scenario exists to kill.
  const h = await page.locator('.note-widget-header').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 1, h.y + h.height / 2, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const touched = await boxOf(page, '#note-widget');
  console.log('  note widget @touch ' + JSON.stringify(touched));
  check('boot: touching the widget does not resize it (no "pop to the correct size")',
    Math.abs(touched.h - opened.h) <= 2,
    `height ${opened.h} -> ${touched.h}`);
  check('boot: it is still on the screen after being touched',
    touched.top >= minTop && touched.bottom <= vh,
    `top=${touched.top} bottom=${touched.bottom}`);
  await shoot(page, '08-lying-viewport-touched');

  await ctx.close();
}

// ─────────────────────────────────────────── regression: desktop is untouched ────
console.log('\n== desktop 1280x820 (nothing may move)');
{
  const { ctx, page } = await newPage({ width: 1280, height: 820, touch: false });
  const vh = 820;

  await openNoteWidget(page);
  const note = await boxOf(page, '#note-widget');
  console.log('  note widget ' + JSON.stringify(note));
  check('desktop: the note widget still opens 300px tall, bottom-left',
    note.h === 300 && note.left === 19 && note.bottom === vh - 19,
    `${note.w}x${note.h} at left=${note.left} bottom=${note.bottom}`);

  await page.click('.dropdown-button');
  await page.waitForTimeout(500);
  const menu = await boxOf(page, '#general-widget');
  check('desktop: the "+" menu is capped at the same 100vh - 100 as before',
    parseFloat(menu.maxHeight) === vh - 100, `max-height=${menu.maxHeight} (expected ${vh - 100}px)`);
  await shoot(page, '06-desktop');

  await ctx.close();
}

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n  - ' + failed.map((f) => `${f.name} (${f.detail || ''})`).join('\n  - '));
}
console.log('wrote', OUT);
process.exit(failed.length ? 1 : 0);
