// Transport with tails (Phase I, step 2), in the running app: headless Edge, a real AudioContext.
// Needs the dev server: node scripts/perf/check-transport.mjs [http://localhost:3220/?perf=1]
// Checks the module end (tails ring out), Play/Stop/Pause, loop seams and switching the loop off,
// live tempo, undo during playback, and the voice limit. Exit 1 on any failure.
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://localhost:3220/?perf=1';
const MODULE = {
  baseNote: { frequency: '263', startTime: '0', duration: '1' },
  notes: [
    // A top piano string (no damper, 1.5 s ring) ending at the module's end, and two sines.
    { id: 1, startTime: 'base.t', duration: 'base.d * (1/2)', frequency: 'base.f', instrument: 'sine-wave' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'base.d * (1/2)', frequency: '(5/4) * base.f', instrument: 'sine-wave' },
    { id: 3, startTime: 'base.t + base.d * (1/4)', duration: 'base.d * (3/4)', frequency: '8 * base.f', instrument: 'piano' },
  ],
};
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/wake lock/i.test(m.text())) errors.push(m.text()); });
await page.addInitScript((m) => {
  if (!sessionStorage.getItem('__t2')) { sessionStorage.setItem('__t2', '1'); localStorage.setItem('rmt:moduleSnapshot:v1', JSON.stringify(m)); }
}, MODULE);
await page.goto(URL);
await page.waitForFunction(() => window.__rmtPerf?.getModuleRef?.()?.notes?.[3], null, { timeout: 30000 });
await page.evaluate(async () => {
  const { audioEngine } = await import('/src/player/audio-engine.js');
  window.__ae = audioEngine;
  window.__snap = () => {
    const now = audioEngine.audioContext.currentTime;
    const es = Array.from(audioEngine.activeOscillators);
    return { now, n: es.length, streaming: !!audioEngine._streamingState, entries: es.map((e) => ({ id: e.noteId, start: e.startTime, off: e.offTime, end: e.endTime, score: e.scoreStart })) };
  };
  window.__wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
});
const snap = () => page.evaluate(() => window.__snap());
const wait = (s) => page.waitForTimeout(s * 1000);
const click = (sel) => page.click(sel);

// 1. The module's end: scheduling stops, the tails ring out, then the voices are gone.
await click('#playPauseBtn');
await wait(1.35); // past the end (1 s after the 0.1 s lead-in)
const atEnd = await snap();
check('at the module\'s end the playback stops scheduling', !atEnd.streaming);
const ringing = atEnd.entries.filter((e) => e.end > atEnd.now && e.off <= atEnd.now);
check('…and the last notes ring on past their note-off', ringing.length >= 1, `${ringing.length} voice(s) in their release, the piano's until +${ringing.length ? (Math.max(...ringing.map((e) => e.end)) - atEnd.now).toFixed(2) : '-'} s`);
await wait(1.6);
const after = await snap();
check('…and each stops itself after its tail', after.n === 0, `${after.n} left 1.6 s later`);

// 2. Play while tails ring: they are cut, only the new playback's voices remain.
await click('#playPauseBtn'); await wait(1.3);
const t = await page.evaluate(() => window.__ae.audioContext.currentTime);
await click('#playPauseBtn'); await wait(0.15);
const replay = await snap();
check('a new Play cuts the tails still ringing', replay.entries.every((e) => e.start >= t), `${replay.entries.filter((e) => e.start < t).length} old voice(s) left`);
// 3. Stop mid-play.
await wait(0.3); await click('#stopButton'); await wait(0.1);
check('Stop cuts everything', (await snap()).n === 0);
// 4. Pause mid-play (the tails fade with the pause).
await click('#playPauseBtn'); await wait(0.45); await click('#playPauseBtn'); await wait(0.6);
check('Pause fades everything out', (await snap()).n === 0);
await click('#stopButton'); await wait(0.1);

// 5. Loop seams (the engine's loop with the app's own note list), then switching the loop off.
const loop = await page.evaluate(async () => {
  const ae = window.__ae, mod = window.__rmtPerf.getModuleRef();
  const list = await ae.preparePlayback(mod, 0);
  const end = mod.getModuleEndTime();
  const t0 = ae.play(list, { initialVolume: 0.2, loop: { period: end, notes: list, firstCycleAudioLength: end } });
  await window.__wait(2.3); // into pass 3
  const s = window.__snap();
  const keys = s.entries.map((e) => `${e.id}@${e.score.toFixed(6)}`);
  const seam = t0 + 2 * end;
  const across = s.entries.filter((e) => e.start < seam && e.end > seam).length;
  const cutAt = ae.disarmLoop();
  const later = window.__snap().entries.filter((e) => e.start >= cutAt - 1e-6).length;
  await window.__wait(cutAt - ae.audioContext.currentTime + 0.1);
  const afterSeam = window.__snap();
  return { dup: keys.length - new Set(keys).size, n: s.n, across, later, ringing: afterSeam.n, streaming: afterSeam.streaming };
});
check('looping: no note scheduled twice', loop.dup === 0, `${loop.n} voices in flight`);
check('looping: tails of a pass ring across the seam', loop.across >= 1, `${loop.across} voice(s) span the second seam`);
check('loop switched off: nothing after the final seam', loop.later === 0);
check('…and the last pass\'s tails ring out past it', loop.ringing >= 1, `${loop.ringing} voice(s) still in their release`);
await page.evaluate(() => window.__ae.stopAll()); await wait(0.1);

