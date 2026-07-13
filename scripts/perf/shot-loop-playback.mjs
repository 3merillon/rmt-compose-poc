#!/usr/bin/env node
/**
 * Drives the real app to prove the hidden loop-playback mode (shift-click or
 * long-press the play button).
 *
 * Screenshots can show the three bars orbiting the lemniscate. What they CANNOT show
 * is the half that actually matters — that the scheduler keeps handing out voices
 * past the end of the module, and that disarming it cancels the pass it had already
 * begun scheduling into. So this drives the real AudioEngine and asserts numerically:
 *
 *   TEST A  Seam arithmetic. _nextSeamRel must return the pass boundary STRICTLY
 *           after `rel` (a disarm landing exactly on a seam must end the NEXT pass,
 *           not one that has already gone), and _applyLoop must refuse a degenerate
 *           loop — an empty note list, or a zero/NaN period, makes the pump's inner
 *           loop a no-op, so every iteration "exhausts" the pass and advances a
 *           cycle: with NaN it hangs the tab outright.
 *
 *   TEST B  The pump wraps. Play a 0.6 s synthetic pass on a loop, and watch voices
 *           get scheduled into pass 2, 3, 4... The pre-loop scheduler stopped as soon
 *           as the LAST NOTE WAS SCHEDULED — up to 2 s (LOOKAHEAD) before it sounds —
 *           so this is exactly what a naive loop gets wrong: it plays once and quits.
 *
 *   TEST C  Disarm cuts at the seam. The 2 s lookahead means voices for later passes
 *           already exist when the user toggles off (with a 0.6 s pass, three passes'
 *           worth). None of them may survive, and the pump may not add more.
 *
 *   TEST D  The UI gesture. Shift-click and long-press both toggle; the click that a
 *           long-press leaves behind must NOT reach the play/pause handler.
 *
 *   npm run dev
 *   node scripts/perf/shot-loop-playback.mjs --url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_BASE = flag('--url', 'http://localhost:3000');
const OUT = 'scripts/perf/__visual__/loop-playback';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Deliberately NOT passing --autoplay-policy=no-user-gesture-required: the real
// gesture rules are part of what we are testing. Relaxing them here would hide a
// play() that never actually reaches a running AudioContext.
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('  !! pageerror:', e.message); });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  console.log('  !! console.error:', t);
  if (!/wake lock/i.test(t)) errors.push(t);
});
await page.addInitScript(() => {
  try {
    localStorage.removeItem('rmt:moduleSnapshot:v1');
    localStorage.removeItem('ui-state');
    localStorage.removeItem('rmt:settings:v1');
  } catch {}
});

// ?perf=1 is what loads src/dev/perf-harness.js (window.__rmtPerf), our handle on
// the real module — see main.js:131.
await page.goto(`${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}perf=1`, { waitUntil: 'load' });
await page.waitForSelector('#playPauseBtn', { timeout: 20000 });
await page.waitForFunction(() => !!window.__rmtPerf, null, { timeout: 20000 });
await page.waitForTimeout(800);

const ppClasses = () => page.$eval('.pp', (el) => [...el.classList]);
const moduleEnd = await page.evaluate(() => window.__rmtPerf.getModuleRef().getModuleEndTime());
console.log(`\n  module end time: ${moduleEnd.toFixed(2)}s\n`);

// ── TEST A — seam arithmetic + degenerate-loop guards (pure, no audio) ───────────
console.log('TEST A — seam arithmetic & guards');
const a = await page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  const audible = [{ frequency: 440, instrument: 'sine-wave', startTime: 0, duration: 0.2 }];
  const s = {};
  const seam = (rel, firstLen, period) => audioEngine._nextSeamRel(rel, { firstLen, period });
  return {
    rejectsZeroPeriod: audioEngine._applyLoop({}, { period: 0, notes: audible }),
    rejectsNaNPeriod: audioEngine._applyLoop({}, { period: NaN, notes: audible }),
    rejectsTinyPeriod: audioEngine._applyLoop({}, { period: 0.01, notes: audible }),
    rejectsEmptyNotes: audioEngine._applyLoop({}, { period: 4, notes: [] }),
    rejectsSilentNotes: audioEngine._applyLoop({}, { period: 4, notes: [{ frequency: null, instrument: null, startTime: 0 }] }),
    acceptsValid: audioEngine._applyLoop(s, { period: 4, notes: audible, firstCycleAudioLength: 1.5 }),
    installed: { period: s.period, firstLen: s.firstLen, looping: s.looping },
    // pass 0 spans [0, 1.5); pass k>=1 spans [1.5 + (k-1)*4, ...)
    seamFromStart: seam(0, 1.5, 4),
    seamOnBoundary: seam(1.5, 1.5, 4),
    seamMidPass2: seam(3.0, 1.5, 4),
    seamMidPass3: seam(6.0, 1.5, 4),
  };
});
check('_applyLoop rejects period 0', a.rejectsZeroPeriod === false);
check('_applyLoop rejects period NaN', a.rejectsNaNPeriod === false, 'NaN would hang the pump: every compare is false');
check('_applyLoop rejects sub-50ms period', a.rejectsTinyPeriod === false);
check('_applyLoop rejects empty note list', a.rejectsEmptyNotes === false);
check('_applyLoop rejects all-measure-marker module', a.rejectsSilentNotes === false);
check('_applyLoop accepts a valid loop', a.acceptsValid === true, JSON.stringify(a.installed));
check('seam from mid-pass-0 is pass-0 end', a.seamFromStart === 1.5, `got ${a.seamFromStart}`);
check('seam ON a boundary is the NEXT one', a.seamOnBoundary === 5.5, `got ${a.seamOnBoundary} (must not return the seam already reached)`);
check('seam mid-pass-1', a.seamMidPass2 === 5.5, `got ${a.seamMidPass2}`);
check('seam mid-pass-2', a.seamMidPass3 === 9.5, `got ${a.seamMidPass3}`);

// ── TEST B — the pump actually wraps ────────────────────────────────────────────
console.log('\nTEST B — pump advances through passes');
const b = await page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  const PERIOD = 0.6;
  const notes = [
    { frequency: 440, instrument: 'sine-wave', startTime: 0.0, duration: 0.15, panPos: 0 },
    { frequency: 660, instrument: 'sine-wave', startTime: 0.3, duration: 0.15, panPos: 0 },
  ];
  // Record every voice the scheduler hands out, as a playback-relative time.
  const starts = [];
  const orig = audioEngine._scheduleNote.bind(audioEngine);
  audioEngine._scheduleNote = (nd, passStart, vol) => { starts.push(passStart + nd.startTime); return orig(nd, passStart, vol); };

  const base = audioEngine.play(notes, { loop: { period: PERIOD, notes, firstCycleAudioLength: PERIOD } });
  await new Promise((r) => setTimeout(r, 2600));
  const looping = audioEngine.isLooping();
  const rel = starts.map((t) => +(t - base).toFixed(4)).sort((x, y) => x - y);
  audioEngine._scheduleNote = orig;
  audioEngine.stopAll();
  return { rel, looping, period: PERIOD, passes: rel.length ? Math.floor(Math.max(...rel) / PERIOD) + 1 : 0 };
});
const monotonicUnique = b.rel.length === new Set(b.rel).size;
check('engine reports looping', b.looping === true);
check('scheduled beyond pass 1', b.passes >= 4, `voices span ${b.passes} passes (${b.rel.length} voices over 2.6s of a 0.6s pass)`);
check('no duplicate voice times', monotonicUnique, `${b.rel.length} voices, ${new Set(b.rel).size} distinct`);
check('pass starts land on the grid', b.rel.every((t) => {
  const inPass = t % b.period;
  return Math.abs(inPass - 0) < 1e-3 || Math.abs(inPass - 0.3) < 1e-3;
}), 'every voice sits at 0.0 or 0.3 within its pass — no drift, nothing dumped in the past');

// ── TEST C — disarm cuts at the seam and cancels the lookahead ──────────────────
console.log('\nTEST C — disarm finishes the pass, cancels what was scheduled past it');
const c = await page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  const PERIOD = 0.6;
  const notes = [
    { frequency: 440, instrument: 'sine-wave', startTime: 0.0, duration: 0.15, panPos: 0 },
    { frequency: 660, instrument: 'sine-wave', startTime: 0.3, duration: 0.15, panPos: 0 },
  ];
  const startsAfterDisarm = [];
  const orig = audioEngine._scheduleNote.bind(audioEngine);

  const base = audioEngine.play(notes, { loop: { period: PERIOD, notes, firstCycleAudioLength: PERIOD } });
  await new Promise((r) => setTimeout(r, 1200));

  // How far ahead had the 2s lookahead already scheduled? (This is the whole point:
  // there ARE voices for passes that must now never sound.)
  const ctxNow = audioEngine.audioContext.currentTime;
  const scheduledAhead = [...audioEngine.activeOscillators].filter((e) => e.startTime > ctxNow).length;

  audioEngine._scheduleNote = (nd, passStart, vol) => { startsAfterDisarm.push(passStart + nd.startTime); return orig(nd, passStart, vol); };
  const cut = audioEngine.disarmLoop();

  const survivingPastCut = [...audioEngine.activeOscillators].filter((e) => e.startTime >= cut - 1e-6).length;
  const stillLooping = audioEngine.isLooping();

  await new Promise((r) => setTimeout(r, 1500)); // well past the cut
  const scheduledPastCutAfterDisarm = startsAfterDisarm.filter((t) => t >= cut - 1e-6).length;
  const aliveWellAfterCut = [...audioEngine.activeOscillators].filter((e) => e.startTime >= cut - 1e-6).length;

  audioEngine._scheduleNote = orig;
  audioEngine.stopAll();
  return {
    cutRel: +(cut - base).toFixed(4),
    scheduledAhead, survivingPastCut, stillLooping,
    scheduledPastCutAfterDisarm, aliveWellAfterCut,
  };
});
check('lookahead HAD queued future voices', c.scheduledAhead > 0, `${c.scheduledAhead} voices were already scheduled ahead of the disarm`);
check('cut lands on a pass boundary', Math.abs(c.cutRel % 0.6) < 1e-3, `cut at rel ${c.cutRel}s (pass length 0.6s)`);
check('engine stops reporting looping', c.stillLooping === false);
check('voices past the cut were cancelled', c.survivingPastCut === 0, `${c.survivingPastCut} survived`);
check('pump scheduled nothing past the cut', c.scheduledPastCutAfterDisarm === 0, `${c.scheduledPastCutAfterDisarm} added after disarm`);
check('nothing alive past the cut later on', c.aliveWellAfterCut === 0);

// ── TEST D — the gesture ────────────────────────────────────────────────────────
console.log('\nTEST D — shift-click & long-press');
const box = await page.$eval('#playPauseBtn', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, w: r.width, h: r.height };
});

// Is the transport really running, or does it just LOOK like it? The icon can lie;
// a suspended AudioContext with no voices cannot.
const audioLive = async () => page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  const t0 = audioEngine.audioContext.currentTime;
  await new Promise((r) => setTimeout(r, 350));
  return {
    running: audioEngine.audioContext.state === 'running',
    advanced: audioEngine.audioContext.currentTime - t0 > 0.2,
    voices: audioEngine.activeOscillators.size,
  };
});

check('starts clean', !(await ppClasses()).includes('looping'));

// Chrome raises :focus-visible for a modifier-click, so the shift-click gesture would
// otherwise leave a white ring around the button every time it is used.
const ring = await page.evaluate(() => {
  const b = document.getElementById('playPauseBtn');
  b.focus();
  const cs = getComputedStyle(b);
  return { style: cs.outlineStyle, width: cs.outlineWidth };
});
check('no focus ring on the play button', ring.style === 'none' || ring.width === '0px', JSON.stringify(ring));

// Shift-click from a stopped transport: enters the mode AND starts playing.
await page.click('#playPauseBtn', { modifiers: ['Shift'] });
await page.waitForTimeout(700);
let cls = await ppClasses();
let live = await audioLive();
check('shift-click → .looping', cls.includes('looping'));
check('shift-click → .open (red pause-bar family)', cls.includes('open'), `classes: [${cls}]`);
check('shift-click → AUDIO actually rolling', live.running && live.advanced && live.voices > 0,
  JSON.stringify(live) + ' — icon state is not proof; this is');

const shotAt = async (name) => {
  const pad = 6;
  await page.screenshot({
    path: join(OUT, name),
    clip: { x: box.left - pad, y: box.top - pad, width: box.w + pad * 2, height: box.h + pad * 2 },
  });
};
// Four frames across one 2.4s lap — the dashes must be in different places.
for (let i = 0; i < 4; i++) { await shotAt(`orbit-${i}.png`); await page.waitForTimeout(600); }
await page.screenshot({ path: join(OUT, 'topbar-looping.png'), clip: { x: 0, y: 0, width: 420, height: 50 } });

// A PLAIN click while looping is just pause: the orbit drops and the button offers
// the play triangle again. The mode stays armed underneath.
await page.click('#playPauseBtn');
await page.waitForTimeout(400);
cls = await ppClasses();
check('plain click while looping → pauses to the play triangle',
  !cls.includes('open') && !cls.includes('looping'), `classes: [${cls}]`);

// ...and pause LEAVES the mode: pressing play again is ordinary playback. Engaging
// the loop must always be a deliberate shift-click / long-press, never something you
// fall back into.
await page.click('#playPauseBtn');
await page.waitForTimeout(700);
cls = await ppClasses();
check('play after pausing a loop is NORMAL playback', cls.includes('open') && !cls.includes('looping'),
  `classes: [${cls}] — .looping here means the mode leaked through the pause`);

// Get back into the loop deliberately, then shift-click off: the orbit must revert
// IMMEDIATELY to the red pause bars while the audio keeps playing out the pass.
await page.click('#playPauseBtn', { modifiers: ['Shift'] });
await page.waitForTimeout(500);
check('re-engaged via shift-click', (await ppClasses()).includes('looping'));

await page.click('#playPauseBtn', { modifiers: ['Shift'] });
await page.waitForTimeout(120);
cls = await ppClasses();
live = await audioLive();
check('shift-click off → .looping gone immediately', !cls.includes('looping'), `classes: [${cls}]`);
check('shift-click off → still the red pause bars', cls.includes('open'), `classes: [${cls}]`);
check('shift-click off → audio keeps playing the pass out', live.running && live.advanced && live.voices > 0, JSON.stringify(live));
await page.screenshot({ path: join(OUT, 'topbar-disarmed.png'), clip: { x: 0, y: 0, width: 420, height: 50 } });

// Back to a clean transport. Stop is the hard exit from the mode.
await page.click('#stopButton');
await page.waitForTimeout(400);
cls = await ppClasses();
check('stop clears everything', !cls.includes('looping') && !cls.includes('open'), `classes: [${cls}]`);
await page.click('#playPauseBtn');
await page.waitForTimeout(600);
cls = await ppClasses();
check('stop really left the mode (play is normal again)', cls.includes('open') && !cls.includes('looping'), `classes: [${cls}]`);
await page.click('#stopButton');
await page.waitForTimeout(300);

// Long-press from stopped: toggles the mode AND starts playback — and the trailing
// click must not reach the play/pause handler (it would immediately pause).
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.waitForTimeout(750);
await page.mouse.up();
await page.waitForTimeout(700);
cls = await ppClasses();
check('long-press → .looping', cls.includes('looping'), `classes: [${cls}]`);
check('long-press → playing (trailing click swallowed)', cls.includes('open'),
  `classes: [${cls}] — if .open is missing the trailing click reached play/pause and paused it`);

// Long-press again: must toggle OFF (the only exit on touch).
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.waitForTimeout(750);
await page.mouse.up();
await page.waitForTimeout(200);
cls = await ppClasses();
check('long-press again → toggles OFF', !cls.includes('looping'), `classes: [${cls}]`);
check('long-press off → still playing out the pass', cls.includes('open'), `classes: [${cls}]`);

// A plain click must still be plain play/pause.
await page.click('#stopButton');
await page.waitForTimeout(300);
await page.click('#playPauseBtn');
await page.waitForTimeout(500);
cls = await ppClasses();
check('plain click still plays, no loop', cls.includes('open') && !cls.includes('looping'), `classes: [${cls}]`);
await page.click('#playPauseBtn');
await page.waitForTimeout(400);
cls = await ppClasses();
check('plain click still pauses', !cls.includes('open'), `classes: [${cls}]`);
await page.click('#stopButton');

// ── TEST E — arming mid-playback must not restart the audio ─────────────────────
console.log('\nTEST E — shift-click DURING normal playback');
const engineBase = () => page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  const s = audioEngine._streamingState;
  return { base: s ? s.baseStartTime : null, looping: audioEngine.isLooping() };
});
await page.click('#playPauseBtn');           // normal playback
await page.waitForTimeout(1500);
const before = await engineBase();
await page.click('#playPauseBtn', { modifiers: ['Shift'] });  // arm the loop mid-pass
await page.waitForTimeout(800);
const after = await engineBase();
cls = await ppClasses();
check('mid-play shift-click → .looping', cls.includes('looping'), `classes: [${cls}]`);
check('mid-play shift-click → engine now looping', after.looping === true);
check('mid-play arm did NOT restart playback', before.base != null && after.base === before.base,
  `baseStartTime ${before.base} → ${after.base} — a change here means play() re-ran and the audio jumped`);

// ── TEST F — after disarming, it stops by itself at the end of the pass ─────────
console.log('\nTEST F — disarmed loop plays out and stops at the module end');
await page.click('#playPauseBtn', { modifiers: ['Shift'] });  // disarm
cls = await ppClasses();
check('disarm → orbit gone at once, still playing', !cls.includes('looping') && cls.includes('open'), `classes: [${cls}]`);
const stoppedByItself = await page
  .waitForFunction(() => !document.querySelector('.pp').classList.contains('open'),
    null, { timeout: (moduleEnd + 8) * 1000, polling: 200 })
  .then(() => true).catch(() => false);
check('stops on its own at the module end', stoppedByItself,
  `waited up to ${(moduleEnd + 8).toFixed(0)}s for playback to end itself`);
cls = await ppClasses();
check('parks on the play triangle', !cls.includes('open') && !cls.includes('looping'), `classes: [${cls}]`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = checks.filter((c) => !c.pass);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ moduleEnd, checks, errors }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} passed. Shots in ${OUT}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
