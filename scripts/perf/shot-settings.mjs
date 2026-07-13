#!/usr/bin/env node
/**
 * Drives the real app to prove the settings panel is a floating, draggable,
 * NON-MODAL widget, and that the new top-bar gear matches its neighbours.
 *
 * Screenshots every state that has to be right, and — more importantly —
 * measures it: the gear's box vs its siblings, the absence of a scrim, the drag
 * clamp, the height shrink, the stacking against the confirm overlay, and that
 * the workspace still takes clicks while the panel is open.
 *
 *   npm run dev            # in another terminal
 *   node scripts/perf/shot-settings.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/settings';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });

async function newPage({ width, height, hasTouch = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch, isMobile: hasTouch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  !! console.error:', m.text()); });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('rmt:moduleSnapshot:v1');
      localStorage.removeItem('ui-state');
      localStorage.removeItem('rmt:settings:v1');   // factory settings every run
    } catch {}
  });
  await page.goto(`${URL_BASE}/?perf=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__rmtRenderer?.instanceCount > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}

// Select a note the way a user does: hover first (which warms the GPU pick
// path), then click.
async function clickNote(page, pt) {
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(150);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
}

const shoot = async (page, name, selector) => {
  await page.waitForTimeout(220);
  const buf = selector
    ? await page.locator(selector).screenshot()
    : await page.screenshot();
  writeFileSync(join(OUT, name + '.png'), buf);
};

const openPanel = (page) => page.click('#settingsGearBtn');

// Canvas points that actually land on a note, found with the SAME picker (and
// the same client coordinates) the app's click handler uses.
const findNotePoints = (page, wanted = 2) => page.evaluate((wanted) => {
  const W = window.__rmtWorkspace;
  const seen = new Map();
  for (let y = 140; y < window.innerHeight - 40 && seen.size < wanted; y += 7) {
    for (let x = 40; x < window.innerWidth - 40 && seen.size < wanted; x += 7) {
      const hit = W.pickAt(x, y, 2);
      if (hit && hit.type === 'note' && hit.id != null && !seen.has(hit.id)) {
        seen.set(hit.id, { x, y, id: hit.id });
      }
    }
  }
  return [...seen.values()];
}, wanted);

const panelBox = (page) => page.evaluate(() => {
  const p = document.querySelector('.rmt-set-panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  return {
    left: Math.round(r.left), top: Math.round(r.top),
    right: Math.round(r.right), bottom: Math.round(r.bottom),
    w: Math.round(r.width), h: Math.round(r.height),
    zIndex: cs.zIndex, position: cs.position, display: cs.display,
    inlineLeft: p.style.left, inlineTop: p.style.top,
    bodyScrolls: p.querySelector('.rmt-set-body').scrollHeight > p.querySelector('.rmt-set-body').clientHeight + 1,
    vw: window.innerWidth, vh: window.innerHeight,
  };
});

// ─────────────────────────────────────────────────────────────── desktop ────
console.log('\n== desktop 1280x820');
{
  const { ctx, page } = await newPage({ width: 1280, height: 820 });

  // --- 1. top bar geometry: the gear must be indistinguishable from its siblings
  const bar = await page.evaluate(() => {
    const g = document.getElementById('settingsGearBtn');
    const rc = document.querySelector('.right-controls');
    const box = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), mr: s.marginRight,
               bg: s.backgroundColor, border: s.borderStyle, cursor: s.cursor, color: s.color }; };
    return {
      gear: box(g),
      resetView: box(document.getElementById('resetViewBtn')),
      tracking: box(document.querySelector('.tracking-zone')),
      dropdown: box(document.querySelector('.dropdown-button')),
      order: [...rc.children].map((c) => c.id || c.className),
      rightControlsGap: getComputedStyle(rc).gap,
      volumeWidth: Math.round(document.getElementById('volumeSlider').getBoundingClientRect().width),
      // computed height, not offsetHeight: the bar carries a 1px dotted border
      topBarH: getComputedStyle(document.querySelector('.top-bar')).height,
      // no horizontal overflow of the bar's contents
      barScrollW: document.querySelector('.top-bar').scrollWidth,
      barClientW: document.querySelector('.top-bar').clientWidth,
    };
  });
  console.log('  ' + JSON.stringify(bar, null, 1).replace(/\n/g, '\n  '));

  check('gear box is 20x20', bar.gear.w === 20 && bar.gear.h === 20, `${bar.gear.w}x${bar.gear.h}`);
  check('gear margin-right is 16px like its siblings',
    bar.gear.mr === '16px' && bar.resetView.mr === '16px' && bar.tracking.mr === '16px', bar.gear.mr);
  check('gear is transparent + borderless + pointer',
    bar.gear.bg === 'rgba(0, 0, 0, 0)' && bar.gear.border === 'none' && bar.gear.cursor === 'pointer');
  check('gear box matches .dropdown-button exactly',
    bar.gear.w === bar.dropdown.w && bar.gear.h === bar.dropdown.h);
  check('gear sits between .tracking-zone and .menu-container',
    bar.order[1] === 'tracking-zone' && bar.order[2] === 'settingsGearBtn' && bar.order[3] === 'menu-container',
    bar.order.join(' | '));
  check('volume slider narrowed to 72px', bar.volumeWidth === 72, `${bar.volumeWidth}px`);
  check('top bar still 50px tall and does not overflow',
    bar.topBarH === '50px' && bar.barScrollW <= bar.barClientW, bar.topBarH);

  await shoot(page, '00-topbar-rest', '.top-bar');
  await page.hover('#settingsGearBtn');
  await page.waitForTimeout(650);   // let the 0.5s rotation land
  await shoot(page, '01-topbar-gear-hover', '.top-bar');

  // --- 2. open the panel from the gear
  await openPanel(page);
  await page.waitForTimeout(650);
  await page.mouse.move(640, 500);  // un-hover, so the shot shows the resting OPEN state
  await page.waitForTimeout(650);
  await shoot(page, '02-topbar-gear-open', '.top-bar');

  const gearOpen = await page.evaluate(() => {
    const g = document.getElementById('settingsGearBtn');
    return { cls: g.className, aria: g.getAttribute('aria-expanded'), color: getComputedStyle(g).color };
  });
  check('gear shows an open/active state (danger red + .open)',
    gearOpen.cls.includes('open') && gearOpen.aria === 'true' && gearOpen.color === 'rgb(255, 0, 0)',
    `${gearOpen.cls} / aria-expanded=${gearOpen.aria} / ${gearOpen.color}`);

  // --- 3. NOT a modal: no scrim anywhere
  const scrim = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const IGNORE = new Set(['HTML', 'BODY', 'CANVAS']);
    const covering = [...document.body.querySelectorAll('*')].filter((el) => {
      if (IGNORE.has(el.tagName)) return false;
      if (el.closest('.myspaceapp')) return false;         // the GL container is meant to be full-screen
      if (el.classList.contains('myspaceapp')) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width >= vw * 0.95 && r.height >= vh * 0.95;
    }).map((el) => el.className || el.tagName);
    return { overlayExists: !!document.querySelector('.rmt-set-overlay'), covering };
  });
  check('openSettingsPanel() inserts NO full-screen scrim',
    !scrim.overlayExists && scrim.covering.length === 0,
    `.rmt-set-overlay=${scrim.overlayExists}, full-screen elements=${JSON.stringify(scrim.covering)}`);

  const b0 = await panelBox(page);
  console.log('  panel@open ' + JSON.stringify(b0));
  check('panel is position:fixed and visible', b0.position === 'fixed' && b0.display === 'flex');
  check('panel z-index is in the floating-widget layer (1200/1201), below modals (2000)',
    (b0.zIndex === '1200' || b0.zIndex === '1201'), `z-index: ${b0.zIndex}`);
  check('panel opens inside the viewport, clear of the top bar',
    b0.top >= 50 && b0.left >= 19 && b0.right <= b0.vw - 19 && b0.bottom <= b0.vh - 19);

  await shoot(page, '03-panel-open');

  // --- 3b. the header must be the note widget's header, to the pixel
  await page.evaluate(() => {                   // open the note widget for comparison
    document.getElementById('note-widget').classList.add('visible');
  });
  const headers = await page.evaluate(() => {
    const m = (sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect();
      const s = getComputedStyle(e); return { h: Math.round(r.height), pad: s.padding, font: s.fontSize,
        lineHeight: s.lineHeight, fontFamily: s.fontFamily.split(',')[0] }; };
    const sh = document.querySelector('.rmt-set-header').getBoundingClientRect();
    const nh = document.querySelector('.note-widget-header').getBoundingClientRect();
    const sx = document.querySelector('.rmt-set-close').getBoundingClientRect();
    const nx = document.querySelector('.note-widget-close').getBoundingClientRect();
    return {
      setHeader: m('.rmt-set-header'), noteHeader: m('.note-widget-header'),
      setClose: m('.rmt-set-close'), noteClose: m('.note-widget-close'),
      // inset of the × from its widget's right edge, and from the header's top
      setCloseRightInset: Math.round(document.querySelector('.rmt-set-panel').getBoundingClientRect().right - sx.right),
      noteCloseRightInset: Math.round(document.getElementById('note-widget').getBoundingClientRect().right - nx.right),
      setCloseTopInset: Math.round(sx.top - sh.top),
      noteCloseTopInset: Math.round(nx.top - nh.top),
      gearInHeader: !!document.querySelector('.rmt-set-header .rmt-set-gear'),
    };
  });
  console.log('  headers ' + JSON.stringify(headers));
  check('settings header is the same height as the note-widget header',
    headers.setHeader.h === headers.noteHeader.h,
    `settings=${headers.setHeader.h}px, note widget=${headers.noteHeader.h}px`);
  check('the × has the same box and the same inset in both widgets',
    headers.setClose.h === headers.noteClose.h &&
    headers.setCloseRightInset === headers.noteCloseRightInset &&
    headers.setCloseTopInset === headers.noteCloseTopInset,
    `× h=${headers.setClose.h}/${headers.noteClose.h}, right inset=${headers.setCloseRightInset}/${headers.noteCloseRightInset}, top inset=${headers.setCloseTopInset}/${headers.noteCloseTopInset}`);
  check('the settings header shows the gear icon', headers.gearInHeader);
  await page.evaluate(() => document.getElementById('note-widget').classList.remove('visible'));

  // --- 3c. the resets scroll with the content; no pinned footer
  const actions = await page.evaluate(() => {
    const a = document.querySelector('.rmt-set-actions');
    return { inBody: !!a && !!a.closest('.rmt-set-body'),
             footerExists: !!document.querySelector('.rmt-set-footer'),
             btns: a ? [...a.querySelectorAll('button')].map((b) => b.textContent) : [] };
  });
  check('"Reset this tab" / "Reset all" sit in the scroll flow, not a pinned footer',
    actions.inBody && !actions.footerExists, `${JSON.stringify(actions.btns)} inside .rmt-set-body=${actions.inBody}`);

  // --- 3d. tabs animate on hover, and the underline is actually PAINTED
  // (a computed ::after width means nothing if the tab's overflow:hidden clips it,
  // which is exactly what a bottom:-2px underline did).
  const underlinePainted = (tab) => page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const r = t.getBoundingClientRect();
    const a = getComputedStyle(t, '::after');
    const h = parseFloat(a.height) || 0;
    const inset = parseFloat(a.bottom) || 0;              // negative => below the padding box
    const clipped = getComputedStyle(t).overflow === 'hidden' && inset < 0;
    return { w: parseFloat(a.width) || 0, h, inset, clipped, tabW: Math.round(r.width) };
  }, tab);

  const activeUL = await underlinePainted('.rmt-set-tab.active');
  check('the ACTIVE tab shows its underline (not clipped away)',
    activeUL.w > 20 && activeUL.h >= 2 && !activeUL.clipped,
    `width=${activeUL.w}/${activeUL.tabW}px, height=${activeUL.h}px, clipped=${activeUL.clipped}`);

  await page.hover('.rmt-set-tab[data-tab="arrows"]');
  await page.waitForTimeout(400);
  const tabHover = await page.evaluate(() => {
    const t = document.querySelector('.rmt-set-tab[data-tab="arrows"]');
    const cs = getComputedStyle(t);
    return { color: cs.color, shadow: cs.textShadow };
  });
  const hoverUL = await underlinePainted('.rmt-set-tab[data-tab="arrows"]');
  check('hovering a tab lights it and grows its underline',
    tabHover.color === 'rgb(255, 168, 0)' && tabHover.shadow !== 'none' &&
    hoverUL.w > 20 && !hoverUL.clipped,
    `color=${tabHover.color}, underline=${hoverUL.w}px (clipped=${hoverUL.clipped}), glow=${tabHover.shadow !== 'none'}`);

  // The tab row must be vertically symmetric — equal air above and below.
  const tabRow = await page.evaluate(() => {
    const bar = document.querySelector('.rmt-set-tabs');
    const t = document.querySelector('.rmt-set-tab');
    const br = bar.getBoundingClientRect(), tr = t.getBoundingClientRect();
    // bar.bottom includes the dotted rule itself; the gap is what's left over.
    const rule = parseFloat(getComputedStyle(bar).borderBottomWidth) || 0;
    return { above: Math.round(tr.top - br.top),
             gapToRule: Math.round(br.bottom - rule - tr.bottom),
             rowH: Math.round(br.height) };
  });
  check('the tab row is slim, symmetric, and the underline sits ON the dotted rule',
    tabRow.above === 0 && tabRow.gapToRule === 0 && tabRow.rowH <= 34,
    `above=${tabRow.above}px, gap between underline and rule=${tabRow.gapToRule}px, row height=${tabRow.rowH}px`);
  await shoot(page, '03b-tab-hover');
  await shoot(page, '03c-tabs', '.rmt-set-tabs');

  // --- 4. drag it by the header, and prove the app behind it still works
  const dragTo = async (x, y) => {
    const h = await page.locator('.rmt-set-header').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  await dragTo(420, 520);
  const b1 = await panelBox(page);
  check('dragging the header moves the panel (inline left/top)',
    b1.inlineLeft !== '' && b1.inlineTop !== '' && (b1.left !== b0.left || b1.top !== b0.top),
    `${b0.left},${b0.top} -> ${b1.left},${b1.top}`);
  await shoot(page, '04-panel-dragged');

  // Click a note that is NOT under the panel: the workspace must still respond.
  const notes = await findNotePoints(page, 12);
  const outside = (n) => !(n.x >= b1.left - 8 && n.x <= b1.right + 8 &&
                           n.y >= b1.top - 8 && n.y <= b1.bottom + 8);
  const behind = notes.filter(outside);
  if (!behind.length) throw new Error(`no note found outside the panel to click (found ${notes.length} notes)`);
  await clickNote(page, behind[0]);
  const afterNoteClick = await page.evaluate(() => ({
    noteWidget: document.getElementById('note-widget').classList.contains('visible'),
    title: document.getElementById('note-widget-title').textContent,
    panelStillOpen: document.querySelector('.rmt-set-panel').classList.contains('rmt-set-open'),
  }));
  check('the app behind the panel still takes clicks (note selected while panel is open)',
    afterNoteClick.noteWidget && afterNoteClick.panelStillOpen,
    `note widget="${afterNoteClick.title}", panel open=${afterNoteClick.panelStillOpen}`);

  await shoot(page, '05-panel-and-note-widget');

  // Clicking INSIDE the panel must not drop that selection (the clearSelection allowlist).
  await page.click('.rmt-set-tab[data-tab="audio"]');
  await page.waitForTimeout(250);
  const afterPanelClick = await page.evaluate(() => ({
    noteWidget: document.getElementById('note-widget').classList.contains('visible'),
    activeTab: document.querySelector('.rmt-set-tab.active').dataset.tab,
  }));
  check('clicking inside the panel does NOT clear the note selection',
    afterPanelClick.noteWidget && afterPanelClick.activeTab === 'audio',
    `note widget visible=${afterPanelClick.noteWidget}, tab=${afterPanelClick.activeTab}`);

  // Both open at once: stacking must be sane, neither trapped.
  const stack = await page.evaluate(() => {
    const p = document.querySelector('.rmt-set-panel');
    const w = document.getElementById('note-widget');
    const z = (el) => parseInt(getComputedStyle(el).zIndex, 10);
    return { panel: z(p), noteWidget: z(w), overlap: (() => {
      const a = p.getBoundingClientRect(), b = w.getBoundingClientRect();
      return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    })() };
  });
  check('panel + note widget coexist in the same layer, both < 2000',
    stack.panel < 2000 && stack.noteWidget < 2000 && Math.abs(stack.panel - stack.noteWidget) <= 1,
    `panel z=${stack.panel}, note widget z=${stack.noteWidget}, overlapping=${stack.overlap}`);

  // REGRESSION GUARD: the note widget's own drag still works after the extraction.
  {
    const nw = () => page.evaluate(() => {
      const w = document.getElementById('note-widget');
      const r = w.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom),
               h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
    });
    const before = await nw();
    const hb = await page.locator('.note-widget-header').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const moved = await nw();
    check('note widget still drags (shared helper did not regress it)',
      moved.left !== before.left || moved.top !== before.top,
      `${before.left},${before.top} -> ${moved.left},${moved.top}`);

    // ...and still clamps + re-fits its height at the bottom edge.
    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.move(1200, 900, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const low = await nw();
    check('note widget still clamps to the viewport and shrinks at the bottom',
      low.left >= 19 && low.top >= 50 && low.bottom <= low.vh && low.h < before.h + 1,
      `left=${low.left} top=${low.top} bottom=${low.bottom} h=${before.h}->${low.h} (vh=${low.vh})`);
    // put it back so later shots are sane
    const hb2 = await page.locator('.note-widget-header').boundingBox();
    await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
    await page.mouse.down();
    await page.mouse.move(180, 560, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }

  // Click-to-front: touching the note widget raises it above the panel.
  await page.click('.note-widget-header', { position: { x: 40, y: 10 } });
  await page.waitForTimeout(150);
  const raised = await page.evaluate(() => {
    const z = (s) => parseInt(getComputedStyle(document.querySelector(s)).zIndex, 10);
    return { panel: z('.rmt-set-panel'), noteWidget: z('#note-widget') };
  });
  check('clicking a panel brings it to the front (no unreachable-panel trap)',
    raised.noteWidget > raised.panel,
    `note widget z=${raised.noteWidget} > panel z=${raised.panel}`);

  // --- 5. drag to the bottom edge: the clamp holds and the panel shrinks
  const hBefore = (await panelBox(page)).h;
  await dragTo(1260, 815);
  const b2 = await panelBox(page);
  console.log('  panel@bottom ' + JSON.stringify(b2));
  check('drag clamp: panel stays inside the viewport with its 19px buffer',
    b2.left >= 19 && b2.right <= b2.vw - 19 && b2.top >= 50 && b2.top <= b2.vh - 19,
    `left=${b2.left} right=${b2.right} top=${b2.top} (vw=${b2.vw} vh=${b2.vh})`);
  check('panel dragged low SHRINKS instead of overflowing',
    b2.h < hBefore && b2.bottom <= b2.vh - 19 + 1,
    `height ${hBefore} -> ${b2.h}, bottom=${b2.bottom} (vh=${b2.vh}, buffer 19)`);
  check('the squeezed panel scrolls its body instead of clipping content', b2.bodyScrolls);
  await shoot(page, '06-panel-clamped-bottom');

  // Drag back up so the reset dialog is visible in the shot.
  await dragTo(700, 200);

  // --- 6. destructive resets are confirmed, and the confirm overlay covers the panel
  await page.click('.rmt-set-tab[data-tab="appearance"]');
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    settingsStore.set('appearance.note.heightWU', 42);        // something to lose
  });
  await page.waitForTimeout(200);

  await page.click('.rmt-set-btn-danger');                     // "Reset all"
  await page.waitForTimeout(300);
  const confirm = await page.evaluate(() => {
    const o = document.querySelector('.delete-confirm-overlay');
    if (!o) return { present: false };
    const p = document.querySelector('.rmt-set-panel').getBoundingClientRect();
    // hit-test over the panel: the overlay must win
    const hit = document.elementFromPoint(Math.round(p.left + p.width / 2), Math.round(p.top + p.height / 2));
    return {
      present: true,
      z: parseInt(getComputedStyle(o).zIndex, 10),
      overlayIsOnTopOfPanel: !!hit && (hit === o || o.contains(hit)),
      text: o.querySelector('p').textContent.slice(0, 60),
      buttons: [...o.querySelectorAll('button')].map((b) => b.textContent),
    };
  });
  check('"Reset all" asks for confirmation first', confirm.present,
    confirm.present ? `"${confirm.text}…" [${confirm.buttons.join(' | ')}]` : 'NO DIALOG');
  check('the confirm overlay renders ABOVE the settings panel',
    confirm.overlayIsOnTopOfPanel && confirm.z === 2000, `z=${confirm.z}, covers panel=${confirm.overlayIsOnTopOfPanel}`);
  await shoot(page, '07-reset-all-confirm');

  // Cancel => nothing is reset.
  await page.click('.delete-confirm-modal button:last-child');
  await page.waitForTimeout(250);
  const afterCancel = await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    return { h: settingsStore.get('appearance.note.heightWU'),
             dialog: !!document.querySelector('.delete-confirm-overlay') };
  });
  check('Cancel dismisses the dialog and changes nothing',
    afterCancel.h === 42 && !afterCancel.dialog, `heightWU=${afterCancel.h}, dialog=${afterCancel.dialog}`);

  // Confirm => it really resets.
  await page.click('.rmt-set-btn-danger');
  await page.waitForTimeout(250);
  await page.click('.delete-confirm-modal button:first-child');
  await page.waitForTimeout(350);
  const afterConfirm = await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    return { h: settingsStore.get('appearance.note.heightWU'),
             dialog: !!document.querySelector('.delete-confirm-overlay'),
             panelOpen: document.querySelector('.rmt-set-panel').classList.contains('rmt-set-open') };
  });
  check('Confirming "Reset all" resets the settings and keeps the panel open',
    afterConfirm.h !== 42 && !afterConfirm.dialog && afterConfirm.panelOpen,
    `heightWU=${afterConfirm.h}, panel open=${afterConfirm.panelOpen}`);

  // "Reset this tab" is confirmed too.
  await page.click('.rmt-set-actions .rmt-set-btn:not(.rmt-set-btn-danger)');
  await page.waitForTimeout(250);
  const tabConfirm = await page.evaluate(() => {
    const o = document.querySelector('.delete-confirm-overlay');
    return o ? { present: true, text: o.querySelector('p').textContent.slice(0, 70) } : { present: false };
  });
  check('"Reset this tab" asks for confirmation first', tabConfirm.present, tabConfirm.text);
  await shoot(page, '08-reset-tab-confirm');
  await page.click('.delete-confirm-modal button:last-child');
  await page.waitForTimeout(200);

  // --- 6b. "Reset colors to theme": inert when clean, confirmed when dirty
  const colorsBtn = '.rmt-set-tabpanel .rmt-set-btn:not(.rmt-set-btn-danger)';
  const cleanState = await page.evaluate((sel) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes('Reset colors'));
    return { disabled: b.disabled };
  }, colorsBtn);
  check('"Reset colors to theme" is inert when the colors ARE the theme', cleanState.disabled,
    `disabled=${cleanState.disabled}`);

  // dirty one color, then it must confirm
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    settingsStore.set('appearance.overrides', { accent: '#00ff00' });
  });
  await page.waitForTimeout(250);
  const dirtyState = await page.evaluate((sel) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes('Reset colors'));
    return { disabled: b.disabled };
  }, colorsBtn);
  check('"Reset colors to theme" wakes up once a color is overridden', !dirtyState.disabled);

  await page.evaluate((sel) => {
    [...document.querySelectorAll(sel)].find((x) => x.textContent.includes('Reset colors')).click();
  }, colorsBtn);
  await page.waitForTimeout(300);
  const colorConfirm = await page.evaluate(() => {
    const o = document.querySelector('.delete-confirm-overlay');
    return o ? { present: true, text: o.querySelector('p').textContent.slice(0, 60) } : { present: false };
  });
  check('"Reset colors to theme" asks for confirmation', colorConfirm.present, colorConfirm.text);
  await shoot(page, '08b-reset-colors-confirm');
  if (colorConfirm.present) await page.click('.delete-confirm-modal button:first-child');
  await page.waitForTimeout(300);
  const afterColorReset = await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    return { n: Object.keys(settingsStore.get('appearance.overrides') || {}).length };
  });
  check('confirming really clears the color overrides', afterColorReset.n === 0, `overrides=${afterColorReset.n}`);

  // --- 7. the panel stays CURRENT while open (the staleness the modal hid)
  await page.click('.rmt-set-tab[data-tab="audio"]');
  await page.waitForTimeout(200);

  const readPanelVolume = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.rmt-set-row')]
      .find((r) => r.textContent.startsWith('Master volume'));
    return { shown: parseFloat(row.querySelector('input[type=range]').value),
             readout: row.querySelector('.rmt-set-slider-val').textContent };
  });

  const volBox = await page.locator('#volumeSlider').boundingBox();
  const volY = volBox.y + volBox.height / 2;
  await page.mouse.move(volBox.x + volBox.width / 2, volY);
  await page.mouse.down();
  await page.mouse.move(volBox.x + 4, volY, { steps: 6 });
  await page.waitForTimeout(250);
  // STILL HELD DOWN: the panel must already be following, not waiting for the drop.
  const midDrag = await readPanelVolume();
  check('the panel tracks the transport slider DURING the drag (not only on drop)',
    midDrag.shown < 0.5, `mid-drag panel slider=${midDrag.shown.toFixed(2)} (${midDrag.readout})`);
  await shoot(page, '09-panel-follows-transport-volume');

  await page.mouse.up();                        // 'change' fires -> writes audio.masterVolume
  await page.waitForTimeout(350);
  const sync = await page.evaluate(async () => {
    const { settingsStore } = await import('/src/settings/settings-store.js');
    return { stored: settingsStore.get('audio.masterVolume') };
  });
  const dropped = await readPanelVolume();
  check('the open panel follows the transport volume slider (no staleness)',
    Math.abs(sync.stored - dropped.shown) < 1e-6,
    `store=${sync.stored.toFixed(2)}, panel slider=${dropped.shown.toFixed(2)}, readout=${dropped.readout}`);

  // --- 8. close via the panel's own × : the gear must un-light
  await page.click('.rmt-set-close');
  await page.waitForTimeout(400);
  const afterClose = await page.evaluate(() => {
    const g = document.getElementById('settingsGearBtn');
    const p = document.querySelector('.rmt-set-panel');
    return { gearOpen: g.classList.contains('open'), aria: g.getAttribute('aria-expanded'),
             panelDisplay: getComputedStyle(p).display, stillInDom: !!p,
             keptLeft: p.style.left, keptTop: p.style.top };
  });
  check('closing with × un-lights the gear', !afterClose.gearOpen && afterClose.aria === 'false');
  check('closed panel is hidden but kept (position survives)',
    afterClose.panelDisplay === 'none' && afterClose.stillInDom && afterClose.keptLeft !== '');

  // Reopen: same position, no rebuild.
  await openPanel(page);
  await page.waitForTimeout(300);
  const reopened = await panelBox(page);
  check('reopening restores the dragged position',
    reopened.inlineLeft === afterClose.keptLeft && reopened.inlineTop === afterClose.keptTop,
    `${reopened.inlineLeft},${reopened.inlineTop}`);

  // Gear toggles closed.
  await openPanel(page);
  await page.waitForTimeout(300);
  const toggled = await page.evaluate(() => ({
    open: document.querySelector('.rmt-set-panel').classList.contains('rmt-set-open'),
    gear: document.getElementById('settingsGearBtn').classList.contains('open'),
  }));
  check('clicking the gear while open toggles the panel closed', !toggled.open && !toggled.gear);

  await ctx.close();
}

// ─────────────────────────────────────────────────────── narrow desktop ────
console.log('\n== narrow 430x820 (does the bar still fit?)');
{
  const { ctx, page } = await newPage({ width: 430, height: 820 });
  const fit = await page.evaluate(() => {
    const bar = document.querySelector('.top-bar');
    const left = document.querySelector('.controls-group').getBoundingClientRect();
    const right = document.querySelector('.right-controls').getBoundingClientRect();
    return { overflow: bar.scrollWidth > bar.clientWidth, clusterGap: Math.round(right.left - left.right),
             barScrollW: bar.scrollWidth, barClientW: bar.clientWidth };
  });
  check('top bar does not overflow at 430px (slider + gear both fit)',
    !fit.overflow && fit.clusterGap >= 0,
    `scrollW=${fit.barScrollW} clientW=${fit.barClientW}, gap between clusters=${fit.clusterGap}px`);
  await shoot(page, '10-topbar-narrow-430', '.top-bar');
  await ctx.close();
}

// ────────────────────────────────────────────────────────────── mobile ────
console.log('\n== mobile 390x844 (touch)');
{
  const { ctx, page } = await newPage({ width: 390, height: 844, hasTouch: true });
  await page.tap('#settingsGearBtn');
  await page.waitForTimeout(500);

  const m0 = await panelBox(page);
  console.log('  panel@mobile ' + JSON.stringify(m0));
  check('mobile: panel is a floating card, NOT a full-screen sheet',
    m0.w < m0.vw && m0.h < m0.vh && m0.left >= 19 && m0.right <= m0.vw - 19,
    `${m0.w}x${m0.h} in ${m0.vw}x${m0.vh}, left=${m0.left} right=${m0.right}`);
  await shoot(page, '11-mobile-panel-open');

  // Real touch drag of the header via CDP.
  const cdp = await ctx.newCDPSession(page);
  const h = await page.locator('.rmt-set-header').boundingBox();
  const sx = h.x + h.width / 2, sy = h.y + h.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (const [x, y] of [[sx - 30, sy + 120], [sx - 60, sy + 260], [sx - 80, sy + 380]]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);

  const m1 = await panelBox(page);
  check('mobile: the panel can be dragged by touch',
    m1.top !== m0.top || m1.left !== m0.left, `${m0.left},${m0.top} -> ${m1.left},${m1.top}`);
  check('mobile: touch drag obeys the same clamp',
    m1.left >= 19 && m1.right <= m1.vw - 19 && m1.top >= 50 && m1.bottom <= m1.vh,
    `left=${m1.left} right=${m1.right} top=${m1.top} bottom=${m1.bottom} (vh=${m1.vh})`);
  await shoot(page, '12-mobile-panel-dragged');
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