// 6. Live tempo during playback with tails: nothing doubled, nothing lost.
const tempo = await page.evaluate(async () => {
  const ae = window.__ae, mod = window.__rmtPerf.getModuleRef();
  const list = await ae.preparePlayback(mod, 0);
  const end = mod.getModuleEndTime();
  ae.play(list, { initialVolume: 0.2, loop: { period: end, notes: list, firstCycleAudioLength: end } });
  await window.__wait(0.6); ae.setRate(1.5); await window.__wait(0.8); ae.setRate(0.75); await window.__wait(0.5);
  const s = window.__snap(); const keys = s.entries.map((e) => `${e.id}@${e.score.toFixed(6)}`);
  ae.setRate(1); ae.stopAll();
  return { dup: keys.length - new Set(keys).size, n: s.n };
});
check('live tempo changes with tails: no note doubled', tempo.dup === 0, `${tempo.n} voices`);

// 7. Undo during playback: the restore pauses playback first; the tails fade with it.
await click('#playPauseBtn'); await wait(0.4);
await page.evaluate(async () => {
  const { eventBus } = await import('/src/utils/event-bus.js');
  const snapJson = window.__rmtPerf.getModuleRef().createModuleJSON();
  eventBus.emit('history:requestRestore', { snapshot: snapJson, source: 'undo', label: 'test' });
});
await wait(0.6);
check('undo during playback: playback pauses and every voice fades', (await snap()).n === 0);
await click('#stopButton');

// 8. The voice limit: 300 overlapping piano notes in their release.
const lim = await page.evaluate(async () => {
  const ae = window.__ae;
  const MAX_VOICES = ae.graph.maxVoices;
  ae.voiceStats.stolen = 0;
  const now = ae.audioContext.currentTime + 0.2;
  for (let i = 0; i < 300; i++) {
    ae._scheduleNote({ id: 1000 + i, startTime: i * 0.002, duration: 0.01, frequency: 2093 * (1 + i / 600), temperedFrequency: null, instrument: 'piano', amplitude: 1, panPos: 0 }, now, 0.001, null);
  }
  let worst = 0;
  for (const x of [0.3, 0.5, 0.7, 0.9]) {
    const at = now + x;
    const n = Array.from(ae.activeOscillators).filter((e) => !e.stolen && e.startTime <= at && e.endTime > at).length;
    worst = Math.max(worst, n);
  }
  const stolen = ae.voiceStats.stolen;
  ae.stopAll();
  return { worst, stolen, max: MAX_VOICES };
});
check(`the voice limit holds (${lim.max})`, lim.worst <= lim.max && lim.stolen >= 300 - lim.max, `at most ${lim.worst} sounding, ${lim.stolen} stolen`);

// 9. Loop transposition: every pass a 9/8 above the one before, folded into one octave.
const lt = await page.evaluate(async () => {
  const ae = window.__ae, mod = window.__rmtPerf.getModuleRef();
  const { settingsStore } = await import('/src/settings/settings-store.js');
  settingsStore.set('audio.loop.transpose', { n: 9, d: 8 }); settingsStore.set('audio.loop.fold', true);
  const list = await ae.preparePlayback(mod, 0);
  const end = mod.getModuleEndTime();
  const seen = new Map(); // noteId@pass -> frequency
  ae.play(list, { initialVolume: 0.2, loop: { period: end, notes: list, firstCycleAudioLength: end } });
  for (let i = 0; i < 14; i++) {
    await window.__wait(0.5);
    for (const e of ae.activeOscillators) { const pass = Math.round((e.scoreStart - (list.find((n) => n.id === e.noteId)?.startTime || 0)) / end); seen.set(`${e.noteId}@${pass}`, e.frequency); }
  }
  ae.stopAll();
  settingsStore.set('audio.loop.transpose', { n: 1, d: 1 });
  const out = [];
  for (const [key, f] of seen) { const [id, pass] = key.split('@').map(Number); const f0 = list.find((n) => n.id === id).frequency; out.push([id, pass, f / f0]); }
  return out;
});
const want = (pass) => 2 ** ((pass * Math.log2(9 / 8)) % 1);
const bad = lt.filter(([, pass, r]) => Math.abs(r - want(pass)) > 1e-9 * want(pass));
const passes = new Set(lt.map(([, p]) => p));
check('loop transposition 9/8: each pass a whole tone above the last, folded into an octave', lt.length > 0 && bad.length === 0 && passes.size >= 6,
  `${lt.length} voices over passes ${[...passes].sort((a, b) => a - b).join(',')}; pass 6 at ${(lt.find(([, p]) => p === 6) || [0, 0, NaN])[2].toFixed?.(6)} (531441/524288 = ${(531441 / 524288).toFixed(6)})${bad.length ? '; wrong: ' + JSON.stringify(bad.slice(0, 3)) : ''}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.evaluate(() => { localStorage.removeItem('rmt:moduleSnapshot:v1'); });
await browser.close();
console.log(results.every(Boolean) ? '\nAll transport checks passed.' : '\nSOME TRANSPORT CHECKS FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
